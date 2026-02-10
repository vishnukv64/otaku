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
