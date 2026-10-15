-- Result corrections (shared/tournament/corrections.ts). The head judge an
-- event names (an account on its staff) may approve one as the organizer may.
ALTER TABLE tournaments ADD COLUMN head_judge TEXT;
-- One row per correction, written in the same batch as the event it changes
-- and only where that write lands (`version` is the event's version after
-- it). Rows are only added. `approved_by` is the approving account, NULL once
-- it is deleted; `role` says as what it approved, and `alone` that the
-- organizer approved with no head judge named. `during` is the round being
-- played at the time, always the corrected round's next.
CREATE TABLE IF NOT EXISTS result_corrections (
  code TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  pod TEXT NOT NULL,
  round INTEGER NOT NULL,
  table_no INTEGER NOT NULL,
  p1 TEXT NOT NULL,
  p2 TEXT NOT NULL,
  from_outcome TEXT NOT NULL,
  to_outcome TEXT NOT NULL,
  note TEXT NOT NULL,
  approved_by TEXT,
  role TEXT NOT NULL CHECK (role IN ('organizer', 'head-judge')),
  alone INTEGER NOT NULL,
  during INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (code, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS result_corrections_by_approver ON result_corrections (approved_by)
  WHERE approved_by IS NOT NULL;
