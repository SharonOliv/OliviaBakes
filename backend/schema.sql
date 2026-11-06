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

-- Accounts: customers and the owner (role 'admin')
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL, phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Deleted" items that have past orders are archived instead, so order history stays intact
ALTER TABLE products ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true, sort INT NOT NULL DEFAULT 0
);
INSERT INTO offers (title, subtitle, sort)
SELECT * FROM (VALUES
  ('Free delivery', 'On orders above Rs 499', 1),
  ('Baked to order', 'Order 24 hours ahead for the freshest batch', 2),
  ('Pay on delivery', 'Cash or UPI at your door', 3)
) AS v(title, subtitle, sort)
WHERE NOT EXISTS (SELECT 1 FROM offers);

-- Uploaded product photos (stored in the database, so they survive redeploys and never go in GitHub)
CREATE TABLE IF NOT EXISTS images (
  id SERIAL PRIMARY KEY,
  mime TEXT NOT NULL, data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id);
-- stock per item (NULL = not tracked, unlimited)
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INT CHECK (stock >= 0);

CREATE TABLE IF NOT EXISTS addresses (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Home',
  address TEXT NOT NULL CHECK (length(trim(address)) >= 8),
  pincode TEXT NOT NULL CHECK (pincode ~ '^[0-9]{6}$'),
  is_default BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS favourites (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, product_id)
);

-- LISTEN/NOTIFY removed
DROP TRIGGER IF EXISTS t_products ON products;
DROP TRIGGER IF EXISTS t_orders ON orders;
DROP FUNCTION IF EXISTS notify_change();

-- item details (customers see these; cost_paise is for the owner only)
ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS allergens TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_g INT CHECK (weight_g > 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_paise INT CHECK (cost_paise >= 0);

-- per-item limit for one delivery day; no row = unlimited
CREATE TABLE IF NOT EXISTS item_day_limits (
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  max_qty INT NOT NULL CHECK (max_qty >= 0),
  PRIMARY KEY (product_id, day)
);

-- password reset links (only a hash of the token is stored)
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- more delivery pincodes (Vijayawada). Rename the areas and change the fees to suit you.
INSERT INTO service_areas (pincode, area_name, delivery_paise) VALUES
('520001','Vijayawada',3000),('520002','Vijayawada',3000),('520003','Vijayawada',3000),
('520004','Vijayawada',4000),('520007','Vijayawada',4000),('520008','Vijayawada',4000),
('520011','Vijayawada',4000),('520012','Vijayawada',5000),('520013','Vijayawada',5000)
ON CONFLICT (pincode) DO NOTHING;
UPDATE service_areas SET area_name = 'Vijayawada' WHERE area_name LIKE 'Sample area%';

-- SAMPLE details for the starter cookies. Check them against your own recipes before real customers see them.
UPDATE products p SET ingredients = v.i, allergens = v.a, weight_g = v.w
FROM (VALUES
 ('Chocolate Chunk Cookie','Wheat flour, butter, brown sugar, sugar, eggs, dark chocolate chunks, vanilla, baking soda, salt','Gluten (wheat), milk, eggs, soy',90),
 ('Double Chocolate Cookie','Wheat flour, butter, sugar, eggs, cocoa, dark chocolate chunks, vanilla, baking soda, salt','Gluten (wheat), milk, eggs, soy',90),
 ('Strawberry Cream Cookie','Wheat flour, butter, sugar, eggs, white chocolate, freeze-dried strawberry, vanilla, baking soda, salt','Gluten (wheat), milk, eggs, soy',85),
 ('Oatmeal Raisin Cookie','Rolled oats, wheat flour, butter, brown sugar, eggs, raisins, cinnamon, baking soda, salt','Gluten (wheat, oats), milk, eggs',80),
 ('Sea Salt Caramel Cookie','Wheat flour, butter, brown sugar, eggs, caramel, sea salt, vanilla, baking soda','Gluten (wheat), milk, eggs',90)
) AS v(n, i, a, w) WHERE p.name = v.n AND p.ingredients IS NULL;

-- demo pincode: lets anyone get through checkout while the site is a demo
INSERT INTO service_areas (pincode, area_name, delivery_paise) VALUES ('000000', 'Demo area', 4000)
ON CONFLICT (pincode) DO NOTHING;