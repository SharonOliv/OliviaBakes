const express = require('express');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = (app, pool, { h, fail, tx, loadUser }) => {
  const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
  //const APP_URL = process.env.APP_URL || 'http://localhost:4200';
    let APP_URL = (process.env.APP_URL || 'http://localhost:4200').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(APP_URL)) APP_URL = (/^localhost/i.test(APP_URL) ? 'http://' : 'https://') + APP_URL;   // add a missing scheme

  // Customer pays for their own order: creates a Stripe Checkout page and returns its URL.
    app.post('/api/orders/:token/checkout', h(async (req, res) => {
    if (!stripe) fail(503, 'Online payments are not set up yet');
    const u = await loadUser(req);
    if (!u) fail(401, 'Please log in');
    if (!UUID.test(req.params.token)) fail(404, 'Not found');
    const o = (await pool.query('SELECT * FROM orders WHERE public_token = $1 AND user_id = $2', [req.params.token, u.id])).rows[0];
    if (!o) fail(404, 'Not found');
    if (o.payment_status === 'paid') fail(409, 'This order is already paid');
    if (!o.total_paise || ['cancelled', 'delivered', 'requested'].includes(o.status)) fail(409, 'This order cannot be paid right now');

    const items = (await pool.query(
      'SELECT p.name, oi.qty, oi.price_paise FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1', [o.id])).rows;
    const line = (name, amount, qty = 1) => ({ quantity: qty, price_data: { currency: 'inr', unit_amount: amount, product_data: { name } } });
    const lines = items.length ? items.map(i => line(i.name, i.price_paise, i.qty)) : [line('Custom cake', o.subtotal_paise)];
    if (o.delivery_paise > 0) lines.push(line('Delivery', o.delivery_paise));

    // Where Stripe sends the customer back: the page they came from, if it is an address we trust
    const origin = req.get('origin');
    const trusted = origin && (/^http:\/\/localhost:\d+$/.test(origin) || origin === process.env.CORS_ORIGIN || origin === APP_URL);
    const back = (trusted ? origin : APP_URL) + '/track/' + o.public_token;
    console.log('Stripe return URL:', JSON.stringify(back));

    let s;
    try {
      let discounts;
      if (o.discount_paise > 0) {            // the offer discount, as a one-time Stripe coupon
        const coupon = await stripe.coupons.create({ amount_off: o.discount_paise, currency: 'inr', duration: 'once', name: 'Offer discount' });
        discounts = [{ coupon: coupon.id }];
      }
      s = await stripe.checkout.sessions.create({
        mode: 'payment', line_items: lines, discounts, customer_email: o.email || undefined,
        client_reference_id: String(o.id), metadata: { order_id: String(o.id) },
        expires_at: Math.floor(Date.now() / 1000) + 40 * 60,
        success_url: back + '?paid=1',
        cancel_url: back,
      });
    } catch (e) {
      console.error('Stripe error:', e.type, e.message);
      fail(502, 'Stripe error: ' + e.message);
    }
    await pool.query("UPDATE orders SET payment = 'card', stripe_session_id = $2 WHERE id = $1", [o.id, s.id]);
    res.json({ url: s.url });
  }));

  // Stripe tells us the outcome. The signature check proves the call really came from Stripe.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), h(async (req, res) => {
    if (!stripe) fail(503, 'Not configured');
    let ev;
    try { ev = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET); }
    catch { return res.status(400).send('Bad signature'); }
    const s = ev.data.object, id = Number(s.metadata?.order_id);

    if (id && ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type) && s.payment_status === 'paid')
      await pool.query("UPDATE orders SET payment_status = 'paid', payment = 'card' WHERE id = $1 AND status <> 'cancelled'", [id]);

    if (id && ev.type === 'checkout.session.expired')            // never paid: cancel and give the stock back
      await tx(async db => {
        const o = (await db.query('SELECT status, payment, payment_status, stripe_session_id FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!o || o.payment !== 'card' || o.payment_status === 'paid' || o.stripe_session_id !== s.id || ['cancelled', 'delivered'].includes(o.status)) return;
        await db.query(
          `UPDATE products p SET stock = p.stock + oi.qty FROM order_items oi
           WHERE oi.order_id = $1 AND oi.product_id = p.id AND p.stock IS NOT NULL`, [id]);
        await db.query("UPDATE orders SET status = 'cancelled', owner_note = 'Payment was not completed in time.' WHERE id = $1", [id]);
      });
    res.json({ received: true });
  }));
    // Customer cancels their own order, but only until the owner confirms it.
  app.post('/api/orders/:token/cancel', h(async (req, res) => {
    const u = await loadUser(req);
    if (!u) fail(401, 'Please log in');
    if (!UUID.test(req.params.token)) fail(404, 'Not found');

    const o = await tx(async db => {
      const r = (await db.query('SELECT * FROM orders WHERE public_token = $1 AND user_id = $2 FOR UPDATE', [req.params.token, u.id])).rows[0];
      if (!r) fail(404, 'Not found');
      const cancellable = r.kind === 'custom' ? ['requested', 'quoted'] : ['placed'];
      if (!cancellable.includes(r.status))
        fail(409, r.status === 'cancelled' ? 'This order is already cancelled.' : "This order has already been confirmed, so it can't be cancelled here. Please contact us.");
      await db.query(                      // give the stock back
        `UPDATE products p SET stock = p.stock + oi.qty FROM order_items oi
         WHERE oi.order_id = $1 AND oi.product_id = p.id AND p.stock IS NOT NULL`, [r.id]);
      await db.query("UPDATE orders SET status = 'cancelled', owner_note = 'Cancelled by the customer.' WHERE id = $1", [r.id]);
      return r;
    });

    let refunded = false;
    if (stripe && o.payment === 'card' && o.stripe_session_id) {
      if (o.payment_status === 'paid') {
        try {
          const s = await stripe.checkout.sessions.retrieve(o.stripe_session_id);
          await stripe.refunds.create({ payment_intent: s.payment_intent });
          await pool.query("UPDATE orders SET payment_status = 'refunded' WHERE id = $1", [o.id]);
          refunded = true;
        } catch (e) {
          console.error('Refund failed for order', o.id, e.message);
          await pool.query("UPDATE orders SET owner_note = 'Cancelled by the customer. REFUND NEEDS MANUAL ACTION.' WHERE id = $1", [o.id]);
        }
      } else {
        await stripe.checkout.sessions.expire(o.stripe_session_id).catch(() => {});   // so the open payment page can't be paid later
      }
    }
    res.json({ ok: true, refunded });
  }));
};