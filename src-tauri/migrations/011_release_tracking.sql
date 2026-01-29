-- Release tracking table for new episode/chapter notifications
-- Tracks last known episode/chapter count for media in user's library
-- Used to detect when new content is released

CREATE TABLE IF NOT EXISTS release_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL UNIQUE,
    extension_id TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('anime', 'manga')),
    last_known_count INTEGER NOT NULL DEFAULT 0,
    last_checked_at INTEGER NOT NULL,  -- Unix timestamp in milliseconds
    last_notified_count INTEGER,       -- Prevents duplicate notifications
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

-- Index for efficient lookups by media_id
CREATE INDEX IF NOT EXISTS idx_release_tracking_media ON release_tracking(media_id);

-- Index for finding items that need checking (sorted by last check time)
CREATE INDEX IF NOT EXISTS idx_release_tracking_last_checked ON release_tracking(last_checked_at);
