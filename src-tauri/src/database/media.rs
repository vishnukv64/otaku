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
    pub completed: bool,
    pub last_watched: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinueReadingEntry {
    pub media: MediaEntry,
    pub chapter_id: String,
    pub chapter_number: f64,
    pub current_page: i32,
    pub total_pages: Option<i32>,
    pub completed: bool,
    pub last_read: String,
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
            genres = COALESCE(?, genres),
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
    .bind(&media.genres)
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
/// Includes:
/// - Incomplete episodes (partially watched)
/// - Completed episodes if there are more episodes to watch
/// Excludes:
/// - Anime where the final episode is completed or >= 90% watched
pub async fn get_continue_watching_with_media(
    pool: &SqlitePool,
    limit: i32,
) -> Result<Vec<ContinueWatchingEntry>> {
    // Use a CTE to get the most recent watch entry per media, then filter
    let entries = sqlx::query(
        r#"
        WITH latest_watch AS (
            SELECT
                w.*,
                ROW_NUMBER() OVER (PARTITION BY w.media_id ORDER BY w.last_watched DESC) as rn
            FROM watch_history w
            WHERE w.progress_seconds > 0
        ),
        max_completed AS (
            SELECT
                media_id,
                MAX(CASE WHEN completed = 1 THEN episode_number ELSE 0 END) as max_completed_ep
            FROM watch_history
            GROUP BY media_id
        )
        SELECT DISTINCT
            m.id, m.extension_id, m.title, m.english_name, m.native_name, m.description,
            m.cover_url, m.banner_url, m.trailer_url, m.media_type, m.content_type, m.status,
            m.year, m.rating, m.episode_count, m.episode_duration,
            m.season_quarter, m.season_year,
            m.aired_start_year, m.aired_start_month, m.aired_start_date,
            m.genres, m.created_at, m.updated_at,
            lw.episode_id, lw.episode_number, lw.progress_seconds, lw.duration, lw.completed, lw.last_watched,
            mc.max_completed_ep
        FROM latest_watch lw
        INNER JOIN media m ON lw.media_id = m.id
        LEFT JOIN max_completed mc ON lw.media_id = mc.media_id
        WHERE lw.rn = 1
          AND (
            -- Case 1: Episode is not completed (partially watched)
            lw.completed = 0
            -- Case 2: Episode is completed but there are more episodes to watch
            OR (
                lw.completed = 1
                AND m.episode_count IS NOT NULL
                AND COALESCE(mc.max_completed_ep, 0) < m.episode_count
            )
          )
          -- Exclude if final episode is 90%+ watched (nearly complete)
          AND NOT (
            m.episode_count IS NOT NULL
            AND lw.episode_number >= m.episode_count
            AND lw.completed = 0
            AND lw.duration IS NOT NULL
            AND lw.duration > 0
            AND (lw.progress_seconds / lw.duration) >= 0.9
          )
        ORDER BY lw.last_watched DESC
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
            completed: row.try_get("completed")?,
            last_watched: row.try_get("last_watched")?,
        });
    }

    Ok(result)
}

/// Get continue reading with media details
/// Includes:
/// - Incomplete chapters (partially read)
/// - Completed chapters if there are more chapters to read
/// Excludes:
/// - Manga where the final chapter is completed or >= 90% read
pub async fn get_continue_reading_with_media(
    pool: &SqlitePool,
    limit: i32,
) -> Result<Vec<ContinueReadingEntry>> {
    // Use a CTE to get the most recent read entry per media, then filter
    let entries = sqlx::query(
        r#"
        WITH latest_read AS (
            SELECT
                r.*,
                ROW_NUMBER() OVER (PARTITION BY r.media_id ORDER BY r.last_read DESC) as rn
            FROM reading_history r
            WHERE r.current_page > 0
        ),
        max_completed_chapter AS (
            SELECT
                media_id,
                MAX(CASE WHEN completed = 1 THEN chapter_number ELSE 0 END) as max_completed_ch
            FROM reading_history
            GROUP BY media_id
        )
        SELECT DISTINCT
            m.id, m.extension_id, m.title, m.english_name, m.native_name, m.description,
            m.cover_url, m.banner_url, m.trailer_url, m.media_type, m.content_type, m.status,
            m.year, m.rating, m.episode_count, m.episode_duration,
            m.season_quarter, m.season_year,
            m.aired_start_year, m.aired_start_month, m.aired_start_date,
            m.genres, m.created_at, m.updated_at,
            lr.chapter_id, lr.chapter_number, lr.current_page, lr.total_pages, lr.completed, lr.last_read,
            mc.max_completed_ch
        FROM latest_read lr
        INNER JOIN media m ON lr.media_id = m.id
        LEFT JOIN max_completed_chapter mc ON lr.media_id = mc.media_id
        WHERE lr.rn = 1
          AND (
            -- Case 1: Chapter is not completed (partially read)
            lr.completed = 0
            -- Case 2: Chapter is completed but there are more chapters to read
            OR (
                lr.completed = 1
                AND m.episode_count IS NOT NULL
                AND COALESCE(mc.max_completed_ch, 0) < m.episode_count
            )
          )
          -- Exclude if final chapter is 90%+ read (nearly complete)
          AND NOT (
            m.episode_count IS NOT NULL
            AND lr.chapter_number >= m.episode_count
            AND lr.completed = 0
            AND lr.total_pages IS NOT NULL
            AND lr.total_pages > 0
            AND (CAST(lr.current_page AS REAL) / CAST(lr.total_pages AS REAL)) >= 0.9
          )
        ORDER BY lr.last_read DESC
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

        result.push(ContinueReadingEntry {
            media,
            chapter_id: row.try_get("chapter_id")?,
            chapter_number: row.try_get::<f64, _>("chapter_number")
                .or_else(|_| row.try_get::<i64, _>("chapter_number").map(|n| n as f64))?,
            current_page: row.try_get("current_page")?,
            total_pages: row.try_get("total_pages")?,
            completed: row.try_get("completed")?,
            last_read: row.try_get("last_read")?,
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

// Episode Entry for caching episode metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeEntry {
    pub id: String,
    pub media_id: String,
    pub extension_id: String,
    pub number: f64, // f64 to support decimal manga chapter numbers (e.g. 34.5)
    pub title: Option<String>,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
    pub aired_date: Option<String>,
    pub duration: Option<i32>, // in seconds
}

/// Cached media details with episodes (for offline fallback)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedMediaDetails {
    pub media: MediaEntry,
    pub episodes: Vec<EpisodeEntry>,
}

/// Save episodes to database (upsert)
pub async fn save_episodes(
    pool: &SqlitePool,
    media_id: &str,
    extension_id: &str,
    episodes: &[EpisodeEntry],
) -> Result<()> {
    // Delete existing episodes for this media first (to handle removed episodes)
    sqlx::query("DELETE FROM episodes WHERE media_id = ?")
        .bind(media_id)
        .execute(pool)
        .await?;

    // Insert all episodes
    for episode in episodes {
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO episodes (id, media_id, extension_id, number, title, description, thumbnail_url, aired_date, duration)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&episode.id)
        .bind(media_id)
        .bind(extension_id)
        .bind(episode.number)
        .bind(&episode.title)
        .bind(&episode.description)
        .bind(&episode.thumbnail_url)
        .bind(&episode.aired_date)
        .bind(episode.duration)
        .execute(pool)
        .await?;
    }

    log::debug!("Saved {} episodes for media: {}", episodes.len(), media_id);

    Ok(())
}

/// Get cached episodes for a media
pub async fn get_cached_episodes(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<Vec<EpisodeEntry>> {
    let episodes = sqlx::query_as::<_, EpisodeEntry>(
        r#"
        SELECT id, media_id, extension_id, number, title, description, thumbnail_url, aired_date, duration
        FROM episodes
        WHERE media_id = ?
        ORDER BY number ASC
        "#
    )
    .bind(media_id)
    .fetch_all(pool)
    .await?;

    Ok(episodes)
}

/// Get cached media details with episodes (for offline fallback)
pub async fn get_cached_media_details(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<Option<CachedMediaDetails>> {
    // Get media metadata
    let media = get_media(pool, media_id).await?;

    match media {
        Some(media) => {
            // Get cached episodes
            let episodes = get_cached_episodes(pool, media_id).await?;

            Ok(Some(CachedMediaDetails { media, episodes }))
        }
        None => Ok(None),
    }
}

impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for EpisodeEntry {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;

        Ok(EpisodeEntry {
            id: row.try_get("id")?,
            media_id: row.try_get("media_id")?,
            extension_id: row.try_get("extension_id")?,
            // SQLite stores whole numbers as INTEGER even in REAL columns.
            // Try f64 first, fall back to i64→f64 to handle both storage types.
            number: row.try_get::<f64, _>("number")
                .or_else(|_| row.try_get::<i64, _>("number").map(|n| n as f64))?,
            title: row.try_get("title")?,
            description: row.try_get("description")?,
            thumbnail_url: row.try_get("thumbnail_url")?,
            aired_date: row.try_get("aired_date")?,
            duration: row.try_get("duration")?,
        })
    }
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
