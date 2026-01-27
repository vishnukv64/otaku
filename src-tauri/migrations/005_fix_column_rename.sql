-- Properly migrate watch_history to use progress_seconds column
-- This handles databases that still have current_time column

-- Step 1: Rename the old table
ALTER TABLE watch_history RENAME TO watch_history_old;

-- Step 2: Create new table with correct schema
CREATE TABLE watch_history (
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

-- Step 3: Copy data from old table (handle both current_time and progress_seconds)
INSERT INTO watch_history (id, media_id, episode_id, episode_number, progress_seconds, duration, completed, last_watched, created_at)
SELECT
    id,
    media_id,
    episode_id,
    episode_number,
    COALESCE(current_time, 0) as progress_seconds,
    duration,
    completed,
    last_watched,
    created_at
FROM watch_history_old;

-- Step 4: Drop old table
DROP TABLE watch_history_old;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_watch_history_media ON watch_history(media_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_last_watched ON watch_history(last_watched DESC);
CREATE INDEX IF NOT EXISTS idx_watch_history_episode ON watch_history(episode_id);
