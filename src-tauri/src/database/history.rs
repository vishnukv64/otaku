// History Module
//
// Provides unified history queries for the /history page:
// timeline view, series grouping, and deletion.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use anyhow::Result;

use super::media::MediaEntry;

/// A unified history entry that can represent either a watch or read event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    #[serde(rename = "type")]
    pub entry_type: String, // "watch" or "read"
    pub media: MediaEntry,
    pub episode_id: Option<String>,
    pub chapter_id: Option<String>,
    pub episode_number: Option<i32>,
    pub chapter_number: Option<f64>,
    pub progress_seconds: Option<f64>,
    pub current_page: Option<i32>,
    pub duration: Option<f64>,
    pub total_pages: Option<i32>,
    pub completed: bool,
    pub timestamp: String,
}

/// Aggregated history for a single anime/manga series.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaHistorySummary {
    pub media: MediaEntry,
    #[serde(rename = "type")]
    pub media_type: String, // "anime" or "manga"
    pub items_completed: i32,
    pub total_items: Option<i32>,
    pub total_time_seconds: f64,
    pub last_activity: String,
}

/// Returns a paginated, unified timeline of watch and read history.
/// When media_type is None, returns both anime and manga via UNION.
/// When "anime", queries only watch_history. When "manga", only reading_history.
pub async fn get_all_history(
    pool: &SqlitePool,
    page: i32,
    limit: i32,
    media_type: Option<&str>,
    search: Option<&str>,
) -> Result<Vec<HistoryEntry>> {
    let offset = (page - 1) * limit;
    let search_pattern = search.map(|s| format!("%{}%", s));

    let include_watch = media_type.is_none() || media_type == Some("anime");
    let include_read = media_type.is_none() || media_type == Some("manga");

    // Build UNION query dynamically
    let mut parts: Vec<String> = Vec::new();

    if include_watch {
        parts.push(format!(
            "SELECT 'watch' as entry_type,
                m.id, m.extension_id, m.title, m.english_name, m.native_name,
                m.description, m.cover_url, m.banner_url, m.trailer_url,
                m.media_type, m.content_type, m.status as media_status,
                m.year, m.rating, m.episode_count, m.episode_duration,
                m.season_quarter, m.season_year,
                m.aired_start_year, m.aired_start_month, m.aired_start_date,
                m.genres, m.created_at as media_created_at, m.updated_at as media_updated_at,
                w.episode_id, NULL as chapter_id,
                w.episode_number, NULL as chapter_number,
                w.progress_seconds, NULL as current_page,
                w.duration, NULL as total_pages,
                w.completed,
                w.last_watched as timestamp
            FROM watch_history w
            JOIN media m ON w.media_id = m.id
            WHERE 1=1 {}",
            if search_pattern.is_some() { "AND m.title LIKE ?" } else { "" }
        ));
    }

    if include_read {
        parts.push(format!(
            "SELECT 'read' as entry_type,
                m.id, m.extension_id, m.title, m.english_name, m.native_name,
                m.description, m.cover_url, m.banner_url, m.trailer_url,
                m.media_type, m.content_type, m.status as media_status,
                m.year, m.rating, m.episode_count, m.episode_duration,
                m.season_quarter, m.season_year,
                m.aired_start_year, m.aired_start_month, m.aired_start_date,
                m.genres, m.created_at as media_created_at, m.updated_at as media_updated_at,
                NULL as episode_id, r.chapter_id,
                NULL as episode_number, r.chapter_number,
                NULL as progress_seconds, r.current_page,
                NULL as duration, r.total_pages,
                r.completed,
                r.last_read as timestamp
            FROM reading_history r
            JOIN media m ON r.media_id = m.id
            WHERE 1=1 {}",
            if search_pattern.is_some() { "AND m.title LIKE ?" } else { "" }
        ));
    }

    let query_str = format!(
        "{} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        parts.join(" UNION ALL ")
    );

    let mut query = sqlx::query(&query_str);

    // Bind search patterns
    if include_watch {
        if let Some(ref pattern) = search_pattern {
            query = query.bind(pattern.clone());
        }
    }
    if include_read {
        if let Some(ref pattern) = search_pattern {
            query = query.bind(pattern.clone());
        }
    }
    query = query.bind(limit).bind(offset);

    let rows = query.fetch_all(pool).await?;

    let entries: Vec<HistoryEntry> = rows
        .iter()
        .map(|row| {
            use sqlx::Row;
            HistoryEntry {
                entry_type: row.get("entry_type"),
                media: MediaEntry {
                    id: row.get("id"),
                    extension_id: row.get("extension_id"),
                    title: row.get("title"),
                    english_name: row.get("english_name"),
                    native_name: row.get("native_name"),
                    description: row.get("description"),
                    cover_url: row.get("cover_url"),
                    banner_url: row.get("banner_url"),
                    trailer_url: row.get("trailer_url"),
                    media_type: row.get("media_type"),
                    content_type: row.get("content_type"),
                    status: row.get("media_status"),
                    year: row.get("year"),
                    rating: row.get("rating"),
                    episode_count: row.get("episode_count"),
                    episode_duration: row.get("episode_duration"),
                    season_quarter: row.get("season_quarter"),
                    season_year: row.get("season_year"),
                    aired_start_year: row.get("aired_start_year"),
                    aired_start_month: row.get("aired_start_month"),
                    aired_start_date: row.get("aired_start_date"),
                    genres: row.get("genres"),
                    created_at: row.get("media_created_at"),
                    updated_at: row.get("media_updated_at"),
                },
                episode_id: row.get("episode_id"),
                chapter_id: row.get("chapter_id"),
                episode_number: row.get("episode_number"),
                chapter_number: row.get("chapter_number"),
                progress_seconds: row.get("progress_seconds"),
                current_page: row.get("current_page"),
                duration: row.get("duration"),
                total_pages: row.get("total_pages"),
                completed: row.get("completed"),
                timestamp: row.get("timestamp"),
            }
        })
        .collect();

    Ok(entries)
}

/// Returns history aggregated per anime/manga, paginated.
pub async fn get_history_grouped_by_media(
    pool: &SqlitePool,
    page: i32,
    limit: i32,
    media_type: Option<&str>,
    search: Option<&str>,
) -> Result<Vec<MediaHistorySummary>> {
    let offset = (page - 1) * limit;
    let search_pattern = search.map(|s| format!("%{}%", s));

    let include_watch = media_type.is_none() || media_type == Some("anime");
    let include_read = media_type.is_none() || media_type == Some("manga");

    let mut parts: Vec<String> = Vec::new();

    if include_watch {
        parts.push(format!(
            "SELECT m.id, m.extension_id, m.title, m.english_name, m.native_name,
                m.description, m.cover_url, m.banner_url, m.trailer_url,
                m.media_type, m.content_type, m.status as media_status,
                m.year, m.rating, m.episode_count as total_items, m.episode_duration,
                m.season_quarter, m.season_year,
                m.aired_start_year, m.aired_start_month, m.aired_start_date,
                m.genres, m.created_at as media_created_at, m.updated_at as media_updated_at,
                'anime' as type_label,
                COUNT(CASE WHEN w.completed = 1 THEN 1 END) as items_completed,
                COALESCE(SUM(w.progress_seconds), 0) as total_time_seconds,
                MAX(w.last_watched) as last_activity
            FROM watch_history w
            JOIN media m ON w.media_id = m.id
            WHERE 1=1 {}
            GROUP BY m.id",
            if search_pattern.is_some() { "AND m.title LIKE ?" } else { "" }
        ));
    }

    if include_read {
        parts.push(format!(
            "SELECT m.id, m.extension_id, m.title, m.english_name, m.native_name,
                m.description, m.cover_url, m.banner_url, m.trailer_url,
                m.media_type, m.content_type, m.status as media_status,
                m.year, m.rating, m.episode_count as total_items, m.episode_duration,
                m.season_quarter, m.season_year,
                m.aired_start_year, m.aired_start_month, m.aired_start_date,
                m.genres, m.created_at as media_created_at, m.updated_at as media_updated_at,
                'manga' as type_label,
                COUNT(CASE WHEN r.completed = 1 THEN 1 END) as items_completed,
                0.0 as total_time_seconds,
                MAX(r.last_read) as last_activity
            FROM reading_history r
            JOIN media m ON r.media_id = m.id
            WHERE 1=1 {}
            GROUP BY m.id",
            if search_pattern.is_some() { "AND m.title LIKE ?" } else { "" }
        ));
    }

    let query_str = format!(
        "SELECT * FROM ({}) ORDER BY last_activity DESC LIMIT ? OFFSET ?",
        parts.join(" UNION ALL ")
    );

    let mut query = sqlx::query(&query_str);

    if include_watch {
        if let Some(ref pattern) = search_pattern {
            query = query.bind(pattern.clone());
        }
    }
    if include_read {
        if let Some(ref pattern) = search_pattern {
            query = query.bind(pattern.clone());
        }
    }
    query = query.bind(limit).bind(offset);

    let rows = query.fetch_all(pool).await?;

    let summaries: Vec<MediaHistorySummary> = rows
        .iter()
        .map(|row| {
            use sqlx::Row;
            MediaHistorySummary {
                media: MediaEntry {
                    id: row.get("id"),
                    extension_id: row.get("extension_id"),
                    title: row.get("title"),
                    english_name: row.get("english_name"),
                    native_name: row.get("native_name"),
                    description: row.get("description"),
                    cover_url: row.get("cover_url"),
                    banner_url: row.get("banner_url"),
                    trailer_url: row.get("trailer_url"),
                    media_type: row.get("media_type"),
                    content_type: row.get("content_type"),
                    status: row.get("media_status"),
                    year: row.get("year"),
                    rating: row.get("rating"),
                    episode_count: row.get("total_items"),
                    episode_duration: row.get("episode_duration"),
                    season_quarter: row.get("season_quarter"),
                    season_year: row.get("season_year"),
                    aired_start_year: row.get("aired_start_year"),
                    aired_start_month: row.get("aired_start_month"),
                    aired_start_date: row.get("aired_start_date"),
                    genres: row.get("genres"),
                    created_at: row.get("media_created_at"),
                    updated_at: row.get("media_updated_at"),
                },
                media_type: row.get("type_label"),
                items_completed: row.get("items_completed"),
                total_items: row.get("total_items"),
                total_time_seconds: row.get("total_time_seconds"),
                last_activity: row.get("last_activity"),
            }
        })
        .collect();

    Ok(summaries)
}

/// Remove a single watch history entry.
pub async fn remove_watch_history_entry(
    pool: &SqlitePool,
    media_id: &str,
    episode_id: &str,
) -> Result<()> {
    sqlx::query("DELETE FROM watch_history WHERE media_id = ? AND episode_id = ?")
        .bind(media_id)
        .bind(episode_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Remove a single reading history entry.
pub async fn remove_reading_history_entry(
    pool: &SqlitePool,
    media_id: &str,
    chapter_id: &str,
) -> Result<()> {
    sqlx::query("DELETE FROM reading_history WHERE media_id = ? AND chapter_id = ?")
        .bind(media_id)
        .bind(chapter_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Clear all reading history.
pub async fn clear_all_reading_history(pool: &SqlitePool) -> Result<()> {
    sqlx::query("DELETE FROM reading_history")
        .execute(pool)
        .await?;
    Ok(())
}
