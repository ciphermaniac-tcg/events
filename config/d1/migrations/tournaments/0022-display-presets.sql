CREATE TABLE IF NOT EXISTS display_presets (
  store_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  options TEXT NOT NULL,
  PRIMARY KEY (store_id, id),
  UNIQUE (store_id, name)
) WITHOUT ROWID;
