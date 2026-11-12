const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

module.exports = (app, pool, { h, fail, str, intParam, tx }) => {
  // ---------- passwords and login tokens ----------
  const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
  if (!process.env.JWT_SECRET) console.warn('JWT_SECRET is not set: everyone is logged out whenever the server restarts');
  const hashPw = async pw => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + (await scrypt(pw, s, 64)).toString('hex'); };
  const checkPw = async (pw, st) => {
    const [s, hx] = String(st).split(':');
    return crypto.timingSafeEqual(await scrypt(pw, Buffer.from(s, 'hex'), 64), Buffer.from(hx, 'hex'));
  };
  const mac = body => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const sign = u => { const body = Buffer.from(JSON.stringify({ id: u.id, exp: Date.now() + 30 * 864e5 })).toString('base64url'); return body + '.' + mac(body); };
  const verify = tok => {
    const [body, sig] = String(tok || '').split('.');
    if (!body || !sig || sig.length !== mac(body).length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac(body)))) return null;
    try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
  };

  async function loadUser(req) {
    const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    const p = m && verify(m[1]);
    if (!p) return null;
    return (await pool.query('SELECT id, name, phone, email, role FROM users WHERE id = $1', [p.id])).rows[0] || null;
  }
  const needUser = (req, res, next) => loadUser(req)
    .then(u => u ? (req.user = u, next()) : res.status(401).json({ error: 'Please log in' })).catch(next);
  const admin = (req, res, next) => needUser(req, res, () =>
    req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' }));

  const tries = new Map();
  const tooMany = ip => { const r = tries.get(ip); return !!r && Date.now() - r.t < 15 * 60e3 && r.n >= 10; };
  const miss = ip => { const r = tries.get(ip); if (!r || Date.now() - r.t >= 15 * 60e3) tries.set(ip, { n: 1, t: Date.now() }); else r.n++; };
  const pub = u => ({ id: u.id, name: u.name, phone: u.phone, email: u.email, role: u.role });

  // The owner account comes from .env (ADMIN_EMAIL / ADMIN_PASSWORD); nobody can sign up as admin.
  async function seedAdmin() {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase(), pw = process.env.ADMIN_PASSWORD || '';
    if (!email || pw.length < 8) return console.warn('ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters) are not set: there is no admin account');
    await pool.query(
      `INSERT INTO users (name, phone, email, password_hash, role) VALUES ('Owner', '0000000000', $1, $2, 'admin')
      ON CONFLICT (email) DO UPDATE SET role = 'admin'`, [email, await hashPw(pw)]);
  }

  // ---------- sign up, log in ----------
  app.post('/api/auth/signup', h(async (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 80), phone = str(b.phone, 15), email = str(b.email, 120).toLowerCase(), pw = String(b.password || '');
    if (name.length < 2) fail(400, 'Please enter your name');
    if (!/^[6-9]\d{9}$/.test(phone)) fail(400, 'Enter a valid 10-digit mobile number');
    if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Enter a valid email address');
    if (pw.length < 8 || pw.length > 100) fail(400, 'Password must be at least 8 characters');
    const r = await pool.query(
      `INSERT INTO users (name, phone, email, password_hash) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO NOTHING RETURNING id, name, phone, email, role`, [name, phone, email, await hashPw(pw)]);
    if (!r.rowCount) fail(409, 'An account with this email already exists');
    res.json({ token: sign(r.rows[0]), user: pub(r.rows[0]) });
  }));

  app.post('/api/auth/login', h(async (req, res) => {
    if (tooMany(req.ip)) fail(429, 'Too many attempts. Try again later.');
    const email = str(req.body?.email, 120).toLowerCase(), pw = String(req.body?.password || '');
    const u = (await pool.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
    if (!u || !(await checkPw(pw, u.password_hash))) { miss(req.ip); fail(401, 'Incorrect email or password'); }
    res.json({ token: sign(u), user: pub(u) });
  }));

  app.get('/api/auth/me', needUser, (req, res) => res.json(pub(req.user)));

  // ---------- forgot / reset password (customers and admin) ----------
  let mailer = null;
  try {   // needs: npm i nodemailer, and SMTP_USER + SMTP_PASS (a Gmail app password) in .env
    if (process.env.SMTP_USER && process.env.SMTP_PASS)
      mailer = require('nodemailer').createTransport({ service: 'gmail', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  } catch { console.warn('nodemailer is not installed: reset links will be printed here instead of emailed'); }
  const sha = t => crypto.createHash('sha256').update(t).digest('hex');
  const forgotTries = new Map();

  app.post('/api/auth/forgot', h(async (req, res) => {
    const r = forgotTries.get(req.ip), fresh = !r || Date.now() - r.t >= 15 * 60e3;
    if (!fresh && r.n >= 5) fail(429, 'Too many requests. Try again in a few minutes.');
    forgotTries.set(req.ip, fresh ? { n: 1, t: Date.now() } : { n: r.n + 1, t: r.t });
    const email = str(req.body?.email, 120).toLowerCase();
    const u = (await pool.query('SELECT id, name FROM users WHERE email = $1', [email])).rows[0];
    if (u) {
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query('DELETE FROM password_resets WHERE user_id = $1 OR expires_at < now()', [u.id]);
      await pool.query("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 minutes')", [sha(token), u.id]);
      const link = `${process.env.APP_URL || 'http://localhost:4200'}/reset-password?token=${token}`;
      if (mailer) {
        mailer.sendMail({
          from: `OliviaBakes <${process.env.SMTP_USER}>`, to: email, subject: 'Reset your OliviaBakes password',
          text: `Hi ${u.name},\n\nUse this link to choose a new password (valid for 30 minutes):\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
        }).catch(e => console.error('Could not send reset email:', e.message));
      } else console.log('Password reset link for', email, '->', link);
    }
    res.json({ ok: true });   // same answer whether or not the email exists
  }));

  app.post('/api/auth/reset', h(async (req, res) => {
    const token = String(req.body?.token || ''), pw = String(req.body?.password || '');
    if (pw.length < 8 || pw.length > 100) fail(400, 'Password must be at least 8 characters');
    const r = await pool.query('DELETE FROM password_resets WHERE token_hash = $1 AND expires_at > now() RETURNING user_id', [sha(token)]);
    if (!r.rowCount) fail(400, 'This reset link is invalid or has expired. Please request a new one.');
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [r.rows[0].user_id, await hashPw(pw)]);
    res.json({ ok: true });
  }));

  // ---------- profile and settings ----------
  app.patch('/api/me', needUser, h(async (req, res) => {
    const name = str(req.body?.name, 80), phone = str(req.body?.phone, 15);
    if (name.length < 2) fail(400, 'Please enter your name');
    if (!/^[6-9]\d{9}$/.test(phone)) fail(400, 'Enter a valid 10-digit mobile number');
    const r = await pool.query('UPDATE users SET name = $2, phone = $3 WHERE id = $1 RETURNING id, name, phone, email, role', [req.user.id, name, phone]);
    res.json(pub(r.rows[0]));
  }));

  app.post('/api/me/password', needUser, h(async (req, res) => {
    const cur = String(req.body?.current || ''), next = String(req.body?.next || '');
    if (next.length < 8 || next.length > 100) fail(400, 'New password must be at least 8 characters');
    const u = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!(await checkPw(cur, u.password_hash))) fail(401, 'Current password is not right');
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await hashPw(next)]);
    res.json({ ok: true });
  }));

  // ---------- my addresses ----------
  const addrBody = b => {
    const a = { label: str(b?.label, 30) || 'Home', address: str(b?.address, 300), pincode: str(b?.pincode, 6), def: !!b?.is_default };
    if (a.address.length < 8) fail(400, 'Enter the full address');
    if (!/^\d{6}$/.test(a.pincode)) fail(400, 'Enter a valid 6-digit pincode');
    return a;
  };
  app.get('/api/me/addresses', needUser, h(async (req, res) =>
    res.json((await pool.query('SELECT id, label, address, pincode, is_default FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, id', [req.user.id])).rows)));

  app.post('/api/me/addresses', needUser, h(async (req, res) => {
    const a = addrBody(req.body);
    res.json(await tx(async db => {
      const n = (await db.query('SELECT count(*)::int AS n FROM addresses WHERE user_id = $1', [req.user.id])).rows[0].n;
      if (n >= 10) fail(400, 'You can save up to 10 addresses');
      const def = a.def || n === 0;
      if (def) await db.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
      return (await db.query('INSERT INTO addresses (user_id, label, address, pincode, is_default) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [req.user.id, a.label, a.address, a.pincode, def])).rows[0];
    }));
  }));

  app.put('/api/me/addresses/:id', needUser, h(async (req, res) => {
    const a = addrBody(req.body), id = intParam(req.params.id);
    res.json(await tx(async db => {
      if (a.def) await db.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
      const r = await db.query(
        'UPDATE addresses SET label = $3, address = $4, pincode = $5, is_default = is_default OR $6 WHERE id = $1 AND user_id = $2 RETURNING *',
        [id, req.user.id, a.label, a.address, a.pincode, a.def]);
      if (!r.rowCount) fail(404, 'Not found');
      return r.rows[0];
    }));
  }));

  app.delete('/api/me/addresses/:id', needUser, h(async (req, res) => {
    await tx(async db => {
      const r = await db.query('DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING is_default', [intParam(req.params.id), req.user.id]);
      if (!r.rowCount) fail(404, 'Not found');
      if (r.rows[0].is_default)
        await db.query('UPDATE addresses SET is_default = true WHERE id = (SELECT id FROM addresses WHERE user_id = $1 ORDER BY id LIMIT 1)', [req.user.id]);
    });
    res.json({ ok: true });
  }));

  // ---------- my favourites and my orders ----------
  app.get('/api/me/favourites', needUser, h(async (req, res) =>
    res.json((await pool.query(
      'SELECT f.product_id FROM favourites f JOIN products p ON p.id = f.product_id WHERE f.user_id = $1 AND NOT p.archived', [req.user.id]))
      .rows.map(r => r.product_id))));

  app.put('/api/me/favourites/:id', needUser, h(async (req, res) => {
    try { await pool.query('INSERT INTO favourites (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, intParam(req.params.id)]); }
    catch (e) { if (e.code === '23503') fail(404, 'Not found'); throw e; }
    res.json({ ok: true });
  }));

  app.delete('/api/me/favourites/:id', needUser, h(async (req, res) => {
    await pool.query('DELETE FROM favourites WHERE user_id = $1 AND product_id = $2', [req.user.id, intParam(req.params.id)]);
    res.json({ ok: true });
  }));

  app.get('/api/my/orders', needUser, h(async (req, res) =>
    res.json((await pool.query(
      `SELECT id, public_token, kind, status, delivery_date, delivery_slot, total_paise
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.user.id])).rows)));

  // ---------- items ----------
  // customers see an item as unavailable when it is switched off OR its stock has run out
  app.get('/api/products', h(async (req, res) =>
    res.json((await pool.query(
            `SELECT id, name, category, image, price_paise, units, stock, ingredients, allergens, weight_g,
              (available AND (stock IS NULL OR stock > 0)) AS available
       FROM products WHERE NOT archived ORDER BY id`)).rows)));

  app.get('/api/admin/products', admin, h(async (req, res) =>
    res.json((await pool.query(
            'SELECT id, name, category, image, price_paise, units, stock, ingredients, allergens, weight_g, cost_paise, available FROM products WHERE NOT archived ORDER BY id')).rows)));

  // only the fields present in the body are validated and changed
  const clean = (b = {}) => {
    const o = {};
    if (b.name !== undefined) { o.name = str(b.name, 80); if (o.name.length < 2) fail(400, 'Enter an item name'); }
    if (b.category !== undefined) o.category = str(b.category, 30).toLowerCase() || 'cookie';
    if (b.image !== undefined) {
      o.image = b.image ? str(b.image, 300) : null;
      if (o.image && !/^(\/images\/\S+|https:\/\/res\.cloudinary\.com\/\S+)$/.test(o.image)) fail(400, 'Bad image');
    }
    if (b.price_paise !== undefined) { o.price_paise = Number(b.price_paise); if (!Number.isInteger(o.price_paise) || o.price_paise <= 0) fail(400, 'Enter a valid price'); }
    if (b.units !== undefined) { o.units = Number(b.units); if (!Number.isInteger(o.units) || o.units < 1 || o.units > 50) fail(400, 'Units must be 1 to 50'); }
    if (b.stock !== undefined) {
      o.stock = b.stock === null || b.stock === '' ? null : Number(b.stock);
      if (o.stock !== null && (!Number.isInteger(o.stock) || o.stock < 0 || o.stock > 100000)) fail(400, 'Stock must be a whole number');
    }
    
    if (b.ingredients !== undefined) o.ingredients = str(b.ingredients, 600) || null;
    if (b.allergens !== undefined) o.allergens = str(b.allergens, 200) || null;
    for (const [k, min] of [['weight_g', 1], ['cost_paise', 0]]) if (b[k] !== undefined) {
      o[k] = b[k] === null || b[k] === '' ? null : Number(b[k]);
      if (o[k] !== null && (!Number.isInteger(o[k]) || o[k] < min || o[k] > 100000)) fail(400, `Enter a valid ${k === 'weight_g' ? 'weight' : 'cost'}`);
    }

    if (b.available !== undefined) o.available = !!b.available;
    return o;
  };
  const dupe = e => { throw e.code === '23505' ? Object.assign(new Error('An item with that name already exists'), { status: 409 }) : e; };

  app.post('/api/admin/products', admin, h(async (req, res) => {
    const o = clean(req.body);
    if (o.name === undefined || o.price_paise === undefined) fail(400, 'Name and price are required');
    o.category ??= 'cookie';
    const keys = Object.keys(o);
    try {
      res.json((await pool.query(
        `INSERT INTO products (${keys.join(', ')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`, Object.values(o))).rows[0]);
    } catch (e) { dupe(e); }
  }));

  app.patch('/api/admin/products/:id', admin, h(async (req, res) => {
    const o = clean(req.body), keys = Object.keys(o);
    if (!keys.length) fail(400, 'Nothing to change');
    try {
      const r = await pool.query(
        `UPDATE products SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 AND NOT archived RETURNING *`,
        [intParam(req.params.id), ...Object.values(o)]);
      r.rowCount ? res.json(r.rows[0]) : fail(404, 'Not found');
    } catch (e) { dupe(e); }
  }));

  app.delete('/api/admin/products/:id', admin, h(async (req, res) => {
    const id = intParam(req.params.id);
    let r;
    try { r = await pool.query('DELETE FROM products WHERE id = $1 AND NOT archived RETURNING id', [id]); }
    catch (e) {
      if (e.code !== '23503') throw e;   // it has past orders: hide it instead, so order history stays intact
      r = await pool.query(
        "UPDATE products SET archived = true, available = false, name = name || ' (removed ' || id || ')' WHERE id = $1 AND NOT archived RETURNING id", [id]);
    }
    r.rowCount ? res.json({ ok: true }) : fail(404, 'Not found');
  }));

  // ---------- Cloudinary: the server signs, the browser uploads straight to Cloudinary ----------
  app.post('/api/admin/upload-signature', admin, h(async (req, res) => {
    const { CLOUDINARY_CLOUD_NAME: name, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
    if (!name || !key || !secret) fail(500, 'Cloudinary is not set up in backend/.env yet');
    const timestamp = Math.floor(Date.now() / 1000), folder = 'oliviabakes';
    const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${secret}`).digest('hex');
    res.json({ cloud_name: name, api_key: key, timestamp, folder, signature });
  }));

  // ---------- offers (banners on the home page) ----------
  const offerBody = b => {
    const title = str(b?.title, 60);
    if (!title) fail(400, 'Enter an offer title');
    return [title, str(b?.subtitle, 120), b?.active !== false];
  };
  app.get('/api/offers', h(async (req, res) =>
    res.json((await pool.query('SELECT id, title, subtitle, terms, cta FROM offers WHERE active ORDER BY sort, id')).rows)));
  app.get('/api/admin/offers', admin, h(async (req, res) =>
    res.json((await pool.query('SELECT id, title, subtitle, active FROM offers ORDER BY sort, id')).rows)));
  app.post('/api/admin/offers', admin, h(async (req, res) =>
    res.json((await pool.query('INSERT INTO offers (title, subtitle, active) VALUES ($1,$2,$3) RETURNING *', offerBody(req.body))).rows[0])));
  app.put('/api/admin/offers/:id', admin, h(async (req, res) => {
    const r = await pool.query('UPDATE offers SET title = $2, subtitle = $3, active = $4 WHERE id = $1 RETURNING *', [intParam(req.params.id), ...offerBody(req.body)]);
    r.rowCount ? res.json(r.rows[0]) : fail(404, 'Not found');
  }));
  app.delete('/api/admin/offers/:id', admin, h(async (req, res) => {
    const r = await pool.query('DELETE FROM offers WHERE id = $1', [intParam(req.params.id)]);
    r.rowCount ? res.json({ ok: true }) : fail(404, 'Not found');
  }));

  return { admin, loadUser, seedAdmin };
};