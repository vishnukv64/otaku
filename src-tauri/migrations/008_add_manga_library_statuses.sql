-- Add manga statuses to library table
-- SQLite doesn't support ALTER TABLE to modify CHECK constraints,
-- so we need to recreate the table with the new constraint

-- Step 1: Create new table with updated constraint
CREATE TABLE IF NOT EXISTS library_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch', 'reading', 'plan_to_read')) DEFAULT 'plan_to_watch',
    favorite BOOLEAN NOT NULL DEFAULT 0,
    score REAL,
    notes TEXT,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

-- Step 2: Copy data from old table (if it exists and has data)
INSERT OR IGNORE INTO library_new (id, media_id, status, favorite, score, notes, added_at, updated_at)
SELECT id, media_id, status, favorite, score, notes, added_at, updated_at
FROM library;

-- Step 3: Drop old table
DROP TABLE IF EXISTS library;

-- Step 4: Rename new table
ALTER TABLE library_new RENAME TO library;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_library_status ON library(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_favorite ON library(favorite, updated_at DESC);
