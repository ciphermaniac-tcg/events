-- When a password reset request was claimed for setting its account's
-- password (functions/lib/auth/passwordReset.ts): one submission at a time
-- per account, released if Clerk does not set it. Run once, after 0031.
ALTER TABLE password_resets ADD COLUMN claimed_at INTEGER;
