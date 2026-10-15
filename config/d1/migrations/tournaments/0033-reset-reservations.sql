-- Rate limits on password reset (functions/lib/auth/passwordReset.ts): one
-- row per request an address (its hash) made, or per code an account (its
-- Clerk user) was sent, kept an hour so each counts for its whole window.
-- Run once, after 0032.
CREATE TABLE IF NOT EXISTS reset_reservations (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reset_reservations_by_key ON reset_reservations (scope, key, at);
