const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool, Client, types } = require('pg');

types.setTypeParser(1082, v => v); // keep DATE columns as 'YYYY-MM-DD' strings (no timezone shifting)

const ssl = process.env.DB_SSL === 'off' ? false : { rejectUnauthorized: false }; // DB_SSL=off for a local Postgres
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
const dist = path.join(__dirname, '..', 'frontend', 'dist', 'web', 'browser');
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(dist));

// ---------- settings ----------
const ADMIN_KEY = process.env.ADMIN_KEY || '';
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
    payment: ['cod', 'upi'].includes(b.payment) ? b.payment : 'cod',   // 'upi' = pay by UPI at delivery for now
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

// ---------- admin auth (single owner): send the key in the x-admin-key header ----------
const attempts = new Map();
function admin(req, res, next) {
  const rec = attempts.get(req.ip) || { n: 0, t: Date.now() };
  if (Date.now() - rec.t > 15 * 60e3) { rec.n = 0; rec.t = Date.now(); }
  if (rec.n >= 10) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const given = Buffer.from(String(req.get('x-admin-key') || '')), real = Buffer.from(ADMIN_KEY);
  if (!ADMIN_KEY || given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    rec.n++; attempts.set(req.ip, rec);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------- public API ----------
app.get('/api/products', h(async (req, res) =>
  res.json((await pool.query('SELECT id, name, category, image, price_paise, available FROM products ORDER BY id')).rows)));

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

// Standard order: prices and capacity are checked against the database, all in one transaction.
app.post('/api/orders', h(async (req, res) => {
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
    const { rows: ps } = await db.query('SELECT id, price_paise, units, available FROM products WHERE id = ANY($1::int[]) ORDER BY id', [ids]);
    if (ps.length !== ids.length || ps.some(p => !p.available)) fail(409, 'Some items are no longer available. Please review your bag.');
    let subtotal = 0, units = 0;
    for (const p of ps) { subtotal += p.price_paise * want.get(p.id); units += p.units * want.get(p.id); }
    if (!(await reserve(db, c.delivery_date, units))) fail(409, 'That day is fully booked. Please choose another date.');
    const fee = subtotal >= FREE_ABOVE ? 0 : areaFeePaise;
    const o = await db.query(
      `INSERT INTO orders (kind, customer, phone, email, address, pincode, delivery_date, delivery_slot, payment, note,
                           units_reserved, subtotal_paise, delivery_paise, total_paise)
       VALUES ('standard',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, public_token, total_paise`,
      [c.customer, c.phone, c.email, c.address, c.pincode, c.delivery_date, c.delivery_slot, c.payment, c.note,
       units, subtotal, fee, subtotal + fee]);
    for (const p of ps)
      await db.query('INSERT INTO order_items VALUES ($1,$2,$3,$4)', [o.rows[0].id, p.id, want.get(p.id), p.price_paise]);
    return o.rows[0];
  });
  res.json(order);
}));

// Custom cake request: no price and no capacity yet. You review it and send a quote.
app.post('/api/custom-requests', h(async (req, res) => {
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
    `INSERT INTO orders (kind, status, customer, phone, email, address, pincode, delivery_date, delivery_slot, payment, note, custom_details)
     VALUES ('custom','requested',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, public_token`,
    [c.customer, c.phone, c.email, c.address, c.pincode, c.delivery_date, c.delivery_slot, c.payment, c.note, details]);
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

// ---------- admin API ----------
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

app.post('/api/admin/orders/:id/paid', admin, h(async (req, res) => {
  const r = await pool.query("UPDATE orders SET payment_status = 'paid' WHERE id = $1 AND status <> 'cancelled' RETURNING id", [intParam(req.params.id)]);
  r.rowCount ? res.json({ ok: true }) : fail(404, 'Not found');
}));

// Quote a custom cake: sets the price, reserves capacity for that day (units = how much of the day it uses).
app.post('/api/admin/orders/:id/quote', admin, h(async (req, res) => {
  const id = intParam(req.params.id);
  const price = Number(req.body?.quoted_paise), units = Number(req.body?.units ?? 6);
  if (!Number.isInteger(price) || price < 10000) fail(400, 'Enter the quote in paise (at least Rs 100)');
  if (!Number.isInteger(units) || units < 1 || units > 50) fail(400, 'Units must be between 1 and 50');
  const note = str(req.body?.owner_note, 300) || null;
  const out = await tx(async db => {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    const o = rows[0];
    if (!o || o.kind !== 'custom') fail(404, 'Not found');
    if (!['requested', 'quoted'].includes(o.status)) fail(409, 'This request can no longer be re-quoted');
    await release(db, o.delivery_date, o.units_reserved);               // re-quoting gives back the earlier reservation
    if (!(await reserve(db, o.delivery_date, units))) fail(409, 'Not enough capacity left on that day');
    const area = await areaFee(db, o.pincode);
    const fee = price >= FREE_ABOVE ? 0 : area;
    const r = await db.query(
      `UPDATE orders SET status = 'quoted', units_reserved = $2, subtotal_paise = $3, delivery_paise = $4,
              total_paise = $5, owner_note = $6 WHERE id = $1 RETURNING id, status, total_paise`,
      [id, units, price, fee, price + fee, note]);
    return r.rows[0];
  });
  res.json(out);
}));

app.post('/api/admin/orders/:id/cancel', admin, h(async (req, res) => {
  const id = intParam(req.params.id);
  await tx(async db => {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    const o = rows[0];
    if (!o) fail(404, 'Not found');
    if (['delivered', 'cancelled'].includes(o.status)) fail(409, 'This order is already closed');
    await release(db, o.delivery_date, o.units_reserved);
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

app.patch('/api/admin/products/:id', admin, h(async (req, res) => {
  const price = req.body?.price_paise == null ? null : Number(req.body.price_paise);
  const available = typeof req.body?.available === 'boolean' ? req.body.available : null;
  if (price !== null && (!Number.isInteger(price) || price <= 0)) fail(400, 'Bad price');
  const r = await pool.query(
    'UPDATE products SET price_paise = COALESCE($2, price_paise), available = COALESCE($3, available) WHERE id = $1 RETURNING *',
    [intParam(req.params.id), price, available]);
  r.rowCount ? res.json(r.rows[0]) : fail(404, 'Not found');
}));

// ---------- real-time: Postgres NOTIFY -> browsers via Server-Sent Events ----------
const clients = new Set();
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
setInterval(() => clients.forEach(c => c.write(': ping\n\n')), 25000);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => res.sendFile(path.join(dist, 'index.html')));

async function start() {
  if (!ADMIN_KEY) console.warn('ADMIN_KEY is not set: admin routes are disabled');
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const listener = new Client({ connectionString: process.env.DATABASE_URL, ssl });
  await listener.connect();
  listener.on('error', e => { console.error(e); process.exit(1); }); // let the host restart us and reconnect
  await listener.query('LISTEN olive');
  listener.on('notification', m => clients.forEach(c => c.write(`data: ${m.payload}\n\n`)));
  app.listen(process.env.PORT || 3000, () => console.log('OliviaBakes running on port ' + (process.env.PORT || 3000)));
}
start().catch(e => { console.error(e); process.exit(1); });