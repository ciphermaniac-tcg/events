-- Whether a player pastes their list on the site or hands staff a paper one
-- (shared/tournament/view.ts DeckMode). Run once, after 0036; SQLite refuses
-- to add a column twice.
ALTER TABLE decklists ADD COLUMN deck_mode TEXT NOT NULL DEFAULT 'digital';
