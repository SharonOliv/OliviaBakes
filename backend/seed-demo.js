const crypto = require('crypto');
const { Pool } = require('pg');
const scrypt = require('util').promisify(crypto.scrypt);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'off' ? false : { rejectUnauthorized: false } });
const hash = async pw => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + (await scrypt(pw, s, 64)).toString('hex'); };
const day = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const PEOPLE = [   // all fake
  ['Ananya Reddy', '9000000001', 'ananya.reddy@example.com', '520010', 'Flat 301, Sri Sai Residency, Benz Circle'],
  ['Rohit Varma', '9000000002', 'rohit.varma@example.com', '520001', 'Door 12-4-8, Gandhi Nagar Main Road'],
  ['Meghana Rao', '9000000003', 'meghana.rao@example.com', '520002', 'Plot 45, Green Park Colony, Labbipet'],
  ['Karthik Naidu', '9000000004', 'karthik.naidu@example.com', '520008', 'Flat 7B, Lakshmi Towers, Patamata'],
  ['Divya Sharma', '9000000005', 'divya.sharma@example.com', '520003', 'House 22, Sunrise Layout, Moghalrajpuram'],
];

(async () => {
  const pw = await hash('Password@123');
  const prods = (await pool.query('SELECT id, price_paise FROM products WHERE NOT archived ORDER BY id')).rows;
  if (!prods.length) throw new Error('No items yet. Start the server once so the schema and starter items are created.');

  const users = [];
  for (const [name, phone, email, pin, addr] of PEOPLE) {
    const u = (await pool.query(
      `INSERT INTO users (name, phone, email, password_hash) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name, phone, email, pw])).rows[0];
    await pool.query(
      `INSERT INTO addresses (user_id, label, address, pincode, is_default)
       SELECT $1, 'Home', $2, $3, true WHERE NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = $1)`, [u.id, addr, pin]);
    for (const p of prods.slice(0, 2)) await pool.query('INSERT INTO favourites VALUES ($1,$2) ON CONFLICT DO NOTHING', [u.id, p.id]);
    users.push({ id: u.id, name, phone, email, pin, addr });
  }

  const have = (await pool.query("SELECT count(*)::int AS n FROM orders WHERE email LIKE '%@example.com'")).rows[0].n;
  if (!have) {
    const plan = [['delivered', 'paid', -4], ['delivered', 'paid', -2], ['out_for_delivery', 'pending', 0], ['baking', 'pending', 1],
                  ['confirmed', 'paid', 1], ['placed', 'pending', 2], ['placed', 'pending', 3], ['cancelled', 'pending', 2]];
    for (const [i, [status, paid, off]] of plan.entries()) {
      const u = users[i % users.length];
      const picks = prods.length > 1 ? [prods[i % prods.length], prods[(i + 1) % prods.length]] : [prods[0]];
      const items = picks.map((p, k) => ({ ...p, qty: 2 + ((i + k) % 3) }));
      const sub = items.reduce((s, x) => s + x.price_paise * x.qty, 0), fee = sub >= 49900 ? 0 : 4000;
      const o = (await pool.query(
        `INSERT INTO orders (kind, status, user_id, customer, phone, email, address, pincode, delivery_date, delivery_slot,
                             payment, payment_status, subtotal_paise, delivery_paise, total_paise)
         VALUES ('standard',$1,$2,$3,$4,$5,$6,$7,$8,$9,'cod',$10,$11,$12,$13) RETURNING id`,
        [status, u.id, u.name, u.phone, u.email, u.addr, u.pin, day(off), ['morning', 'afternoon', 'evening'][i % 3], paid, sub, fee, sub + fee])).rows[0];
      for (const x of items) await pool.query('INSERT INTO order_items VALUES ($1,$2,$3,$4)', [o.id, x.id, x.qty, x.price_paise]);
    }
    const cakes = [['requested', 0, null, 'Chocolate truffle', 1, 'Happy Birthday Riya'],
                   ['quoted', 150000, 'Red velvet is available. We can deliver on the day you picked.', 'Red velvet', 1.5, 'Happy Anniversary']];
    for (const [i, [status, price, note, flavour, kg, msg]] of cakes.entries()) {
      const u = users[(i + 2) % users.length];
      await pool.query(
        `INSERT INTO orders (kind, status, user_id, customer, phone, email, address, pincode, delivery_date, delivery_slot, payment,
                             custom_details, subtotal_paise, delivery_paise, total_paise, owner_note)
         VALUES ('custom',$1,$2,$3,$4,$5,$6,$7,$8,'afternoon','cod',$9,$10,0,$10,$11)`,
        [status, u.id, u.name, u.phone, u.email, u.addr, u.pin, day(5 + i),
         JSON.stringify({ flavour, weight_kg: kg, message: msg, description: 'Pastel pink frosting with white flowers and gold sprinkles.' }), price, note]);
    }
  }
  console.log('Done. Demo logins (password Password@123):\n' + PEOPLE.map(p => '  ' + p[2]).join('\n'));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });