CREATE SEQUENCE IF NOT EXISTS ticket_seq MAXVALUE 99 CYCLE;

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  image TEXT,
  price_paise INT NOT NULL CHECK (price_paise > 0),
  stock INT NOT NULL CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  fulfilment TEXT NOT NULL DEFAULT 'pickup' CHECK (fulfilment IN ('pickup','delivery')),
  address TEXT,
  payment TEXT NOT NULL DEFAULT 'cod' CHECK (payment IN ('cod','upi','card')),
  note TEXT,
  subtotal_paise INT NOT NULL,
  delivery_paise INT NOT NULL DEFAULT 0,
  total_paise INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','preparing','ready','collected')),
  ticket INT NOT NULL DEFAULT nextval('ticket_seq'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT delivery_needs_address CHECK (fulfilment = 'pickup' OR COALESCE(length(trim(address)), 0) >= 8)
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id INT REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  qty INT NOT NULL CHECK (qty > 0),
  price_paise INT NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);

-- Real-time: every change sends a notification
CREATE OR REPLACE FUNCTION notify_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('olive', json_build_object('table', TG_TABLE_NAME, 'op', TG_OP,
    'id', NEW.id, 'status', to_jsonb(NEW)->>'status', 'stock', to_jsonb(NEW)->>'stock')::text);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS t_products ON products;
CREATE TRIGGER t_products AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION notify_change();
DROP TRIGGER IF EXISTS t_orders ON orders;
CREATE TRIGGER t_orders AFTER INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION notify_change();

-- Analytics: bestsellers ranked with a window function
CREATE OR REPLACE VIEW bestsellers AS
SELECT p.name, COALESCE(SUM(oi.qty),0)::int AS sold,
       RANK() OVER (ORDER BY COALESCE(SUM(oi.qty),0) DESC) AS rank
FROM products p LEFT JOIN order_items oi ON oi.product_id = p.id
GROUP BY p.id;

-- Queue position per status
CREATE OR REPLACE VIEW order_queue AS
SELECT id, ticket, customer, status, created_at,
       (ROW_NUMBER() OVER (PARTITION BY status ORDER BY created_at, id))::int AS position
FROM orders
WHERE status IN ('queued','preparing','ready');

INSERT INTO products (name, category, image, price_paise, stock) VALUES
('Chocolate Chunk Cookie','cookie','/images/chocolate-chunk.jpg',14900,40),
('Double Chocolate Cookie','cookie','/images/double-chocolate.jpg',16900,35),
('Strawberry Cream Cookie','cookie','/images/strawberry-cream.jpg',17900,30),
('Oatmeal Raisin Cookie','cookie','/images/oatmeal-raisin.jpg',12900,35),
('Sea Salt Caramel Cookie','cookie','/images/salted-caramel.jpg',17900,30),
('Lemon Olive Oil Cake','cake','/images/lemon-cake.jpg',79900,12),
('Triple Chocolate Cake','cake','/images/chocolate-cake.jpg',99900,8),
('Butter Croissant','pastry','/images/croissant.jpg',11900,50),
('Cinnamon Roll','pastry','/images/cinnamon-roll.jpg',13900,30),
('Blueberry Muffin','pastry','/images/muffin.jpg',9900,45),
('Bread Loaf','bread','/images/bread.jpg',8900,25)
ON CONFLICT (name) DO NOTHING;