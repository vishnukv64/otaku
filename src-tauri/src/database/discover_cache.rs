// Discover Cache Module
//
// Handles caching of discover/browse results for instant page loads

use sqlx::SqlitePool;
use serde::{Deserialize, Serialize};
use anyhow::Result;

/// Cached discover results entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoverCacheEntry {
    pub cache_key: String,
    pub data: String, // JSON-encoded SearchResult array
    pub media_type: String, // anime, manga, or mixed
    pub cached_at: String,
    pub updated_at: String,
}

/// Save or update discover results cache
pub async fn save_discover_cache(
    pool: &SqlitePool,
    cache_key: &str,
    data: &str, // JSON-encoded SearchResult array
    media_type: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO discover_cache (cache_key, data, media_type, cached_at, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(cache_key) DO UPDATE SET
            data = ?,
            updated_at = CURRENT_TIMESTAMP
        "#
    )
    .bind(cache_key)
    .bind(data)
    .bind(media_type)
    .bind(data)
    .execute(pool)
    .await?;

    log::debug!("Saved discover cache: {}", cache_key);

    Ok(())
}

/// Get cached discover results
pub async fn get_discover_cache(
    pool: &SqlitePool,
    cache_key: &str,
) -> Result<Option<DiscoverCacheEntry>> {
    let entry = sqlx::query_as::<_, DiscoverCacheEntry>(
        r#"
        SELECT cache_key, data, media_type, cached_at, updated_at
        FROM discover_cache
        WHERE cache_key = ?
        "#
    )
    .bind(cache_key)
    .fetch_optional(pool)
    .await?;

    Ok(entry)
}

/// Clear all discover cache (for refresh/reset)
#[allow(dead_code)]
pub async fn clear_discover_cache(pool: &SqlitePool) -> Result<()> {
    sqlx::query("DELETE FROM discover_cache")
        .execute(pool)
        .await?;

    log::debug!("Cleared all discover cache");

    Ok(())
}

/// Clear discover cache by media type
#[allow(dead_code)]
pub async fn clear_discover_cache_by_type(
    pool: &SqlitePool,
    media_type: &str,
) -> Result<()> {
    sqlx::query("DELETE FROM discover_cache WHERE media_type = ?")
        .bind(media_type)
        .execute(pool)
        .await?;

    log::debug!("Cleared discover cache for type: {}", media_type);

    Ok(())
}

impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for DiscoverCacheEntry {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;

        Ok(DiscoverCacheEntry {
            cache_key: row.try_get("cache_key")?,
            data: row.try_get("data")?,
            media_type: row.try_get("media_type")?,
            cached_at: row.try_get("cached_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

// ==================== TTL-aware cache (SWR pattern) ====================

/// Cached discover results with freshness metadata for stale-while-revalidate
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedDataWithMeta {
    pub cache_key: String,
    pub data: String,
    pub media_type: String,
    pub is_fresh: bool,
    pub cached_at: String,
    pub age_seconds: i64,
}

/// Get cached data with freshness info (is the entry within its TTL?)
pub async fn get_discover_cache_with_freshness(
    pool: &SqlitePool,
    cache_key: &str,
) -> Result<Option<CachedDataWithMeta>> {
    let entry = sqlx::query_as::<_, CachedDataWithMeta>(
        r#"
        SELECT
            cache_key,
            data,
            media_type,
            cached_at,
            CAST((strftime('%s', 'now') - strftime('%s', updated_at)) AS INTEGER) AS age_seconds,
            CASE
                WHEN (strftime('%s', 'now') - strftime('%s', updated_at)) < ttl_seconds THEN 1
                ELSE 0
            END AS is_fresh
        FROM discover_cache
        WHERE cache_key = ?
        "#
    )
    .bind(cache_key)
    .fetch_optional(pool)
    .await?;

    Ok(entry)
}

/// Save or update discover cache with explicit TTL
pub async fn save_discover_cache_with_ttl(
    pool: &SqlitePool,
    cache_key: &str,
    data: &str,
    media_type: &str,
    ttl_seconds: i64,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO discover_cache (cache_key, data, media_type, ttl_seconds, cached_at, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(cache_key) DO UPDATE SET
            data = ?,
            ttl_seconds = ?,
            updated_at = CURRENT_TIMESTAMP
        "#
    )
    .bind(cache_key)
    .bind(data)
    .bind(media_type)
    .bind(ttl_seconds)
    .bind(data)
    .bind(ttl_seconds)
    .execute(pool)
    .await?;

    log::debug!("Saved discover cache with TTL {}s: {}", ttl_seconds, cache_key);

    Ok(())
}

/// Delete cache entries older than 3x their TTL (garbage collection)
#[allow(dead_code)]
pub async fn clear_expired_cache(pool: &SqlitePool) -> Result<u64> {
    let result = sqlx::query(
        r#"
        DELETE FROM discover_cache
        WHERE (strftime('%s', 'now') - strftime('%s', updated_at)) > (ttl_seconds * 3)
        "#
    )
    .execute(pool)
    .await?;

    let count = result.rows_affected();
    if count > 0 {
        log::debug!("Cleared {} expired discover cache entries", count);
    }

    Ok(count)
}

impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for CachedDataWithMeta {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;

        Ok(CachedDataWithMeta {
            cache_key: row.try_get("cache_key")?,
            data: row.try_get("data")?,
            media_type: row.try_get("media_type")?,
            is_fresh: row.try_get::<i32, _>("is_fresh")? != 0,
            cached_at: row.try_get("cached_at")?,
            age_seconds: row.try_get("age_seconds")?,
        })
    }
}
