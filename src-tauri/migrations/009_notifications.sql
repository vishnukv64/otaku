-- Notifications table for storing in-app notifications
-- Supports success, error, warning, and info types with optional actions

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY NOT NULL,
    notification_type TEXT NOT NULL CHECK(notification_type IN ('success', 'error', 'warning', 'info')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT,                -- e.g., 'download', 'library', 'watch', 'extension', 'update'
    action_label TEXT,          -- Button text for the action (e.g., "Open Downloads")
    action_route TEXT,          -- Route to navigate to when action is clicked
    action_callback TEXT,       -- Named callback for custom actions
    metadata TEXT,              -- JSON metadata for additional context
    read INTEGER NOT NULL DEFAULT 0,
    dismissed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL -- Unix timestamp in milliseconds
);

-- Index for fetching recent notifications efficiently
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- Index for filtering unread notifications
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read, created_at DESC);

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS idx_notifications_source ON notifications(source, created_at DESC);
