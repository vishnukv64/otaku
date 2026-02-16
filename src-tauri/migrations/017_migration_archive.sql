-- Migration archive table for AllAnime → Jikan data migration
-- Records every migrated or archived entry for audit and potential manual recovery

CREATE TABLE IF NOT EXISTS migration_archive (
    original_id TEXT PRIMARY KEY,
    original_extension_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    title TEXT NOT NULL,
    english_name TEXT,
    new_mal_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('matched', 'archived', 'failed')),
    error_message TEXT,
    original_media_json TEXT,       -- Full media row as JSON
    original_children_json TEXT,    -- Watch/reading history, library, etc. as JSON
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
