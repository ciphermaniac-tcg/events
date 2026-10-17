-- What staff checked for each player before round 1: paid, entered in TOM,
-- paper list handed in (shared/tournament/checkins.ts). Run once, after 0035;
-- SQLite refuses to add a column twice.
ALTER TABLE tournaments ADD COLUMN checkins TEXT NOT NULL DEFAULT '{}';
