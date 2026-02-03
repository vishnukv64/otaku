// Library Module
//
// Handles CRUD operations for user's media library

use sqlx::SqlitePool;
use serde::{Deserialize, Serialize};
use anyhow::Result;
use super::media::MediaEntry;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub id: i64,
    pub media_id: String,
    pub status: LibraryStatus,
    pub favorite: bool,
    pub score: Option<f64>,
    pub notes: Option<String>,
    pub added_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryEntryWithMedia {
    pub library_entry: LibraryEntry,
    pub media: MediaEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LibraryStatus {
    // Anime statuses
    Watching,
    Completed,
    OnHold,
    Dropped,
    PlanToWatch,
    // Manga statuses
    Reading,
    PlanToRead,
}

impl LibraryStatus {
    pub fn as_str(&self) -> &str {
        match self {
            LibraryStatus::Watching => "watching",
            LibraryStatus::Completed => "completed",
            LibraryStatus::OnHold => "on_hold",
            LibraryStatus::Dropped => "dropped",
            LibraryStatus::PlanToWatch => "plan_to_watch",
            LibraryStatus::Reading => "reading",
            LibraryStatus::PlanToRead => "plan_to_read",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "watching" => Some(LibraryStatus::Watching),
            "completed" => Some(LibraryStatus::Completed),
            "on_hold" => Some(LibraryStatus::OnHold),
            "dropped" => Some(LibraryStatus::Dropped),
            "plan_to_watch" => Some(LibraryStatus::PlanToWatch),
            "reading" => Some(LibraryStatus::Reading),
            "plan_to_read" => Some(LibraryStatus::PlanToRead),
            _ => None,
        }
    }
}

/// Add media to library
pub async fn add_to_library(
    pool: &SqlitePool,
    media_id: &str,
    status: LibraryStatus,
) -> Result<LibraryEntry> {
    sqlx::query(
        r#"
        INSERT INTO library (media_id, status, favorite, added_at, updated_at)
        VALUES (?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(media_id) DO UPDATE SET
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        "#
    )
    .bind(media_id)
    .bind(status.as_str())
    .bind(status.as_str()) // for UPDATE
    .execute(pool)
    .await?;

    log::debug!("Added media {} to library with status {:?}", media_id, status);

    // Return the created/updated entry
    get_library_entry(pool, media_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Failed to retrieve library entry"))
}

/// Get library entry for a specific media
pub async fn get_library_entry(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<Option<LibraryEntry>> {
    let entry = sqlx::query_as::<_, LibraryEntry>(
        r#"
        SELECT id, media_id, status, favorite, score, notes, added_at, updated_at
        FROM library
        WHERE media_id = ?
        "#
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await?;

    Ok(entry)
}

/// Get all library entries by status
pub async fn get_library_by_status(
    pool: &SqlitePool,
    status: Option<LibraryStatus>,
) -> Result<Vec<LibraryEntry>> {
    let entries = if let Some(status) = status {
        sqlx::query_as::<_, LibraryEntry>(
            r#"
            SELECT id, media_id, status, favorite, score, notes, added_at, updated_at
            FROM library
            WHERE status = ?
            ORDER BY updated_at DESC
            "#
        )
        .bind(status.as_str())
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, LibraryEntry>(
            r#"
            SELECT id, media_id, status, favorite, score, notes, added_at, updated_at
            FROM library
            ORDER BY updated_at DESC
            "#
        )
        .fetch_all(pool)
        .await?
    };

    Ok(entries)
}

/// Get library entries with full media details by status
pub async fn get_library_with_media_by_status(
    pool: &SqlitePool,
    status: Option<LibraryStatus>,
) -> Result<Vec<LibraryEntryWithMedia>> {
    let query = if let Some(status) = status {
        sqlx::query(
            r#"
            SELECT
                l.id, l.media_id, l.status, l.favorite, l.score, l.notes, l.added_at, l.updated_at,
                m.id, m.extension_id, m.title, m.english_name, m.native_name, m.description,
                m.cover_url, m.banner_url, m.trailer_url, m.media_type, m.content_type, m.status,
                m.year, m.rating, m.episode_count, m.episode_duration,
                m.season_quarter, m.season_year,
                m.aired_start_year, m.aired_start_month, m.aired_start_date,
                m.genres, m.created_at, m.updated_at
            FROM library l
            INNER JOIN media m ON l.media_id = m.id
            WHERE l.status = ?
            ORDER BY l.updated_at DESC
            "#
        )
        .bind(status.as_str())
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT
                l.id, l.media_id, l.status, l.favorite, l.score, l.notes, l.added_at, l.updated_at,
                m.id, m.extension_id, m.title, m.english_name, m.native_name, m.description,
                m.cover_url, m.banner_url, m.trailer_url, m.media_type, m.content_type, m.status,
                m.year, m.rating, m.episode_count, m.episode_duration,
                m.season_quarter, m.season_year,
                m.aired_start_year, m.aired_start_month, m.aired_start_date,
                m.genres, m.created_at, m.updated_at
            FROM library l
            INNER JOIN media m ON l.media_id = m.id
            ORDER BY l.updated_at DESC
            "#
        )
        .fetch_all(pool)
        .await?
    };

    let mut results = Vec::new();
    for row in query {
        use sqlx::Row;

        let library_status_str: String = row.try_get(2)?;
        let library_status = LibraryStatus::from_str(&library_status_str)
            .ok_or_else(|| anyhow::anyhow!("Invalid library status: {}", library_status_str))?;

        let library_entry = LibraryEntry {
            id: row.try_get(0)?,
            media_id: row.try_get(1)?,
            status: library_status,
            favorite: row.try_get(3)?,
            score: row.try_get(4)?,
            notes: row.try_get(5)?,
            added_at: row.try_get(6)?,
            updated_at: row.try_get(7)?,
        };

        let media = MediaEntry {
            id: row.try_get(8)?,
            extension_id: row.try_get(9)?,
            title: row.try_get(10)?,
            english_name: row.try_get(11)?,
            native_name: row.try_get(12)?,
            description: row.try_get(13)?,
            cover_url: row.try_get(14)?,
            banner_url: row.try_get(15)?,
            trailer_url: row.try_get(16)?,
            media_type: row.try_get(17)?,
            content_type: row.try_get(18)?,
            status: row.try_get(19)?,
            year: row.try_get(20)?,
            rating: row.try_get(21)?,
            episode_count: row.try_get(22)?,
            episode_duration: row.try_get(23)?,
            season_quarter: row.try_get(24)?,
            season_year: row.try_get(25)?,
            aired_start_year: row.try_get(26)?,
            aired_start_month: row.try_get(27)?,
            aired_start_date: row.try_get(28)?,
            genres: row.try_get(29)?,
            created_at: row.try_get(30)?,
            updated_at: row.try_get(31)?,
        };

        results.push(LibraryEntryWithMedia {
            library_entry,
            media,
        });
    }

    Ok(results)
}

/// Get favorites
#[allow(dead_code)]
pub async fn get_favorites(pool: &SqlitePool) -> Result<Vec<LibraryEntry>> {
    let entries = sqlx::query_as::<_, LibraryEntry>(
        r#"
        SELECT id, media_id, status, favorite, score, notes, added_at, updated_at
        FROM library
        WHERE favorite = 1
        ORDER BY updated_at DESC
        "#
    )
    .fetch_all(pool)
    .await?;

    Ok(entries)
}

/// Update library entry status
#[allow(dead_code)]
pub async fn update_library_status(
    pool: &SqlitePool,
    media_id: &str,
    status: LibraryStatus,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE library
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE media_id = ?
        "#
    )
    .bind(status.as_str())
    .bind(media_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Toggle favorite status
pub async fn toggle_favorite(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<bool> {
    // Get current favorite status
    let entry = get_library_entry(pool, media_id).await?
        .ok_or_else(|| anyhow::anyhow!("Media not in library"))?;

    let new_favorite = !entry.favorite;

    sqlx::query(
        r#"
        UPDATE library
        SET favorite = ?, updated_at = CURRENT_TIMESTAMP
        WHERE media_id = ?
        "#
    )
    .bind(new_favorite)
    .bind(media_id)
    .execute(pool)
    .await?;

    Ok(new_favorite)
}

/// Update score
#[allow(dead_code)]
pub async fn update_score(
    pool: &SqlitePool,
    media_id: &str,
    score: f64,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE library
        SET score = ?, updated_at = CURRENT_TIMESTAMP
        WHERE media_id = ?
        "#
    )
    .bind(score)
    .bind(media_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Update notes
#[allow(dead_code)]
pub async fn update_notes(
    pool: &SqlitePool,
    media_id: &str,
    notes: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE library
        SET notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE media_id = ?
        "#
    )
    .bind(notes)
    .bind(media_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Remove from library
pub async fn remove_from_library(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<()> {
    sqlx::query("DELETE FROM library WHERE media_id = ?")
        .bind(media_id)
        .execute(pool)
        .await?;

    log::debug!("Removed media {} from library", media_id);

    Ok(())
}

/// Check if media is in library
pub async fn is_in_library(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<bool> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM library WHERE media_id = ?")
        .bind(media_id)
        .fetch_one(pool)
        .await?;

    Ok(count > 0)
}

/// Bulk update library status for multiple items
pub async fn bulk_update_library_status(
    pool: &SqlitePool,
    media_ids: &[String],
    status: LibraryStatus,
) -> Result<()> {
    for media_id in media_ids {
        sqlx::query(
            r#"
            UPDATE library
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE media_id = ?
            "#
        )
        .bind(status.as_str())
        .bind(media_id)
        .execute(pool)
        .await?;
    }

    log::debug!("Bulk updated {} items to status {}", media_ids.len(), status.as_str());
    Ok(())
}

/// Bulk remove from library
pub async fn bulk_remove_from_library(
    pool: &SqlitePool,
    media_ids: &[String],
) -> Result<()> {
    for media_id in media_ids {
        sqlx::query("DELETE FROM library WHERE media_id = ?")
            .bind(media_id)
            .execute(pool)
            .await?;
    }

    log::debug!("Bulk removed {} items from library", media_ids.len());
    Ok(())
}

impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for LibraryEntry {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;

        let status_str: String = row.try_get("status")?;
        let status = LibraryStatus::from_str(&status_str)
            .ok_or_else(|| sqlx::Error::Decode(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Invalid library status: {}", status_str),
            ))))?;

        Ok(LibraryEntry {
            id: row.try_get("id")?,
            media_id: row.try_get("media_id")?,
            status,
            favorite: row.try_get("favorite")?,
            score: row.try_get("score")?,
            notes: row.try_get("notes")?,
            added_at: row.try_get("added_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}
