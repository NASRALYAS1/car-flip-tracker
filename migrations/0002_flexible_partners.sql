-- Makes the partner model flexible: any number of partners, managed from
-- inside the app instead of being hardcoded to two and set up via CLI.

ALTER TABLE users ADD COLUMN profit_split_pct REAL NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- if this instance already had the old two fixed partners, carry their
-- names' intent forward as an even split so profit totals stay sane
UPDATE users SET profit_split_pct = 100.0 / (SELECT COUNT(*) FROM users WHERE is_active = 1);

-- these are replaced by the users table (display_name, profit_split_pct)
DELETE FROM settings WHERE key IN ('partner_a_name', 'partner_b_name', 'split_pct_partner_a');
