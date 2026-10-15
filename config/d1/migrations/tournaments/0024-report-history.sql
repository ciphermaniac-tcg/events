CREATE TABLE IF NOT EXISTS report_history (
  code TEXT NOT NULL,
  version INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  report TEXT NOT NULL,
  account_id TEXT,
  claimed_at INTEGER,
  PRIMARY KEY (code, version, player_id)
) WITHOUT ROWID;

-- Original claimant metadata is unknown for historical filings; do not attach a replacement seat.
INSERT OR IGNORE INTO report_history (code, version, player_id, report, account_id, claimed_at)
SELECT t.code, t.version, json_extract(r.value, '$.by'), r.value, NULL, NULL
FROM tournaments t, json_each(t.reports) r;
