-- Release Tracking V2: Multi-signal detection with status normalization
-- This migration creates new tables for improved release detection and debugging

-- New release tracking table with multi-signal support
CREATE TABLE IF NOT EXISTS release_tracking_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL UNIQUE,
    extension_id TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('anime', 'manga')),

    -- Multi-signal tracking (use multiple signals for reliability)
    last_known_count INTEGER,                   -- Episode/chapter array length (fallback)
    last_known_latest_number REAL,              -- Latest episode/chapter number (primary, e.g., 12, 12.5)
    last_known_latest_id TEXT,                  -- Latest episode/chapter ID (strongest signal)
    last_episode_date INTEGER,                  -- Unix timestamp of latest episode

    -- Status normalization (maps API variations to canonical values)
    raw_status TEXT,                            -- Original status from API
    normalized_status TEXT DEFAULT 'unknown',   -- 'ongoing', 'completed', 'hiatus', 'unknown'

    -- Notification state
    user_notified_up_to REAL,                   -- Last episode number user was notified about
    user_acknowledged_at INTEGER,               -- When user dismissed the NEW badge (Unix ms)
    notification_enabled INTEGER DEFAULT 1,     -- Per-media notification toggle

    -- Check scheduling
    last_checked_at INTEGER NOT NULL,           -- Unix timestamp in ms
    next_scheduled_check INTEGER,               -- When to check next (Unix ms)
    consecutive_failures INTEGER DEFAULT 0,     -- For exponential backoff
    last_error TEXT,                            -- Last error message for debugging

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_release_tracking_v2_media ON release_tracking_v2(media_id);
CREATE INDEX IF NOT EXISTS idx_release_tracking_v2_next_check ON release_tracking_v2(next_scheduled_check);
CREATE INDEX IF NOT EXISTS idx_release_tracking_v2_status ON release_tracking_v2(normalized_status);

-- Check log table for debugging and history
CREATE TABLE IF NOT EXISTS release_check_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL,
    check_timestamp INTEGER NOT NULL,           -- Unix ms
    result_type TEXT NOT NULL,                  -- 'new_release', 'no_change', 'api_error', 'count_decreased', 'first_check'

    -- Previous state
    previous_count INTEGER,
    previous_latest_number REAL,
    previous_latest_id TEXT,

    -- New state
    new_count INTEGER,
    new_latest_number REAL,
    new_latest_id TEXT,

    -- Detection details
    detection_signal TEXT,                      -- Which signal triggered: 'number', 'id', 'count'
    new_releases_count INTEGER,                 -- How many new episodes/chapters

    -- Error tracking
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Notification
    notification_sent INTEGER DEFAULT 0,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

-- Index for querying logs by media
CREATE INDEX IF NOT EXISTS idx_release_check_log_media ON release_check_log(media_id, check_timestamp DESC);

-- Migrate data from old release_tracking table if it exists
INSERT OR IGNORE INTO release_tracking_v2 (
    media_id,
    extension_id,
    media_type,
    last_known_count,
    last_known_latest_number,
    user_notified_up_to,
    last_checked_at,
    normalized_status,
    created_at,
    updated_at
)
SELECT
    rt.media_id,
    rt.extension_id,
    rt.media_type,
    rt.last_known_count,
    CAST(rt.last_known_count AS REAL),  -- Use count as initial number estimate
    CAST(rt.last_notified_count AS REAL),
    rt.last_checked_at,
    CASE
        WHEN m.status IN ('Ongoing', 'Releasing', 'Airing', 'Currently Airing') THEN 'ongoing'
        WHEN m.status IN ('Finished', 'Completed', 'Ended') THEN 'completed'
        WHEN m.status IN ('Hiatus', 'On Hold') THEN 'hiatus'
        ELSE 'unknown'
    END,
    rt.created_at,
    rt.updated_at
FROM release_tracking rt
LEFT JOIN media m ON rt.media_id = m.id
WHERE NOT EXISTS (SELECT 1 FROM release_tracking_v2 WHERE media_id = rt.media_id);

-- Add release check settings to app_settings if they don't exist
INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES
    ('release_check_interval_minutes', '120', strftime('%s', 'now') * 1000),
    ('release_check_fast_interval_minutes', '30', strftime('%s', 'now') * 1000),
    ('release_check_retry_delay_minutes', '5', strftime('%s', 'now') * 1000),
    ('release_check_max_retries', '3', strftime('%s', 'now') * 1000);
