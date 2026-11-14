-- The native app's sign-in through the system browser
-- (functions/lib/auth/appTicket.ts): the provider's answer, under the
-- SHA-256 of a one-minute ticket the browser hands the app, with the
-- challenge the app's verifier must match. Taken out once, by the redeem.
-- Run once, after 0042.
CREATE TABLE IF NOT EXISTS app_sign_in_tickets (
  ticket_hash TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  profile TEXT NOT NULL,
  next TEXT NOT NULL,
  linking INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS app_sign_in_tickets_by_expiry ON app_sign_in_tickets (expires_at);
