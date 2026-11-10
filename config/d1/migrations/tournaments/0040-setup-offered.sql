-- When an account was offered its username and name: a new one at its age
-- check, one made before this once at a later visit (functions/api/me/setup.ts).
-- NULL until then. Run once, after 0039.
ALTER TABLE users ADD COLUMN setup_offered_at INTEGER;
