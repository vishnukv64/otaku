-- Fix watch_history table by removing episode_id foreign key constraint
-- The episodes table is not being populated, causing watch history saves to fail
-- This migration is idempotent and can be run multiple times safely

-- Create watch_history without the episode_id foreign key constraint
-- IF NOT EXISTS prevents data loss on restarts
CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    episode_number INTEGER NOT NULL,
    current_time REAL NOT NULL DEFAULT 0, -- in seconds (legacy field, not used)
    duration REAL, -- total episode duration in seconds
    completed BOOLEAN NOT NULL DEFAULT 0,
    last_watched TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    -- Removed: FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
    UNIQUE(media_id, episode_id)
);

-- Create indexes (IF NOT EXISTS to make idempotent)
CREATE INDEX IF NOT EXISTS idx_watch_history_media ON watch_history(media_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_last_watched ON watch_history(last_watched DESC);
CREATE INDEX IF NOT EXISTS idx_watch_history_episode ON watch_history(episode_id);
