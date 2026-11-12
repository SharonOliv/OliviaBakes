/*It starts the API, or targets one via API_URL. 
It checks auth, admin-only access, a concurrency test (5 parallel orders for 1 item in stock, exactly one must succeed) 
and a signed Stripe webhook.*/

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const EXTERNAL = process.env.API_URL;                       // set when the API already runs (e.g. inside Kubernetes)
const BASE = EXTERNAL || 'http://localhost:3100';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@test.local', password: process.env.ADMIN_PASSWORD || 'AdminPass123' };
const WH_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';
const day = new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const api = async (method, url, { token, body } = {}) => {
  const r = await fetch(BASE + url, {
    method, body: body && JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) },
  });
  return { status: r.status, data: await r.json().catch(() => null) };
};

// WARNING: these tests create users and items. Run them only against a throwaway database.
describe('OliviaBakes API', () => {
  let child, admin, customer, item, orderId;
  const stamp = Date.now();

  before(async () => {
    if (!EXTERNAL) child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'), stdio: 'inherit',
      env: { ...process.env, PORT: '3100', DB_SSL: 'off', JWT_SECRET: 'test-secret', ADMIN_EMAIL: ADMIN.email,
             ADMIN_PASSWORD: ADMIN.password, STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: WH_SECRET },
    });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(BASE + '/healthz')).ok) return; } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('API did not become ready');
  });
  after(() => child?.kill());

  it('is healthy and lists products', async () => {
    assert.equal((await api('GET', '/healthz')).status, 200);
    const r = await api('GET', '/api/products');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data));
  });

  it('signs up, logs in, and returns the profile', async () => {
    const email = `buyer${stamp}@test.local`;
    assert.equal((await api('POST', '/api/auth/signup', { body: { name: 'Test Buyer', phone: '9000000099', email, password: 'Password123' } })).status, 200);
    assert.equal((await api('POST', '/api/auth/login', { body: { email, password: 'wrong-password' } })).status, 401);
    const l = await api('POST', '/api/auth/login', { body: { email, password: 'Password123' } });
    assert.equal(l.status, 200);
    customer = l.data.token;
    const me = await api('GET', '/api/auth/me', { token: customer });
    assert.equal(me.data.email, email);
    assert.equal(me.data.role, 'customer');
  });

  it('keeps admin routes admin-only', async () => {
    assert.equal((await api('GET', '/api/admin/orders')).status, 401);
    assert.equal((await api('GET', '/api/admin/orders', { token: customer })).status, 403);
    const l = await api('POST', '/api/auth/login', { body: ADMIN });
    assert.equal(l.status, 200);
    assert.equal(l.data.user.role, 'admin');
    admin = l.data.token;
  });

  it('lets the admin create an item with stock 1', async () => {
    const r = await api('POST', '/api/admin/products', { token: admin, body: { name: `Test cookie ${stamp}`, price_paise: 10000, stock: 1 } });
    assert.equal(r.status, 200);
    item = r.data;
  });

  it('never oversells: 5 parallel orders for 1 item in stock, exactly 1 succeeds', async () => {
    const order = () => api('POST', '/api/orders', { token: customer, body: {
      customer: 'Test Buyer', phone: '9000000099', address: '12 Test Street, Vijayawada', pincode: '000000',
      delivery_date: day, delivery_slot: 'evening', payment: 'cod', items: [{ id: item.id, qty: 1 }] } });
    const res = await Promise.all(Array.from({ length: 5 }, order));
    assert.deepEqual(res.map(r => r.status).sort(), [200, 409, 409, 409, 409]);
    orderId = res.find(r => r.status === 200).data.id;
    const list = await api('GET', '/api/admin/products', { token: admin });
    assert.equal(list.data.find(p => p.id === item.id).stock, 0);
  });

  it('marks the order paid from a signed Stripe webhook and rejects a bad signature', async () => {
    const stripe = require('stripe')('sk_test_dummy');
    const payload = JSON.stringify({ id: 'evt_test', object: 'event', type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', payment_status: 'paid', metadata: { order_id: String(orderId) } } } });
    const post = sig => fetch(BASE + '/api/stripe/webhook', { method: 'POST', body: payload,
      headers: { 'content-type': 'application/json', 'stripe-signature': sig } });
    assert.equal((await post('t=1,v1=bad')).status, 400);
    assert.equal((await post(stripe.webhooks.generateTestHeaderString({ payload, secret: WH_SECRET }))).status, 200);
    const orders = await api('GET', `/api/admin/orders?date=${day}`, { token: admin });
    assert.equal(orders.data.find(o => o.id === orderId).payment_status, 'paid');
  });

    // ---- added for offers, customer cancel, daily limits and password reset ----
  const place = (token, itemId, qty = 1, payment = 'cod') => api('POST', '/api/orders', { token, body: {
    customer: 'Test Buyer', phone: '9000000098', address: '12 Test Street, Vijayawada', pincode: '000000',
    delivery_date: day, delivery_slot: 'evening', payment, items: [{ id: itemId, qty }] } });
  const signup = async name => {
    const r = await api('POST', '/api/auth/signup', { body: { name: 'Test ' + name, phone: '9000000098', email: `${name}${stamp}@test.local`, password: 'Password123' } });
    assert.equal(r.status, 200);
    return r.data.token;
  };
  const stockOf = async id => (await api('GET', '/api/admin/products', { token: admin })).data.find(p => p.id === id).stock;

  it('applies the ₹200 first-order offer once, then 5% on card payments', async () => {
    const buyer = await signup('offers');
    const big = (await api('POST', '/api/admin/products', { token: admin, body: { name: `Big box ${stamp}`, price_paise: 70000, stock: 20 } })).data;
    const eligible = payment => api('GET', `/api/offers/eligible?subtotal=70000&payment=${payment}`, { token: buyer });

    assert.equal((await eligible('cod')).data.applied.discount, 20000);          // first order: flat ₹200
    const first = await place(buyer, big.id, 1, 'cod');
    assert.equal(first.status, 200);
    assert.equal(first.data.total_paise, 70000 - 20000);                          // free delivery above ₹499

    assert.equal((await eligible('cod')).data.applied, null);                     // first-order offer is used up
    assert.equal((await eligible('card')).data.applied.discount, 3500);           // 5% of ₹700
    const second = await place(buyer, big.id, 1, 'card');
    assert.equal(second.data.total_paise, 70000 - 3500);
  });

  it('lets a customer cancel before confirmation and gives the stock back', async () => {
    const buyer = await signup('canceller'), stranger = await signup('stranger');
    const cookie = (await api('POST', '/api/admin/products', { token: admin, body: { name: `Cancel cookie ${stamp}`, price_paise: 10000, stock: 2 } })).data;
    const cancel = (token, order) => api('POST', `/api/orders/${order.data.public_token}/cancel`, { token, body: {} });

    const o = await place(buyer, cookie.id);
    assert.equal(o.status, 200);
    assert.equal(await stockOf(cookie.id), 1);
    assert.equal((await cancel(stranger, o)).status, 404);                        // not their order
    assert.equal((await cancel(buyer, o)).status, 200);
    assert.equal(await stockOf(cookie.id), 2);                                    // stock came back
    assert.equal((await cancel(buyer, o)).status, 409);                           // already cancelled

    const o2 = await place(buyer, cookie.id);
    assert.equal((await api('POST', `/api/admin/orders/${o2.data.id}/status`, { token: admin, body: { status: 'confirmed' } })).status, 200);
    assert.equal((await cancel(buyer, o2)).status, 409);                          // confirmed: too late
  });

  it('respects a per-item daily limit under parallel orders', async () => {
    const buyer = await signup('limiter');
    const limited = (await api('POST', '/api/admin/products', { token: admin, body: { name: `Limited ${stamp}`, price_paise: 10000 } })).data;
    assert.equal((await api('PUT', '/api/admin/capacity', { token: admin, body: { date: day, product_id: limited.id, max_qty: 1 } })).status, 200);
    const res = await Promise.all(Array.from({ length: 3 }, () => place(buyer, limited.id)));
    assert.deepEqual(res.map(r => r.status).sort(), [200, 409, 409]);
    assert.match(res.find(r => r.status === 409).data.error, /only 0 left/);
  });

  it('protects payment routes and does not reveal which emails exist', async () => {
    assert.equal((await api('POST', '/api/orders/00000000-0000-0000-0000-000000000000/checkout')).status, 401);
    assert.equal((await api('POST', '/api/auth/forgot', { body: { email: `nobody${stamp}@test.local` } })).status, 200);
    assert.equal((await api('POST', '/api/auth/reset', { body: { token: 'not-a-real-token', password: 'Password123' } })).status, 400);
  });
  
});