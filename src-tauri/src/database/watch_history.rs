// Watch History Module
//
// Handles CRUD operations for video playback progress

use sqlx::SqlitePool;
use serde::{Deserialize, Serialize};
use anyhow::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchHistory {
    pub id: i64,
    pub media_id: String,
    pub episode_id: String,
    pub episode_number: i32,
    pub progress_seconds: f64, // in seconds
    pub duration: Option<f64>, // total duration in seconds
    pub completed: bool,
    pub last_watched: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchProgress {
    pub media_id: String,
    pub episode_id: String,
    pub episode_number: i32,
    pub progress_seconds: f64,
    pub duration: Option<f64>,
    pub completed: bool,
}

/// Save or update watch progress
pub async fn save_watch_progress(
    pool: &SqlitePool,
    progress: &WatchProgress,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO watch_history (media_id, episode_id, episode_number, progress_seconds, duration, completed, last_watched)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(media_id, episode_id) DO UPDATE SET
            progress_seconds = ?,
            duration = ?,
            completed = ?,
            last_watched = CURRENT_TIMESTAMP
        "#
    )
    .bind(&progress.media_id)
    .bind(&progress.episode_id)
    .bind(progress.episode_number)
    .bind(progress.progress_seconds)
    .bind(progress.duration)
    .bind(progress.completed)
    .bind(progress.progress_seconds) // for UPDATE
    .bind(progress.duration) // for UPDATE
    .bind(progress.completed) // for UPDATE
    .execute(pool)
    .await?;

    log::debug!("Saved watch progress for episode {}", progress.episode_id);

    // Automatically add to library with appropriate status
    use super::library::{add_to_library, LibraryStatus};
    let library_status = if progress.completed {
        // Check if all episodes are completed
        let all_completed = check_all_episodes_completed(pool, &progress.media_id).await?;
        if all_completed {
            LibraryStatus::Completed
        } else {
            LibraryStatus::Watching
        }
    } else {
        LibraryStatus::Watching
    };

    // Add/update library entry (ON CONFLICT will update if already exists)
    if let Err(e) = add_to_library(pool, &progress.media_id, library_status).await {
        log::warn!("Failed to add media to library: {}", e);
        // Don't fail the entire operation if library update fails
    }

    Ok(())
}

/// Check if all episodes of a media are completed
async fn check_all_episodes_completed(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<bool> {
    // Get total episode count from media table
    let episode_count: Option<i32> = sqlx::query_scalar(
        "SELECT episode_count FROM media WHERE id = ?"
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await?;

    if let Some(total) = episode_count {
        // Count completed episodes in watch history
        let completed_count: i32 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM watch_history WHERE media_id = ? AND completed = 1"
        )
        .bind(media_id)
        .fetch_one(pool)
        .await?;

        Ok(completed_count >= total)
    } else {
        // If we don't know the total, can't determine completion
        Ok(false)
    }
}

/// Get watch progress for a specific episode
pub async fn get_watch_progress(
    pool: &SqlitePool,
    episode_id: &str,
) -> Result<Option<WatchHistory>> {
    let progress = sqlx::query_as::<_, WatchHistory>(
        r#"
        SELECT id, media_id, episode_id, episode_number, progress_seconds, duration, completed, last_watched, created_at
        FROM watch_history
        WHERE episode_id = ?
        "#
    )
    .bind(episode_id)
    .fetch_optional(pool)
    .await?;

    Ok(progress)
}

/// Get watch progress for all episodes of a media
pub async fn get_media_watch_history(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<Vec<WatchHistory>> {
    let history = sqlx::query_as::<_, WatchHistory>(
        r#"
        SELECT id, media_id, episode_id, episode_number, progress_seconds, duration, completed, last_watched, created_at
        FROM watch_history
        WHERE media_id = ?
        ORDER BY episode_number ASC
        "#
    )
    .bind(media_id)
    .fetch_all(pool)
    .await?;

    Ok(history)
}

/// Get the most recently watched episode for a media (for Resume Watching)
pub async fn get_latest_watch_progress_for_media(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<Option<WatchHistory>> {
    let progress = sqlx::query_as::<_, WatchHistory>(
        r#"
        SELECT id, media_id, episode_id, episode_number, progress_seconds, duration, completed, last_watched, created_at
        FROM watch_history
        WHERE media_id = ?
        ORDER BY last_watched DESC
        LIMIT 1
        "#
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await?;

    Ok(progress)
}

/// Get continue watching list (recently watched, not completed)
pub async fn get_continue_watching(
    pool: &SqlitePool,
    limit: i32,
) -> Result<Vec<WatchHistory>> {
    let history = sqlx::query_as::<_, WatchHistory>(
        r#"
        SELECT DISTINCT w.id, w.media_id, w.episode_id, w.episode_number, w.progress_seconds, w.duration, w.completed, w.last_watched, w.created_at
        FROM watch_history w
        WHERE w.completed = 0
        AND w.progress_seconds > 0
        ORDER BY w.last_watched DESC
        LIMIT ?
        "#
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(history)
}

/// Mark episode as completed
#[allow(dead_code)]
pub async fn mark_episode_completed(
    pool: &SqlitePool,
    episode_id: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE watch_history
        SET completed = 1, last_watched = CURRENT_TIMESTAMP
        WHERE episode_id = ?
        "#
    )
    .bind(episode_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Delete watch history for a media
pub async fn delete_media_watch_history(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<()> {
    sqlx::query("DELETE FROM watch_history WHERE media_id = ?")
        .bind(media_id)
        .execute(pool)
        .await?;

    Ok(())
}

impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for WatchHistory {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;

        Ok(WatchHistory {
            id: row.try_get("id")?,
            media_id: row.try_get("media_id")?,
            episode_id: row.try_get("episode_id")?,
            episode_number: row.try_get("episode_number")?,
            progress_seconds: row.try_get("progress_seconds")?,
            duration: row.try_get("duration")?,
            completed: row.try_get("completed")?,
            last_watched: row.try_get("last_watched")?,
            created_at: row.try_get("created_at")?,
        })
    }
}
