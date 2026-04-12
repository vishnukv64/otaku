// Feedback Module
//
// Stores user thumbs-up/down sentiment per media.
// Used to improve recommendation scoring — liked genres get boosted,
// disliked genres get penalized.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use anyhow::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaFeedback {
    pub media_id: String,
    pub sentiment: String, // "liked" or "disliked"
}

/// Set feedback for a media item (upsert).
pub async fn set_feedback(pool: &SqlitePool, media_id: &str, sentiment: &str) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO feedback (media_id, sentiment, created_at, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(media_id) DO UPDATE SET
            sentiment = ?,
            updated_at = CURRENT_TIMESTAMP
        "#
    )
    .bind(media_id)
    .bind(sentiment)
    .bind(sentiment)
    .execute(pool)
    .await?;
    Ok(())
}

/// Get feedback for a specific media item.
pub async fn get_feedback(pool: &SqlitePool, media_id: &str) -> Result<Option<MediaFeedback>> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT media_id, sentiment FROM feedback WHERE media_id = ?"
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| MediaFeedback {
        media_id: r.get("media_id"),
        sentiment: r.get("sentiment"),
    }))
}

/// Remove feedback for a media item (un-rate).
pub async fn remove_feedback(pool: &SqlitePool, media_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM feedback WHERE media_id = ?")
        .bind(media_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Get all feedback entries (used by recommendation engine scoring).
#[allow(dead_code)]
pub async fn get_all_feedback(pool: &SqlitePool) -> Result<Vec<MediaFeedback>> {
    use sqlx::Row;
    let rows = sqlx::query("SELECT media_id, sentiment FROM feedback")
        .fetch_all(pool)
        .await?;

    Ok(rows.iter().map(|r| MediaFeedback {
        media_id: r.get("media_id"),
        sentiment: r.get("sentiment"),
    }).collect())
}
