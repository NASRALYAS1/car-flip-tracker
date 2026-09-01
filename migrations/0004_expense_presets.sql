-- Quick-add templates for common expenses (fuel, car wash, etc.) so they
-- don't have to be typed out every time. Managed from Settings, not
-- hardcoded, since what's "common" differs per business.

CREATE TABLE expense_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  default_amount INTEGER NOT NULL,
  default_currency TEXT NOT NULL CHECK (default_currency IN ('USD','IQD')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO expense_presets (description, default_amount, default_currency, sort_order) VALUES
  ('تعبئة بانزين', 1900000, 'IQD', 1),
  ('غسلة سيارة', 500000, 'IQD', 2);
