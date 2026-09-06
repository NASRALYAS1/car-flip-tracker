-- personal_debts was each partner's own private ledger, hidden from the
-- other partners. It's now one shared list the whole business keeps: who
-- owes the dealership money and who the dealership owes. Everything the
-- table held stays; what changes is who can see it.
--
-- Rebuilt rather than ALTERed because three things change at once and two of
-- them can't be done in place: the direction values stop being about "me"
-- and start being about "us", and owner_user_id (a privacy boundary, cascade
-- deleted with its partner) becomes recorded_by (an audit note, kept even if
-- that partner ever goes away — the debt is the business's, not theirs).
CREATE TABLE people_debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('they_owe_us', 'we_owe_them')),
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

INSERT INTO people_debts (
  id, recorded_by, direction, person_name, person_phone, person_address,
  reason, notes, amount_amount, amount_currency, amount_exchange_rate,
  amount_usd_cents, debt_date, is_settled, settled_date, created_at
)
SELECT
  id, owner_user_id,
  CASE direction WHEN 'they_owe_me' THEN 'they_owe_us' ELSE 'we_owe_them' END,
  person_name, person_phone, person_address,
  reason, notes, amount_amount, amount_currency, amount_exchange_rate,
  amount_usd_cents, debt_date, is_settled, settled_date, created_at
FROM personal_debts;

DROP TABLE personal_debts;

CREATE INDEX idx_people_debts_settled ON people_debts(is_settled, debt_date);
