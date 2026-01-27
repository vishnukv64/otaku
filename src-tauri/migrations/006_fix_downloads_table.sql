-- Fix downloads table schema to match expected columns
-- Handles databases created with old schema

-- Step 1: Rename old table
ALTER TABLE downloads RENAME TO downloads_old;

-- Step 2: Create new table with correct schema
CREATE TABLE downloads (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    episode_number INTEGER NOT NULL DEFAULT 0,
    filename TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
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

-- Step 3: Migrate data from old table (map old columns to new columns)
INSERT OR IGNORE INTO downloads (id, media_id, episode_id, episode_number, filename, url, file_path, total_bytes, downloaded_bytes, percentage, speed, status, error_message, created_at, updated_at)
SELECT
    CAST(id AS TEXT) as id,
    media_id,
    COALESCE(episode_id, '') as episode_id,
    0 as episode_number,
    '' as filename,
    '' as url,
    file_path,
    COALESCE(file_size, 0) as total_bytes,
    COALESCE(file_size, 0) as downloaded_bytes,
    COALESCE(progress, 0) as percentage,
    COALESCE(speed, 0) as speed,
    COALESCE(download_status, 'queued') as status,
    error_message,
    created_at,
    COALESCE(completed_at, created_at) as updated_at
FROM downloads_old;

-- Step 4: Drop old table
DROP TABLE downloads_old;

-- Step 5: Create indexes
CREATE INDEX IF NOT EXISTS idx_downloads_media_id ON downloads(media_id);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_downloads_created_at ON downloads(created_at);
