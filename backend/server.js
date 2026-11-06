const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

types.setTypeParser(1082, v => v); // keep DATE columns as 'YYYY-MM-DD' strings (no timezone shifting)

const ssl = process.env.DB_SSL === 'off' ? false : { rejectUnauthorized: false }; // DB_SSL=off for a local Postgres
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 5, connectionTimeoutMillis: 15000 });
pool.on('error', e => console.error('Database connection dropped:', e.message));
const dist = path.join(__dirname, '..', 'frontend', 'dist', 'web', 'browser');
const app = express();
app.set('trust proxy', 1);
app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.json());

// In development the Angular page (localhost:4200) calls this server directly. CORS_ORIGIN allows one more site.
app.use((req, res, next) => {
  const o = req.get('origin');
  if (o && (/^http:\/\/localhost:\d+$/.test(o) || o === process.env.CORS_ORIGIN)) {
    res.set({
      'Access-Control-Allow-Origin': o, Vary: 'Origin',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
app.use(express.static(dist));

// ---------- settings ----------
const LEAD_HOURS = Number(process.env.LEAD_HOURS) || 24;                 // notice needed for standard orders
const CUSTOM_LEAD_HOURS = Number(process.env.CUSTOM_LEAD_HOURS) || 72;   // notice needed for custom cakes
const DEFAULT_DAILY_UNITS = Number(process.env.DEFAULT_DAILY_UNITS) || 30;
const MAX_DAYS = 30;               // how far ahead customers can book
const FREE_ABOVE = 49900;          // free delivery from Rs 499 (paise)
const SLOTS = {                    // delivery windows, India time
  morning:   { label: '9 am - 12 pm', start: 9 },
  afternoon: { label: '1 pm - 4 pm',  start: 13 },
  evening:   { label: '5 pm - 8 pm',  start: 17 },
};
// allowed status moves. 'requested -> quoted' happens only through the quote endpoint.
const NEXT = {
  quoted: ['confirmed'], placed: ['confirmed'], confirmed: ['baking'],
  baking: ['out_for_delivery'], out_for_delivery: ['delivered'],
};

// ---------- helpers ----------
const fail = (status, msg) => { const e = new Error(msg); e.status = status; throw e; };
const h = fn => (req, res) => fn(req, res).catch(e => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(e); res.status(500).json({ error: 'Server error' });
});
async function tx(fn) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const r = await fn(db); await db.query('COMMIT'); return r; }
  catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; }
  finally { db.release(); }
}
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const istDate = d => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
const slotStart = (day, slot) => new Date(`${day}T${String(SLOTS[slot].start).padStart(2, '0')}:00:00+05:30`);
const intParam = v => /^\d+$/.test(v) ? Number(v) : fail(404, 'Not found');

function checkWhen(day, slot, leadHours) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !SLOTS[slot]) fail(400, 'Pick a delivery date and time slot');
  const s = slotStart(day, slot);
  if (isNaN(s) || istDate(s) !== day) fail(400, 'Pick a valid delivery date');
  if (s < new Date(Date.now() + leadHours * 3600e3)) fail(400, `Orders need at least ${leadHours} hours' notice`);
  if (s > new Date(Date.now() + MAX_DAYS * 86400e3)) fail(400, `We take bookings up to ${MAX_DAYS} days ahead`);
}

// fields every order needs, standard or custom
function contact(b) {
  const c = {
    customer: str(b.customer, 80), phone: str(b.phone, 15), email: str(b.email, 120) || null,
    address: str(b.address, 300), pincode: str(b.pincode, 6),
    delivery_date: str(b.delivery_date, 10), delivery_slot: str(b.delivery_slot, 20),
    payment: ['cod', 'upi'].includes(b.payment) ? b.payment : 'cod',
    note: str(b.note, 200) || null,
  };
  if (c.customer.length < 2) fail(400, 'Enter your name');
  if (!/^[6-9]\d{9}$/.test(c.phone)) fail(400, 'Enter a valid 10-digit mobile number');
  if (c.email && !/^\S+@\S+\.\S+$/.test(c.email)) fail(400, 'Enter a valid email or leave it blank');
  if (c.address.length < 8) fail(400, 'Enter your full delivery address');
  if (!/^\d{6}$/.test(c.pincode)) fail(400, 'Enter a valid 6-digit pincode');
  return c;
}

async function areaFee(db, pincode) {
  const r = await db.query('SELECT delivery_paise FROM service_areas WHERE pincode = $1 AND active', [pincode]);
  if (!r.rowCount) fail(422, "We don't deliver to that pincode yet");
  return r.rows[0].delivery_paise;
}

// Atomic: either the day has room for n more units and they are taken, or nothing changes.
async function reserve(db, day, n) {
  await db.query('INSERT INTO day_capacity (day, max_units) VALUES ($1, $2) ON CONFLICT DO NOTHING', [day, DEFAULT_DAILY_UNITS]);
  const r = await db.query('UPDATE day_capacity SET used_units = used_units + $2 WHERE day = $1 AND used_units + $2 <= max_units', [day, n]);
  return r.rowCount === 1;
}
const release = (db, day, n) => n > 0
  ? db.query('UPDATE day_capacity SET used_units = GREATEST(used_units - $2, 0) WHERE day = $1', [day, n])
  : null;

// accounts, admin role, items, offers, profile, Cloudinary signing
const { admin, loadUser, seedAdmin } = require('./extras')(app, pool, { h, fail, str, intParam, tx });

// ---------- public API ----------
app.get('/api/bestsellers', h(async (req, res) =>
  res.json((await pool.query('SELECT * FROM bestsellers ORDER BY rank, name LIMIT 3')).rows)));

app.get('/api/areas/:pincode', h(async (req, res) => {
  const r = await pool.query('SELECT area_name, delivery_paise FROM service_areas WHERE pincode = $1 AND active', [req.params.pincode]);
  res.json(r.rows[0] ? { ok: true, ...r.rows[0], free_above_paise: FREE_ABOVE } : { ok: false });
}));

// Bookable days with remaining capacity, and which slots still meet the notice period.
app.get('/api/availability', h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT to_char(g::date, 'YYYY-MM-DD') AS day, COALESCE(c.max_units, $2) - COALESCE(c.used_units, 0) AS remaining
     FROM generate_series($1::date, $1::date + $3::int, '1 day') g
     LEFT JOIN day_capacity c ON c.day = g::date ORDER BY g`,
    [istDate(new Date()), DEFAULT_DAILY_UNITS, MAX_DAYS]);
  const cut = hrs => new Date(Date.now() + hrs * 3600e3);
  const slotsFor = hrs => day => Object.keys(SLOTS).filter(k => slotStart(day, k) >= cut(hrs));
  res.json({
    slot_labels: Object.fromEntries(Object.entries(SLOTS).map(([k, v]) => [k, v.label])),
    lead_hours: LEAD_HOURS, custom_lead_hours: CUSTOM_LEAD_HOURS,
    days: rows.map(r => ({
      day: r.day, remaining: Math.max(0, r.remaining),
      slots: slotsFor(LEAD_HOURS)(r.day), custom_slots: slotsFor(CUSTOM_LEAD_HOURS)(r.day),
    })),
  });
}));

app.post('/api/orders', h(async (req, res) => {
  const u = await loadUser(req);
  if (!u) fail(401, 'Please log in to place an order');
  const b = req.body || {};
  const c = contact(b);
  const want = new Map();
  for (const i of Array.isArray(b.items) ? b.items : []) {
    const id = Number(i.id), qty = Number(i.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1) fail(400, 'Your bag is invalid');
    want.set(id, (want.get(id) || 0) + qty);
  }
  if (!want.size || want.size > 30 || [...want.values()].some(q => q > 20)) fail(400, 'Your bag is invalid');
  checkWhen(c.delivery_date, c.delivery_slot, LEAD_HOURS);

  const order = await tx(async db => {
    const areaFeePaise = await areaFee(db, c.pincode);
    const ids = [...want.keys()].sort((a, z) => a - z);
    const { rows: ps } = await db.query(
      'SELECT id, name, price_paise, available FROM products WHERE id = ANY($1::int[]) AND NOT archived ORDER BY id', [ids]);
    if (ps.length !== ids.length || ps.some(p => !p.available)) fail(409, 'Some items are no longer available. Please review your bag.');
    let subtotal = 0;
    for (const p of ps) {
      const q = want.get(p.id);
      // this item's limit for the delivery day (no row = unlimited); the row lock keeps two orders from overselling
      const lim = (await db.query('SELECT max_qty FROM item_day_limits WHERE product_id = $1 AND day = $2::date FOR UPDATE', [p.id, c.delivery_date])).rows[0];
      if (lim) {
        const { n } = (await db.query(
          `SELECT COALESCE(SUM(oi.qty), 0)::int AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE oi.product_id = $1 AND o.delivery_date = $2::date AND o.status <> 'cancelled'`, [p.id, c.delivery_date])).rows[0];
        if (n + q > lim.max_qty) fail(409, `${p.name}: only ${Math.max(0, lim.max_qty - n)} left for that day. Please change the quantity or the date.`);
      }
      const s = await db.query('UPDATE products SET stock = stock - $2 WHERE id = $1 AND (stock IS NULL OR stock >= $2)', [p.id, q]);
      if (!s.rowCount) fail(409, `${p.name} just sold out. Please review your bag.`);
      subtotal += p.price_paise * q;
    }
    const fee = subtotal >= FREE_ABOVE ? 0 : areaFeePaise;
    const o = await db.query(
      `INSERT INTO orders (kind, user_id, customer, phone, email, address, pincode, delivery_date, delivery_slot, payment, note,
                           subtotal_paise, delivery_paise, total_paise)
       VALUES ('standard',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, public_token, total_paise`,
      [u.id, c.customer, c.phone, c.email, c.address, c.pincode, c.delivery_date, c.delivery_slot, c.payment, c.note,
       subtotal, fee, subtotal + fee]);
    for (const p of ps)
      await db.query('INSERT INTO order_items VALUES ($1,$2,$3,$4)', [o.rows[0].id, p.id, want.get(p.id), p.price_paise]);
    return o.rows[0];
  });
  res.json(order);
}));

// Custom cake request: needs a login. No price and no capacity yet; you review it and send a quote.
app.post('/api/custom-requests', h(async (req, res) => {
  const u = await loadUser(req);
  if (!u) fail(401, 'Please log in to send a request');
  const b = req.body || {};
  const c = contact(b);
  const d = b.details || {};
  const details = { flavour: str(d.flavour, 60), weight_kg: Number(d.weight_kg), message: str(d.message, 60), description: str(d.description, 500) };
  if (!details.flavour) fail(400, 'Tell us the flavour you want');
  if (!(details.weight_kg >= 0.5 && details.weight_kg <= 10)) fail(400, 'Cake weight must be between 0.5 and 10 kg');
  if (details.description.length < 10) fail(400, 'Describe the design you have in mind');
  checkWhen(c.delivery_date, c.delivery_slot, CUSTOM_LEAD_HOURS);
  await areaFee(pool, c.pincode);
  const r = await pool.query(
    `INSERT INTO orders (kind, status, user_id, customer, phone, email, address, pincode, delivery_date, delivery_slot, payment, note, custom_details)
     VALUES ('custom','requested',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, public_token`,
    [u.id, c.customer, c.phone, c.email, c.address, c.pincode, c.delivery_date, c.delivery_slot, c.payment, c.note, details]);
  res.json(r.rows[0]);
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tracking is by the unguessable token, never the numeric id.
app.get('/api/orders/:token', h(async (req, res) => {
  if (!UUID.test(req.params.token)) fail(404, 'Not found');
  const { rows } = await pool.query(
    `SELECT o.id, o.kind, o.status, o.delivery_date, o.delivery_slot, o.payment, o.payment_status,
            o.subtotal_paise, o.delivery_paise, o.total_paise, o.custom_details, o.owner_note,
            (SELECT json_agg(json_build_object('name', p.name, 'qty', oi.qty, 'price_paise', oi.price_paise) ORDER BY p.name)
             FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS items
     FROM orders o WHERE o.public_token = $1`, [req.params.token]);
  rows[0] ? res.json(rows[0]) : fail(404, 'Not found');
}));

// Customer accepts your quote for a custom cake.
app.post('/api/orders/:token/accept', h(async (req, res) => {
  if (!UUID.test(req.params.token)) fail(404, 'Not found');
  const r = await pool.query(
    "UPDATE orders SET status = 'confirmed' WHERE public_token = $1 AND kind = 'custom' AND status = 'quoted' RETURNING id", [req.params.token]);
  r.rowCount ? res.json({ ok: true }) : fail(409, 'This quote can no longer be accepted');
}));

// ---------- admin API (admin accounts only) ----------
app.get('/api/admin/ping', admin, (req, res) => res.json({ ok: true }));

// Upcoming orders by default; ?date=YYYY-MM-DD for one delivery day (any status).
app.get('/api/admin/orders', admin, h(async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
  const { rows } = await pool.query(
    `SELECT o.*, (SELECT json_agg(json_build_object('name', p.name, 'qty', oi.qty) ORDER BY p.name)
                  FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS items
     FROM orders o
     WHERE ($1::date IS NULL OR o.delivery_date = $1::date)
       AND ($1::date IS NOT NULL OR o.status NOT IN ('delivered','cancelled'))
     ORDER BY o.delivery_date, CASE o.delivery_slot WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 ELSE 3 END, o.id`, [day]);
  res.json(rows);
}));

app.post('/api/admin/orders/:id/status', admin, h(async (req, res) => {
  const to = req.body?.status;
  const from = Object.keys(NEXT).filter(f => NEXT[f].includes(to));
  if (!from.length) fail(400, 'Bad status');
  const r = await pool.query('UPDATE orders SET status = $3 WHERE id = $1 AND status = ANY($2) RETURNING id, status',
    [intParam(req.params.id), from, to]);
  r.rowCount ? res.json(r.rows[0]) : fail(409, 'That order cannot move to that status');
}));

// body { paid: false } marks an order unpaid again
app.post('/api/admin/orders/:id/paid', admin, h(async (req, res) => {
  const r = await pool.query("UPDATE orders SET payment_status = $2 WHERE id = $1 AND status <> 'cancelled' RETURNING id",
    [intParam(req.params.id), req.body?.paid === false ? 'pending' : 'paid']);
  r.rowCount ? res.json({ ok: true }) : fail(404, 'Not found');
}));

app.post('/api/admin/orders/:id/quote', admin, h(async (req, res) => {
  const id = intParam(req.params.id);
  const price = Number(req.body?.quoted_paise);
  if (!Number.isInteger(price) || price < 10000) fail(400, 'Enter the quote in paise (at least Rs 100)');
  const note = str(req.body?.owner_note, 300) || null;
  const out = await tx(async db => {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    const o = rows[0];
    if (!o || o.kind !== 'custom') fail(404, 'Not found');
    if (!['requested', 'quoted'].includes(o.status)) fail(409, 'This request can no longer be re-quoted');
    const day = str(req.body?.delivery_date, 10) || o.delivery_date;
    const slot = str(req.body?.delivery_slot, 20) || o.delivery_slot;
    if (day !== o.delivery_date || slot !== o.delivery_slot) checkWhen(day, slot, CUSTOM_LEAD_HOURS);
    const fee = price >= FREE_ABOVE ? 0 : await areaFee(db, o.pincode);
    const r = await db.query(
      `UPDATE orders SET status = 'quoted', delivery_date = $6, delivery_slot = $7, subtotal_paise = $2, delivery_paise = $3,
              total_paise = $4, owner_note = $5 WHERE id = $1 RETURNING id, status, total_paise`,
      [id, price, fee, price + fee, note, day, slot]);
    return r.rows[0];
  });
  res.json(out);
}));

// Cancel (also how you decline a custom request): gives back capacity and stock.
app.post('/api/admin/orders/:id/cancel', admin, h(async (req, res) => {
  const id = intParam(req.params.id);
  await tx(async db => {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    const o = rows[0];
    if (!o) fail(404, 'Not found');
    if (['delivered', 'cancelled'].includes(o.status)) fail(409, 'This order is already closed');
    await release(db, o.delivery_date, o.units_reserved);
    await db.query(
      `UPDATE products p SET stock = p.stock + oi.qty FROM order_items oi
       WHERE oi.order_id = $1 AND oi.product_id = p.id AND p.stock IS NOT NULL`, [id]);
    await db.query("UPDATE orders SET status = 'cancelled', units_reserved = 0, owner_note = COALESCE($2, owner_note) WHERE id = $1",
      [id, str(req.body?.owner_note, 300) || null]);
  });
  res.json({ ok: true });
}));

// Change how much you can bake on a day (cannot go below what is already booked).
app.put('/api/admin/capacity/:day', admin, h(async (req, res) => {
  const max = Number(req.body?.max_units);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.day) || !Number.isInteger(max) || max < 0) fail(400, 'Bad date or limit');
  const r = await pool.query(
    `INSERT INTO day_capacity (day, max_units) VALUES ($1, $2)
     ON CONFLICT (day) DO UPDATE SET max_units = EXCLUDED.max_units WHERE day_capacity.used_units <= EXCLUDED.max_units
     RETURNING day, max_units, used_units`, [req.params.day, max]);
  r.rowCount ? res.json(r.rows[0]) : fail(409, 'More than that is already booked for this day');
}));

// Every menu item for one delivery day: its limit (null = unlimited) and how many are already booked.
app.get('/api/admin/capacity', admin, h(async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : istDate(new Date());
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.image, p.available, p.stock, l.max_qty,
            COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                      WHERE oi.product_id = p.id AND o.delivery_date = $1::date AND o.status <> 'cancelled'), 0)::int AS booked
     FROM products p LEFT JOIN item_day_limits l ON l.product_id = p.id AND l.day = $1::date
     WHERE NOT p.archived ORDER BY p.id`, [day]);
  res.json(rows);
}));

// Set (or clear, with a blank limit) one item's limit for a day, optionally repeated for the next N days.
app.put('/api/admin/capacity', admin, h(async (req, res) => {
  const day = str(req.body?.date, 10), pid = Number(req.body?.product_id);
  const days = Math.min(60, Math.max(1, Number(req.body?.days) || 1));
  const raw = req.body?.max_qty;
  const max = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(pid)) fail(400, 'Bad request');
  if (max !== null && (!Number.isInteger(max) || max < 0 || max > 100000)) fail(400, 'Enter a whole number, or leave it blank for unlimited');
  if (max === null)
    await pool.query('DELETE FROM item_day_limits WHERE product_id = $1 AND day >= $2::date AND day < $2::date + $3::int', [pid, day, days]);
  else
    await pool.query(
      `INSERT INTO item_day_limits (product_id, day, max_qty)
       SELECT $1, d::date, $3 FROM generate_series($2::date, $2::date + ($4::int - 1), '1 day') d
       ON CONFLICT (product_id, day) DO UPDATE SET max_qty = EXCLUDED.max_qty`, [pid, day, max, days]);
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => fs.existsSync(path.join(dist, 'index.html')) ? res.sendFile(path.join(dist, 'index.html')) : res.status(404).send('Not found'));

async function start() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await seedAdmin();
  app.listen(process.env.PORT || 3000, () => console.log('OliviaBakes running on port ' + (process.env.PORT || 3000)));
}
start().catch(e => { console.error(e); process.exit(1); });