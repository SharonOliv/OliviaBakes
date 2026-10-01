const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool, Client } = require('pg');

const ssl = { rejectUnauthorized: false };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
const dist = path.join(__dirname, '..', 'frontend', 'dist', 'web', 'browser');
const app = express();
app.use(express.json());
app.use(express.static(dist));
const h = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });

const DELIVERY_FEE = 4000;   // Rs 40, in paise
const FREE_ABOVE = 49900;    // free delivery from Rs 499

app.get('/api/products', h(async (req, res) => res.json((await pool.query('SELECT * FROM products ORDER BY id')).rows)));
app.get('/api/bestsellers', h(async (req, res) => res.json((await pool.query('SELECT * FROM bestsellers ORDER BY rank, name LIMIT 3')).rows)));

app.get('/api/queue', h(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT q.*, (SELECT json_agg(json_build_object('name', p.name, 'qty', oi.qty))
                 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = q.id) AS items
    FROM order_queue q ORDER BY q.created_at, q.id`);
  res.json(rows);
}));

app.get('/api/orders/:id', h(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT o.id, o.ticket, o.status, o.total_paise, o.fulfilment, q.position
     FROM orders o LEFT JOIN order_queue q ON q.id = o.id WHERE o.id = $1`, [req.params.id]);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Not found' });
}));

// Checkout: validates input, recalculates prices from the database, one transaction.
app.post('/api/orders', h(async (req, res) => {
  const b = req.body || {};
  const bad = m => res.status(400).json({ error: m });
  const customer = String(b.customer || '').trim();
  const phone = String(b.phone || '').trim();
  const email = String(b.email || '').trim() || null;
  const note = String(b.note || '').trim().slice(0, 200) || null;
  const fulfilment = b.fulfilment === 'delivery' ? 'delivery' : 'pickup';
  const payment = ['cod', 'upi', 'card'].includes(b.payment) ? b.payment : 'cod';
  const address = fulfilment === 'delivery' ? String(b.address || '').trim() : null;
  const items = (Array.isArray(b.items) ? b.items : []).map(i => ({ id: Number(i.id), qty: Number(i.qty) }));

  if (customer.length < 2) return bad('Enter your name');
  if (!/^[6-9]\d{9}$/.test(phone)) return bad('Enter a valid 10-digit mobile number');
  if (fulfilment === 'delivery' && (!address || address.length < 8)) return bad('Enter your full delivery address');
  if (!items.length || items.some(i => !Number.isInteger(i.id) || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 20))
    return bad('Your bag is invalid');
  items.sort((a, c) => a.id - c.id); // consistent lock order avoids deadlocks

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    let subtotal = 0; const lines = [];
    for (const { id, qty } of items) {
      const r = await db.query('UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING price_paise', [id, qty]);
      if (!r.rowCount) { const e = new Error('Some items just sold out. Please review your bag.'); e.status = 409; throw e; }
      subtotal += r.rows[0].price_paise * qty;
      lines.push([id, qty, r.rows[0].price_paise]);
    }
    const fee = fulfilment === 'delivery' && subtotal < FREE_ABOVE ? DELIVERY_FEE : 0;
    const o = await db.query(
      `INSERT INTO orders (customer, phone, email, fulfilment, address, payment, note, subtotal_paise, delivery_paise, total_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, ticket, total_paise`,
      [customer, phone, email, fulfilment, address, payment, note, subtotal, fee, subtotal + fee]);
    for (const [pid, qty, price] of lines)
      await db.query('INSERT INTO order_items VALUES ($1,$2,$3,$4)', [o.rows[0].id, pid, qty, price]);
    await db.query('COMMIT');
    res.json(o.rows[0]);
  } catch (e) {
    await db.query('ROLLBACK');
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not place order' });
  } finally { db.release(); }
}));

// Kitchen: FOR UPDATE SKIP LOCKED means two staff can never take the same order
app.post('/api/kitchen/next', h(async (req, res) => {
  const r = await pool.query(`UPDATE orders SET status = 'preparing' WHERE id =
    (SELECT id FROM orders WHERE status = 'queued' ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`);
  res.json(r.rows[0] || null);
}));
let auto = true;
app.get('/api/kitchen/auto', (req, res) => res.json({ on: auto }));
app.post('/api/kitchen/auto', (req, res) => { auto = !auto; res.json({ on: auto }); });
const MOVES = { ready: ['preparing', 'ready'], collect: ['ready', 'collected'] };
app.post('/api/kitchen/:id/:act', h(async (req, res) => {
  const m = MOVES[req.params.act];
  if (!m) return res.status(400).json({ error: 'Bad action' });
  await pool.query('UPDATE orders SET status = $3 WHERE id = $1 AND status = $2', [req.params.id, m[0], m[1]]);
  res.json({ ok: true });
}));

// Demo kitchen: moves the line along every 10s
let tick = 0;
setInterval(async () => {
  if (!auto) return;
  try {
    if (tick++ % 2 === 0)
      await pool.query("UPDATE orders SET status='collected' WHERE id=(SELECT id FROM orders WHERE status='ready' ORDER BY created_at LIMIT 1)");
    await pool.query("UPDATE orders SET status='ready' WHERE id=(SELECT id FROM orders WHERE status='preparing' ORDER BY created_at LIMIT 1)");
    await pool.query("UPDATE orders SET status='preparing' WHERE id=(SELECT id FROM orders WHERE status='queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)");
  } catch (e) { console.error(e.message); }
}, 10000);

// Real-time: Postgres NOTIFY -> browsers via Server-Sent Events
const clients = new Set();
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
setInterval(() => clients.forEach(c => c.write(': ping\n\n')), 25000);

app.use((req, res) => res.sendFile(path.join(dist, 'index.html')));

async function start() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const listener = new Client({ connectionString: process.env.DATABASE_URL, ssl });
  await listener.connect();
  await listener.query('LISTEN olive');
  listener.on('notification', m => clients.forEach(c => c.write(`data: ${m.payload}\n\n`)));
  app.listen(process.env.PORT || 3000, () => console.log('OliveBakes running on port ' + (process.env.PORT || 3000)));
}
start().catch(e => { console.error(e); process.exit(1); });