CREATE TABLE IF NOT EXISTS id_mappings (
    mal_id TEXT PRIMARY KEY,
    allanime_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
