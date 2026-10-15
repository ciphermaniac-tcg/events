-- When each Clerk user's password last changed, as far as either Clerk's
-- webhook or a sign-in has told us (ms); only ever moved forward. A session
-- of ours whose sign-in was proven before it is ended, and none is made
-- (functions/lib/auth/clerk.ts, session.ts). `sessions.auth_at` is when a
-- session's sign-in was proven; sessions from before this keep NULL, read as
-- when they were made. Run once, after 0029.
CREATE TABLE IF NOT EXISTS clerk_password_cutoffs (
  subject TEXT PRIMARY KEY,
  changed_at INTEGER NOT NULL
) WITHOUT ROWID;
ALTER TABLE sessions ADD COLUMN auth_at INTEGER;
