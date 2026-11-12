// Picks the best offer a customer qualifies for. Used by checkout (preview) and by order creation (the real price).
async function bestOffer(db, userId, subtotal, payment) {
  const { rows } = await db.query(
    `SELECT * FROM offers
     WHERE active AND discount_type IS NOT NULL AND min_order_paise <= $1
       AND (NOT card_only OR $2::text = 'card')
       AND (NOT first_order_only OR NOT EXISTS (SELECT 1 FROM orders WHERE user_id = $3 AND status <> 'cancelled'))`,
    [subtotal, payment, userId]);
  let best = null;
  for (const o of rows) {
    let d = o.discount_type === 'flat' ? o.discount_value : Math.round(subtotal * o.discount_value / 100);
    if (o.max_discount_paise) d = Math.min(d, o.max_discount_paise);
    d = Math.min(d, subtotal);
    if (d > 0 && (!best || d > best.discount)) best = { id: o.id, title: o.title, discount: d };
  }
  return best;
}

// What checkout shows: the offer that applies now, and a better one if the customer paid by card.
function mount(app, pool, { h, loadUser }) {
  app.get('/api/offers/eligible', h(async (req, res) => {
    const u = await loadUser(req);
    const subtotal = Math.max(0, Math.floor(Number(req.query.subtotal) || 0));
    const payment = req.query.payment === 'card' ? 'card' : 'cod';
    if (!u || !subtotal) return res.json({ applied: null, card: null });
    const applied = await bestOffer(pool, u.id, subtotal, payment);
    const card = payment === 'card' ? null : await bestOffer(pool, u.id, subtotal, 'card');
    res.json({ applied, card: card && (!applied || card.discount > applied.discount) ? card : null });
  }));
}

module.exports = { bestOffer, mount };