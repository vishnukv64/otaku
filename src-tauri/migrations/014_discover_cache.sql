-- Discover Cache Table
-- Stores the last fetched discover/browse results for instant page loads

CREATE TABLE IF NOT EXISTS discover_cache (
    cache_key TEXT PRIMARY KEY NOT NULL, -- e.g., "home", "anime:browse:score", "anime:season:2026:winter"
    data TEXT NOT NULL, -- JSON-encoded SearchResult array
    media_type TEXT CHECK(media_type IN ('anime', 'manga', 'mixed')) NOT NULL,
    cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discover_cache_type ON discover_cache(media_type);
CREATE INDEX IF NOT EXISTS idx_discover_cache_updated ON discover_cache(updated_at DESC);
