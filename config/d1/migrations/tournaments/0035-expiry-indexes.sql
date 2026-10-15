-- What lets the expiry sweeps password reset and the Clerk exchange run with
-- each request (functions/lib/auth/passwordReset.ts, clerk.ts) find the rows
-- that have run out, instead of reading every account's. Run once, after 0034.
CREATE INDEX IF NOT EXISTS clerk_sessions_used_by_time ON clerk_sessions_used (used_at);
CREATE INDEX IF NOT EXISTS password_resets_by_expiry ON password_resets (expires_at);
CREATE INDEX IF NOT EXISTS reset_reservations_by_time ON reset_reservations (at);
