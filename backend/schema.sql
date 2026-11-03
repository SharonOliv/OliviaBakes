-- OliviaBakes: online home bakery. Delivery only, baked to order.

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  image TEXT,
  price_paise INT NOT NULL CHECK (price_paise > 0),
  units INT NOT NULL DEFAULT 1 CHECK (units > 0),   -- baking effort; counts against the day's capacity
  available BOOLEAN NOT NULL DEFAULT true
);

-- Pincodes you deliver to. An order outside this list is rejected at checkout.
CREATE TABLE IF NOT EXISTS service_areas (
  pincode TEXT PRIMARY KEY CHECK (pincode ~ '^[0-9]{6}$'),
  area_name TEXT NOT NULL,
  delivery_paise INT NOT NULL DEFAULT 4000 CHECK (delivery_paise >= 0),
  active BOOLEAN NOT NULL DEFAULT true
);

-- How much you can bake for a delivery day. Rows are created on demand by the server.
CREATE TABLE IF NOT EXISTS day_capacity (
  day DATE PRIMARY KEY,
  max_units INT NOT NULL CHECK (max_units >= 0),
  used_units INT NOT NULL DEFAULT 0 CHECK (used_units >= 0 AND used_units <= max_units)
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  public_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,   -- used in tracking links instead of the id
  kind TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard','custom')),
  customer TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL CHECK (length(trim(address)) >= 8),
  pincode TEXT NOT NULL REFERENCES service_areas(pincode),
  delivery_date DATE NOT NULL,
  delivery_slot TEXT NOT NULL CHECK (delivery_slot IN ('morning','afternoon','evening')),
  payment TEXT NOT NULL DEFAULT 'cod' CHECK (payment IN ('cod','upi')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid')),
  note TEXT,
  custom_details JSONB,                    -- flavour, weight_kg, message, description (custom orders only)
  owner_note TEXT,                         -- message from you to the customer (shown on the tracking page)
  units_reserved INT NOT NULL DEFAULT 0 CHECK (units_reserved >= 0),
  subtotal_paise INT NOT NULL DEFAULT 0,
  delivery_paise INT NOT NULL DEFAULT 0,
  total_paise INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'placed' CHECK (status IN
    ('requested','quoted','placed','confirmed','baking','out_for_delivery','delivered','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT custom_has_details CHECK (kind = 'standard' OR custom_details IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id INT REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  qty INT NOT NULL CHECK (qty > 0),
  price_paise INT NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_delivery ON orders(delivery_date, status);

-- Real-time: every order/product change sends a small notification (no personal data in the payload)
CREATE OR REPLACE FUNCTION notify_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('olive', json_build_object('table', TG_TABLE_NAME, 'op', TG_OP,
    'id', NEW.id, 'status', to_jsonb(NEW)->>'status')::text);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS t_products ON products;
CREATE TRIGGER t_products AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION notify_change();
DROP TRIGGER IF EXISTS t_orders ON orders;
CREATE TRIGGER t_orders AFTER INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION notify_change();

-- Analytics: bestsellers ranked with a window function (cancelled orders don't count)
CREATE OR REPLACE VIEW bestsellers AS
SELECT p.name,
       COALESCE(SUM(oi.qty) FILTER (WHERE o.status <> 'cancelled'), 0)::int AS sold,
       (RANK() OVER (ORDER BY COALESCE(SUM(oi.qty) FILTER (WHERE o.status <> 'cancelled'), 0) DESC))::int AS rank
FROM products p
LEFT JOIN order_items oi ON oi.product_id = p.id
LEFT JOIN orders o ON o.id = oi.order_id
GROUP BY p.id;

-- Replace this with the pincodes you actually deliver to.
INSERT INTO service_areas (pincode, area_name, delivery_paise) VALUES
('520010', 'Sample area - replace with yours', 4000)
ON CONFLICT (pincode) DO NOTHING;

INSERT INTO products (name, category, image, price_paise, units) VALUES
('Chocolate Chunk Cookie','cookie','/images/chocolate-chunk.jpg',14900,1),
('Double Chocolate Cookie','cookie','/images/double-chocolate.jpg',16900,1),
('Strawberry Cream Cookie','cookie','/images/strawberry-cream.jpg',17900,1),
('Oatmeal Raisin Cookie','cookie','/images/oatmeal-raisin.jpg',12900,1),
('Sea Salt Caramel Cookie','cookie','/images/salted-caramel.jpg',17900,1),
('Lemon Olive Oil Cake','cake','/images/lemon-cake.jpg',79900,6),
('Triple Chocolate Cake','cake','/images/chocolate-cake.jpg',99900,8),
('Butter Croissant','pastry','/images/croissant.jpg',11900,1),
('Cinnamon Roll','pastry','/images/cinnamon-roll.jpg',13900,1),
('Blueberry Muffin','pastry','/images/muffin.jpg',9900,1),
('Bread Loaf','bread','/images/bread.jpg',8900,2)
ON CONFLICT (name) DO NOTHING;