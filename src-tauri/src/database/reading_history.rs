// Reading History Module
//
// Handles CRUD operations for manga reading progress

use sqlx::SqlitePool;
use serde::{Deserialize, Serialize};
use anyhow::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingHistory {
    pub id: i64,
    pub media_id: String,
    pub chapter_id: String,
    pub chapter_number: f64,
    pub current_page: i32,
    pub total_pages: Option<i32>,
    pub completed: bool,
    pub last_read: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingProgress {
    pub media_id: String,
    pub chapter_id: String,
    pub chapter_number: f64,
    pub current_page: i32,
    pub total_pages: Option<i32>,
    pub completed: bool,
}

/// Save or update reading progress
pub async fn save_reading_progress(
    pool: &SqlitePool,
    progress: &ReadingProgress,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO reading_history (media_id, chapter_id, chapter_number, current_page, total_pages, completed, last_read)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(media_id, chapter_id) DO UPDATE SET
            current_page = ?,
            total_pages = ?,
            completed = ?,
            last_read = CURRENT_TIMESTAMP
        "#
    )
    .bind(&progress.media_id)
    .bind(&progress.chapter_id)
    .bind(progress.chapter_number)
    .bind(progress.current_page)
    .bind(progress.total_pages)
    .bind(progress.completed)
    .bind(progress.current_page) // for UPDATE
    .bind(progress.total_pages) // for UPDATE
    .bind(progress.completed) // for UPDATE
    .execute(pool)
    .await?;

    log::debug!("Saved reading progress for chapter {}", progress.chapter_id);

    // Automatically add to library with appropriate status
    use super::library::{add_to_library, LibraryStatus};
    let library_status = if progress.completed {
        // Check if all chapters are completed
        let all_completed = check_all_chapters_completed(pool, &progress.media_id).await?;
        if all_completed {
            LibraryStatus::Completed
        } else {
            LibraryStatus::Reading
        }
    } else {
        LibraryStatus::Reading
    };

    // Add/update library entry (ON CONFLICT will update if already exists)
    if let Err(e) = add_to_library(pool, &progress.media_id, library_status).await {
        log::warn!("Failed to add manga to library: {}", e);
        // Don't fail the entire operation if library update fails
    }

    Ok(())
}

/// Check if all chapters of a manga are completed
async fn check_all_chapters_completed(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<bool> {
    // Get total chapter count from media table (stored in episode_count for manga)
    let chapter_count: Option<i32> = sqlx::query_scalar(
        "SELECT episode_count FROM media WHERE id = ?"
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await?;

    if let Some(total) = chapter_count {
        // Count completed chapters in reading history
        let completed_count: i32 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM reading_history WHERE media_id = ? AND completed = 1"
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

/// Get reading progress for a specific chapter
pub async fn get_reading_progress(
    pool: &SqlitePool,
    chapter_id: &str,
) -> Result<Option<ReadingHistory>> {
    let progress = sqlx::query_as::<_, ReadingHistory>(
        r#"
        SELECT id, media_id, chapter_id, chapter_number, current_page, total_pages, completed, last_read, created_at
        FROM reading_history
        WHERE chapter_id = ?
        "#
    )
    .bind(chapter_id)
    .fetch_optional(pool)
    .await?;

    Ok(progress)
}

/// Get reading progress for all chapters of a manga
#[allow(dead_code)]
pub async fn get_manga_reading_history(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<Vec<ReadingHistory>> {
    let history = sqlx::query_as::<_, ReadingHistory>(
        r#"
        SELECT id, media_id, chapter_id, chapter_number, current_page, total_pages, completed, last_read, created_at
        FROM reading_history
        WHERE media_id = ?
        ORDER BY chapter_number ASC
        "#
    )
    .bind(media_id)
    .fetch_all(pool)
    .await?;

    Ok(history)
}

/// Get the most recently read chapter for a manga (for Resume Reading)
pub async fn get_latest_reading_progress_for_media(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<Option<ReadingHistory>> {
    let progress = sqlx::query_as::<_, ReadingHistory>(
        r#"
        SELECT id, media_id, chapter_id, chapter_number, current_page, total_pages, completed, last_read, created_at
        FROM reading_history
        WHERE media_id = ?
        ORDER BY last_read DESC
        LIMIT 1
        "#
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await?;

    Ok(progress)
}

/// Get continue reading list (recently read, not completed)
pub async fn get_continue_reading(
    pool: &SqlitePool,
    limit: i32,
) -> Result<Vec<ReadingHistory>> {
    let history = sqlx::query_as::<_, ReadingHistory>(
        r#"
        SELECT DISTINCT r.id, r.media_id, r.chapter_id, r.chapter_number, r.current_page, r.total_pages, r.completed, r.last_read, r.created_at
        FROM reading_history r
        WHERE r.completed = 0
        AND r.current_page > 0
        ORDER BY r.last_read DESC
        LIMIT ?
        "#
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(history)
}

/// Mark chapter as completed
#[allow(dead_code)]
pub async fn mark_chapter_completed(
    pool: &SqlitePool,
    chapter_id: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE reading_history
        SET completed = 1, last_read = CURRENT_TIMESTAMP
        WHERE chapter_id = ?
        "#
    )
    .bind(chapter_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Delete reading history for a manga
pub async fn delete_manga_reading_history(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<()> {
    sqlx::query("DELETE FROM reading_history WHERE media_id = ?")
        .bind(media_id)
        .execute(pool)
        .await?;

    Ok(())
}

impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for ReadingHistory {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;

        Ok(ReadingHistory {
            id: row.try_get("id")?,
            media_id: row.try_get("media_id")?,
            chapter_id: row.try_get("chapter_id")?,
            chapter_number: row.try_get::<f64, _>("chapter_number")
                .or_else(|_| row.try_get::<i64, _>("chapter_number").map(|n| n as f64))?,
            current_page: row.try_get("current_page")?,
            total_pages: row.try_get("total_pages")?,
            completed: row.try_get("completed")?,
            last_read: row.try_get("last_read")?,
            created_at: row.try_get("created_at")?,
        })
    }
}
