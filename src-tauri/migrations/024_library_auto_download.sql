ALTER TABLE library ADD COLUMN auto_download INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_library_auto_download ON library(auto_download) WHERE auto_download = 1;
