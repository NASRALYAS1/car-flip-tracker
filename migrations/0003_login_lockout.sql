-- Basic brute-force protection: lock a username out for a while after too
-- many wrong passwords in a row, instead of allowing unlimited guesses.

ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
