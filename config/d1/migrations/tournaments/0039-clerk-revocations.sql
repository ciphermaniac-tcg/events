-- Clerk users Clerk has shut out, keyed by the subject a Clerk token names: a
-- site session is not made while one stands, and the webhook's own batch ends
-- any made already (functions/lib/auth/clerkWebhook.ts). `revoked_at` and
-- `allowed_at` order deliveries, so a retried older event cannot undo a newer
-- one; `terminal` is set for a deletion, which no later allow clears. Run
-- once, after 0038.
CREATE TABLE IF NOT EXISTS clerk_revocations (
  subject TEXT PRIMARY KEY,
  revoked_at INTEGER NOT NULL,
  allowed_at INTEGER NOT NULL DEFAULT 0,
  terminal INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
