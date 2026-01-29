-- App Settings table for storing key-value settings
-- Used for update check tracking and other app-wide settings

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(key);
