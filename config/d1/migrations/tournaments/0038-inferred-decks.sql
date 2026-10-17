-- The archetype each player's pasted list reads as (shared/tournament/archetypes.ts),
-- apart from the one staff set in `decks`, which wins over it. Run once,
-- after 0037; SQLite refuses to add a column twice.
ALTER TABLE tournaments ADD COLUMN inferred_decks TEXT NOT NULL DEFAULT '{}';
