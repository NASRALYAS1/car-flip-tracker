-- A partner's own private record of debts with people outside the business
-- (customers, friends, old debts that predate this app) -- separate from
-- the shared partner_loans table, which is between the partners themselves
-- and visible to everyone. owner_user_id is never taken from the client,
-- only ever set from the logged-in session, so one partner can never read
-- or edit another partner's rows here.
CREATE TABLE personal_debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('they_owe_me', 'i_owe_them')),
  person_name TEXT NOT NULL,
  person_phone TEXT,
  person_address TEXT,
  reason TEXT,
  notes TEXT,
  amount_amount INTEGER NOT NULL,
  amount_currency TEXT NOT NULL CHECK (amount_currency IN ('USD','IQD')),
  amount_exchange_rate REAL,
  amount_usd_cents INTEGER NOT NULL,
  debt_date TEXT NOT NULL,
  is_settled INTEGER NOT NULL DEFAULT 0,
  settled_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_personal_debts_owner ON personal_debts(owner_user_id);
