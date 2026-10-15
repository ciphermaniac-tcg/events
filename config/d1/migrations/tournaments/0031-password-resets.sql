-- Password reset requests (functions/lib/auth/passwordReset.ts), under the
-- hash of the token in the asker's cookie: the Clerk user and the hash of the
-- code emailed, once one is, or NULL for a request that named no one; the
-- tries taken; and when it was made and runs out. Run once, after 0030.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  subject TEXT,
  code_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS password_resets_by_subject ON password_resets (subject, created_at);
