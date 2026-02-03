-- Library Tags System
-- Allows users to organize their library with custom tags/folders

-- Tags table
CREATE TABLE IF NOT EXISTS library_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366f1',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Junction table for many-to-many relationship between library entries and tags
CREATE TABLE IF NOT EXISTS library_tag_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_entry_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (library_entry_id) REFERENCES library(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES library_tags(id) ON DELETE CASCADE,
    UNIQUE(library_entry_id, tag_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_tag_assignments_entry ON library_tag_assignments(library_entry_id);
CREATE INDEX IF NOT EXISTS idx_tag_assignments_tag ON library_tag_assignments(tag_id);
