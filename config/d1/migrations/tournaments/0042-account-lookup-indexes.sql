-- The account columns an account's data export and its wipe read: the decklists
-- it holds and the reports it filed (functions/lib/accounts/dataExport.ts,
-- functions/lib/accounts/wipe.ts). Without these indexes both read every row of
-- both tables. Every other account-scoped table the wipe touches already has
-- one. Run once, after 0041.
CREATE INDEX IF NOT EXISTS decklists_by_account ON decklists (account) WHERE account IS NOT NULL;
CREATE INDEX IF NOT EXISTS report_history_by_account ON report_history (account_id) WHERE account_id IS NOT NULL;
