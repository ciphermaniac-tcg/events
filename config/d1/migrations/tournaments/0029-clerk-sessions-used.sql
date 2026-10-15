-- Clerk sessions whose token has been exchanged for one of ours
-- (functions/lib/auth/clerk.ts): each is exchanged once, however close
-- together two tries come. Kept a day, far past any token of the session.
-- Run once, after 0028.
CREATE TABLE IF NOT EXISTS clerk_sessions_used (
  session_id TEXT PRIMARY KEY,
  used_at INTEGER NOT NULL
) WITHOUT ROWID;
