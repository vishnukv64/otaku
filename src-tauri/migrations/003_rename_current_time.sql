-- Fix SQLite's automatic time conversion on current_time column
-- by renaming it to progress_seconds
-- This migration is idempotent and can be run multiple times safely

-- Create watch_history with progress_seconds column
-- IF NOT EXISTS prevents data loss on restarts
CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    episode_number INTEGER NOT NULL,
    progress_seconds REAL NOT NULL DEFAULT 0,
    duration REAL,
    completed BOOLEAN NOT NULL DEFAULT 0,
    last_watched TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    UNIQUE(media_id, episode_id)
);

-- Create indexes (IF NOT EXISTS to make idempotent)
CREATE INDEX IF NOT EXISTS idx_watch_history_media ON watch_history(media_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_last_watched ON watch_history(last_watched DESC);
CREATE INDEX IF NOT EXISTS idx_watch_history_episode ON watch_history(episode_id);
