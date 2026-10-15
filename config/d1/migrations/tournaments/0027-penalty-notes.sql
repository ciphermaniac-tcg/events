-- Penalty notes staff record during an event (shared/tournament/penaltyNotes.ts),
-- a staff record shaped as deck_checks is (0026): append-only, an edit a new
-- row whose `replaces` names the row it edits and a removal one with `removed`
-- set, each with the account that wrote it (`recorded_by`) and when. A row is
-- replaced at most once. The judge is a staff account (`judge_id`,
-- `judge_name` '') or a name typed in (`judge_id` NULL); a deleted account
-- leaves both empty, and `recorded_by` NULL. A note issues nothing: no result,
-- drop or standing reads this table.
CREATE TABLE IF NOT EXISTS penalty_notes (
  code TEXT NOT NULL,
  id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  round INTEGER NOT NULL,
  judge_id TEXT,
  judge_name TEXT NOT NULL,
  penalty TEXT NOT NULL CHECK (
    penalty IN ('caution', 'warning', 'double-prize', 'quadruple-prize', 'game-loss', 'match-loss', 'disqualification')
  ),
  notes TEXT NOT NULL,
  recorded_by TEXT,
  recorded_at INTEGER NOT NULL,
  replaces TEXT,
  removed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (code, id)
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS penalty_notes_replaced ON penalty_notes (code, replaces) WHERE replaces IS NOT NULL;
CREATE INDEX IF NOT EXISTS penalty_notes_by_judge ON penalty_notes (judge_id) WHERE judge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS penalty_notes_by_recorder ON penalty_notes (recorded_by) WHERE recorded_by IS NOT NULL;
