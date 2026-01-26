-- Downloads Table
-- Stores download metadata persistently
-- This migration is idempotent and can be run multiple times safely

-- Create downloads table with updated schema (IF NOT EXISTS to prevent data loss)
CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    episode_number INTEGER NOT NULL,
    filename TEXT NOT NULL,
    url TEXT NOT NULL,
    file_path TEXT NOT NULL,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    percentage REAL NOT NULL DEFAULT 0,
    speed INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(media_id, episode_id)
);

-- Create indexes (IF NOT EXISTS to make idempotent)
CREATE INDEX IF NOT EXISTS idx_downloads_media_id ON downloads(media_id);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_downloads_created_at ON downloads(created_at);
