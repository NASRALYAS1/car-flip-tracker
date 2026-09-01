-- Car Flip Tracker — initial schema

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outgoing_car_id INTEGER NOT NULL,
  incoming_car_id INTEGER NOT NULL UNIQUE,
  cash_adjustment_amount INTEGER NOT NULL DEFAULT 0,
  cash_adjustment_currency TEXT CHECK (cash_adjustment_currency IN ('USD','IQD')),
  cash_adjustment_exchange_rate REAL,
  cash_adjustment_usd_cents INTEGER NOT NULL DEFAULT 0,
  other_party_name TEXT,
  other_party_contact TEXT,
  trade_date TEXT NOT NULL,
  notes TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_trades_outgoing ON trades(outgoing_car_id);
CREATE INDEX idx_trades_incoming ON trades(incoming_car_id);

CREATE TABLE cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER,
  vin TEXT,
  color TEXT,
  mileage INTEGER,
  purchase_date TEXT NOT NULL,
  purchase_price_amount INTEGER NOT NULL,
  purchase_price_currency TEXT NOT NULL CHECK (purchase_price_currency IN ('USD','IQD')),
  purchase_price_exchange_rate REAL,
  purchase_price_usd_cents INTEGER NOT NULL,
  seller_name TEXT,
  seller_contact TEXT,
  condition_notes TEXT,
  status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','sold','traded','archived')),
  acquired_via_trade_id INTEGER REFERENCES trades(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cars_status ON cars(status);

CREATE TABLE car_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photos_car ON car_photos(car_id);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount_amount INTEGER NOT NULL,
  amount_currency TEXT NOT NULL CHECK (amount_currency IN ('USD','IQD')),
  amount_exchange_rate REAL,
  amount_usd_cents INTEGER NOT NULL,
  category TEXT,
  expense_date TEXT NOT NULL,
  added_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expenses_car ON expenses(car_id);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL UNIQUE REFERENCES cars(id) ON DELETE CASCADE,
  sale_type TEXT NOT NULL DEFAULT 'cash' CHECK (sale_type IN ('cash','installment')),
  sale_date TEXT NOT NULL,
  sale_price_amount INTEGER NOT NULL,
  sale_price_currency TEXT NOT NULL CHECK (sale_price_currency IN ('USD','IQD')),
  sale_price_exchange_rate REAL,
  sale_price_usd_cents INTEGER NOT NULL,
  down_payment_amount INTEGER,
  down_payment_currency TEXT CHECK (down_payment_currency IN ('USD','IQD')),
  down_payment_exchange_rate REAL,
  down_payment_usd_cents INTEGER DEFAULT 0,
  planned_monthly_installment_usd_cents INTEGER,
  buyer_name TEXT,
  buyer_contact TEXT,
  notes TEXT,
  sold_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE installment_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  amount_amount INTEGER NOT NULL,
  amount_currency TEXT NOT NULL CHECK (amount_currency IN ('USD','IQD')),
  amount_exchange_rate REAL,
  amount_usd_cents INTEGER NOT NULL,
  received_by INTEGER NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_installments_sale ON installment_payments(sale_id);

CREATE TABLE partner_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lender_user_id INTEGER NOT NULL REFERENCES users(id),
  borrower_user_id INTEGER NOT NULL REFERENCES users(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('loan','repayment')),
  amount_amount INTEGER NOT NULL,
  amount_currency TEXT NOT NULL CHECK (amount_currency IN ('USD','IQD')),
  amount_exchange_rate REAL,
  amount_usd_cents INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  notes TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIEW car_profit AS
SELECT
  c.id AS car_id,
  c.purchase_price_usd_cents,
  COALESCE(SUM(e.amount_usd_cents), 0) AS total_expenses_usd_cents,
  s.sale_price_usd_cents,
  CASE WHEN s.sale_price_usd_cents IS NOT NULL
    THEN s.sale_price_usd_cents - c.purchase_price_usd_cents - COALESCE(SUM(e.amount_usd_cents), 0)
    ELSE NULL END AS profit_usd_cents
FROM cars c
LEFT JOIN expenses e ON e.car_id = c.id
LEFT JOIN sales s ON s.car_id = c.id
GROUP BY c.id;

INSERT INTO settings (key, value) VALUES
  ('partner_a_name', 'الشريك الأول'),
  ('partner_b_name', 'الشريك الثاني'),
  ('split_pct_partner_a', '50'),
  ('last_exchange_rate', '1310'),
  ('business_name', 'تجارة السيارات');
