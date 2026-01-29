-- Reading History Migration
-- Tracks manga reading progress (chapter/page based)

-- Create reading_history table for manga progress
CREATE TABLE IF NOT EXISTS reading_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    chapter_number REAL NOT NULL,
    current_page INTEGER NOT NULL DEFAULT 1,
    total_pages INTEGER,
    completed BOOLEAN NOT NULL DEFAULT 0,
    last_read TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(media_id, chapter_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_reading_history_media ON reading_history(media_id);
CREATE INDEX IF NOT EXISTS idx_reading_history_last_read ON reading_history(last_read DESC);
CREATE INDEX IF NOT EXISTS idx_reading_history_completed ON reading_history(completed);

-- Chapter downloads table for offline reading
CREATE TABLE IF NOT EXISTS chapter_downloads (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    chapter_number REAL NOT NULL,
    folder_path TEXT NOT NULL,
    total_images INTEGER NOT NULL DEFAULT 0,
    downloaded_images INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'downloading', 'completed', 'failed', 'cancelled')),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(media_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_chapter_downloads_media ON chapter_downloads(media_id);
CREATE INDEX IF NOT EXISTS idx_chapter_downloads_status ON chapter_downloads(status);
