-- Two new ledgers.
--
-- profit_distributions records each time the partners sit down and take their
-- profit. lifetime_profit_usd_cents is the realized profit of the whole
-- business at that moment, so "profit since the last distribution" is simply
-- today's total minus the latest of these. Anything that changes the books
-- afterwards (a late expense, an installment arriving) lands in the next
-- distribution instead of rewriting one that has already been paid out.
--
-- previous_distribution_id chains them, and it is UNIQUE on purpose. If two
-- partners press distribute at the same moment, both requests are built on
-- the same previous distribution, and the second insert fails instead of
-- paying the same profit out twice. The first distribution uses 0.
--
-- profit_distribution_shares keeps each partner's cut exactly as it was paid,
-- with the percentage and the name at that time. Changing the split or
-- deactivating a partner later can no longer change what the past shows.
--
-- people_debt_payments lets a debt be repaid in parts instead of only being
-- marked settled in one go, with every part kept as its own record so the
-- amount originally owed is never overwritten.
CREATE TABLE profit_distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  previous_distribution_id INTEGER NOT NULL UNIQUE,
  distribution_date TEXT NOT NULL,
  lifetime_profit_usd_cents INTEGER NOT NULL,
  distributed_usd_cents INTEGER NOT NULL,
  notes TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE profit_distribution_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distribution_id INTEGER NOT NULL REFERENCES profit_distributions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  split_pct REAL NOT NULL,
  share_usd_cents INTEGER NOT NULL
);
CREATE INDEX idx_distribution_shares_distribution ON profit_distribution_shares(distribution_id);

CREATE TABLE people_debt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL REFERENCES people_debts(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  amount_amount INTEGER NOT NULL,
  amount_currency TEXT NOT NULL CHECK (amount_currency IN ('USD','IQD')),
  amount_exchange_rate REAL,
  amount_usd_cents INTEGER NOT NULL,
  notes TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_people_debt_payments_debt ON people_debt_payments(debt_id);
