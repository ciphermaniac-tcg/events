-- The highest round each pod of an event has ever paired, as JSON
-- ({ "masters": 3 }). It only ever rises: deleting or re-pairing a round
-- leaves it, so a round's correction window stays shut once the round two
-- after it has been paired (shared/tournament/corrections.ts). An event saved
-- before this column reads it from the rounds it holds.
ALTER TABLE tournaments ADD COLUMN paired_through TEXT NOT NULL DEFAULT '{}';
