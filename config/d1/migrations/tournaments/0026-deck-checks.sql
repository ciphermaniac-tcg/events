-- Deck checks staff record during an event (shared/tournament/deckChecks.ts).
-- Append-only: an edit is a new row whose `replaces` names the row it
-- edits, and a removal one with `removed` set, so every version stays with
-- the account that wrote it (`recorded_by`) and when. A row is replaced at
-- most once. `player_id` is the player's ID in the event's document and
-- `player_name` their name when the row was written. The checker is a staff
-- account (`checker_id`, `checker_name` '') or a name typed in (`checker_id`
-- NULL); a deleted account leaves both empty, and `recorded_by` NULL.
CREATE TABLE IF NOT EXISTS deck_checks (
  code TEXT NOT NULL,
  id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  round INTEGER NOT NULL,
  checker_id TEXT,
  checker_name TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass', 'fail')),
  notes TEXT NOT NULL,
  recorded_by TEXT,
  recorded_at INTEGER NOT NULL,
  replaces TEXT,
  removed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (code, id)
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS deck_checks_replaced ON deck_checks (code, replaces) WHERE replaces IS NOT NULL;
CREATE INDEX IF NOT EXISTS deck_checks_by_checker ON deck_checks (checker_id) WHERE checker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS deck_checks_by_recorder ON deck_checks (recorded_by) WHERE recorded_by IS NOT NULL;
