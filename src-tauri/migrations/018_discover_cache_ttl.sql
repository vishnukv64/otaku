-- Add TTL column to discover_cache for stale-while-revalidate caching
-- Default 1800 seconds (30 minutes) for existing entries

ALTER TABLE discover_cache ADD COLUMN ttl_seconds INTEGER NOT NULL DEFAULT 1800;
