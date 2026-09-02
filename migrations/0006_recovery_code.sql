-- A break-glass credential shown once when a partner account is created,
-- so someone can get back in if they forget their password without any
-- other partner having to be around to reset it for them (or, in a
-- single-partner shop, without being locked out entirely).
ALTER TABLE users ADD COLUMN recovery_code_hash TEXT;
