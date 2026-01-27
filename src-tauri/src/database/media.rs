// Media Module
//
// Handles CRUD operations for media (anime/manga) metadata

use sqlx::SqlitePool;
use serde::{Deserialize, Serialize};
use anyhow::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaEntry {
    pub id: String,
    pub extension_id: String,
    pub title: String,
    pub english_name: Option<String>,
    pub native_name: Option<String>,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub banner_url: Option<String>,
    pub trailer_url: Option<String>,
    pub media_type: String, // anime or manga
    pub content_type: Option<String>,
    pub status: Option<String>,
    pub year: Option<i32>,
    pub rating: Option<f64>,
    pub episode_count: Option<i32>,
    pub episode_duration: Option<i64>,
    pub season_quarter: Option<String>,
    pub season_year: Option<i32>,
    pub aired_start_year: Option<i32>,
    pub aired_start_month: Option<i32>,
    pub aired_start_date: Option<i32>,
    pub genres: Option<String>, // JSON array
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinueWatchingEntry {
    pub media: MediaEntry,
    pub episode_id: String,
    pub episode_number: i32,
    pub progress_seconds: f64,
    pub duration: Option<f64>,
    pub last_watched: String,
}

/// Save or update media details
pub async fn save_media(
    pool: &SqlitePool,
    media: &MediaEntry,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO media (
            id, extension_id, title, english_name, native_name, description,
            cover_url, banner_url, trailer_url, media_type, content_type, status,
            year, rating, episode_count, episode_duration,
            season_quarter, season_year,
            aired_start_year, aired_start_month, aired_start_date,
            genres, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            title = ?,
            english_name = ?,
            native_name = ?,
            description = ?,
            cover_url = ?,
            banner_url = ?,
            trailer_url = ?,
            status = ?,
            year = ?,
            rating = ?,
            episode_count = ?,
            updated_at = CURRENT_TIMESTAMP
        "#
    )
    .bind(&media.id)
    .bind(&media.extension_id)
    .bind(&media.title)
    .bind(&media.english_name)
    .bind(&media.native_name)
    .bind(&media.description)
    .bind(&media.cover_url)
    .bind(&media.banner_url)
    .bind(&media.trailer_url)
    .bind(&media.media_type)
    .bind(&media.content_type)
    .bind(&media.status)
    .bind(media.year)
    .bind(media.rating)
    .bind(media.episode_count)
    .bind(media.episode_duration)
    .bind(&media.season_quarter)
    .bind(media.season_year)
    .bind(media.aired_start_year)
    .bind(media.aired_start_month)
    .bind(media.aired_start_date)
    .bind(&media.genres)
    // For UPDATE
    .bind(&media.title)
    .bind(&media.english_name)
    .bind(&media.native_name)
    .bind(&media.description)
    .bind(&media.cover_url)
    .bind(&media.banner_url)
    .bind(&media.trailer_url)
    .bind(&media.status)
    .bind(media.year)
    .bind(media.rating)
    .bind(media.episode_count)
    .execute(pool)
    .await?;

    log::debug!("Saved media: {}", media.id);

    Ok(())
}

/// Get media by ID
#[allow(dead_code)]
pub async fn get_media(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<Option<MediaEntry>> {
    let media = sqlx::query_as::<_, MediaEntry>(
        r#"
        SELECT
            id, extension_id, title, english_name, native_name, description,
            cover_url, banner_url, trailer_url, media_type, content_type, status,
            year, rating, episode_count, episode_duration,
            season_quarter, season_year,
            aired_start_year, aired_start_month, aired_start_date,
            genres, created_at, updated_at
        FROM media
        WHERE id = ?
        "#
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await?;

    Ok(media)
}

/// Get continue watching with media details
/// Excludes anime where the final episode is >= 90% watched
pub async fn get_continue_watching_with_media(
    pool: &SqlitePool,
    limit: i32,
) -> Result<Vec<ContinueWatchingEntry>> {
    let entries = sqlx::query(
        r#"
        SELECT DISTINCT
            m.id, m.extension_id, m.title, m.english_name, m.native_name, m.description,
            m.cover_url, m.banner_url, m.trailer_url, m.media_type, m.content_type, m.status,
            m.year, m.rating, m.episode_count, m.episode_duration,
            m.season_quarter, m.season_year,
            m.aired_start_year, m.aired_start_month, m.aired_start_date,
            m.genres, m.created_at, m.updated_at,
            w.episode_id, w.episode_number, w.progress_seconds, w.duration, w.last_watched
        FROM watch_history w
        INNER JOIN media m ON w.media_id = m.id
        WHERE w.completed = 0
          AND w.progress_seconds > 0
          -- Exclude if this is the final episode AND progress >= 90%
          AND NOT (
            m.episode_count IS NOT NULL
            AND w.episode_number >= m.episode_count
            AND w.duration IS NOT NULL
            AND w.duration > 0
            AND (w.progress_seconds / w.duration) >= 0.9
          )
        GROUP BY w.media_id
        HAVING MAX(w.last_watched)
        ORDER BY w.last_watched DESC
        LIMIT ?
        "#
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut result = Vec::new();
    for row in entries {
        use sqlx::Row;

        let media = MediaEntry {
            id: row.try_get("id")?,
            extension_id: row.try_get("extension_id")?,
            title: row.try_get("title")?,
            english_name: row.try_get("english_name")?,
            native_name: row.try_get("native_name")?,
            description: row.try_get("description")?,
            cover_url: row.try_get("cover_url")?,
            banner_url: row.try_get("banner_url")?,
            trailer_url: row.try_get("trailer_url")?,
            media_type: row.try_get("media_type")?,
            content_type: row.try_get("content_type")?,
            status: row.try_get("status")?,
            year: row.try_get("year")?,
            rating: row.try_get("rating")?,
            episode_count: row.try_get("episode_count")?,
            episode_duration: row.try_get("episode_duration")?,
            season_quarter: row.try_get("season_quarter")?,
            season_year: row.try_get("season_year")?,
            aired_start_year: row.try_get("aired_start_year")?,
            aired_start_month: row.try_get("aired_start_month")?,
            aired_start_date: row.try_get("aired_start_date")?,
            genres: row.try_get("genres")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        };

        result.push(ContinueWatchingEntry {
            media,
            episode_id: row.try_get("episode_id")?,
            episode_number: row.try_get("episode_number")?,
            progress_seconds: row.try_get("progress_seconds")?,
            duration: row.try_get("duration")?,
            last_watched: row.try_get("last_watched")?,
        });
    }

    Ok(result)
}

/// Get downloads with media details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadWithMedia {
    pub media_id: String,
    pub title: String,
    pub cover_url: Option<String>,
    pub episode_count: i32,
    pub total_size: i64,
}

pub async fn get_downloads_with_media(pool: &SqlitePool) -> Result<Vec<DownloadWithMedia>> {
    let entries = sqlx::query(
        r#"
        SELECT
            d.media_id,
            m.title,
            m.cover_url,
            COUNT(DISTINCT d.episode_number) as episode_count,
            GROUP_CONCAT(d.file_path) as file_paths
        FROM downloads d
        LEFT JOIN media m ON d.media_id = m.id
        WHERE d.status = 'completed'
        GROUP BY d.media_id
        ORDER BY MAX(d.updated_at) DESC
        "#
    )
    .fetch_all(pool)
    .await?;

    let mut result = Vec::new();
    for row in entries {
        use sqlx::Row;

        // If media doesn't exist, extract title from downloads
        let title: Option<String> = row.try_get("title").ok();
        let media_id: String = row.try_get("media_id")?;
        let file_paths_str: Option<String> = row.try_get("file_paths").ok();

        // Calculate total size by reading actual file sizes from disk
        let mut total_size: i64 = 0;
        if let Some(paths) = file_paths_str {
            for path in paths.split(',') {
                if let Ok(metadata) = tokio::fs::metadata(path).await {
                    total_size += metadata.len() as i64;
                }
            }
        }

        result.push(DownloadWithMedia {
            media_id: media_id.clone(),
            title: title.unwrap_or_else(|| {
                // Fallback: extract from media_id or use placeholder
                media_id.replace('_', " ")
            }),
            cover_url: row.try_get("cover_url").ok().flatten(),
            episode_count: row.try_get("episode_count")?,
            total_size,
        });
    }

    Ok(result)
}

impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for MediaEntry {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;

        Ok(MediaEntry {
            id: row.try_get("id")?,
            extension_id: row.try_get("extension_id")?,
            title: row.try_get("title")?,
            english_name: row.try_get("english_name")?,
            native_name: row.try_get("native_name")?,
            description: row.try_get("description")?,
            cover_url: row.try_get("cover_url")?,
            banner_url: row.try_get("banner_url")?,
            trailer_url: row.try_get("trailer_url")?,
            media_type: row.try_get("media_type")?,
            content_type: row.try_get("content_type")?,
            status: row.try_get("status")?,
            year: row.try_get("year")?,
            rating: row.try_get("rating")?,
            episode_count: row.try_get("episode_count")?,
            episode_duration: row.try_get("episode_duration")?,
            season_quarter: row.try_get("season_quarter")?,
            season_year: row.try_get("season_year")?,
            aired_start_year: row.try_get("aired_start_year")?,
            aired_start_month: row.try_get("aired_start_month")?,
            aired_start_date: row.try_get("aired_start_date")?,
            genres: row.try_get("genres")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}
