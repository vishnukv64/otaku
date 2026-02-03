// Library Tags Module
//
// Handles CRUD operations for library tags and tag assignments

use sqlx::SqlitePool;
use serde::{Deserialize, Serialize};
use anyhow::Result;
use super::library::LibraryEntryWithMedia;
use super::media::MediaEntry;
use super::library::{LibraryEntry, LibraryStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryTag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryTagWithCount {
    pub tag: LibraryTag,
    pub item_count: i64,
}

/// Create a new tag
pub async fn create_tag(
    pool: &SqlitePool,
    name: &str,
    color: &str,
) -> Result<LibraryTag> {
    // Get the max sort_order to put new tag at the end
    let max_order: Option<i32> = sqlx::query_scalar(
        "SELECT MAX(sort_order) FROM library_tags"
    )
    .fetch_one(pool)
    .await?;

    let sort_order = max_order.unwrap_or(0) + 1;

    sqlx::query(
        r#"
        INSERT INTO library_tags (name, color, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        "#
    )
    .bind(name)
    .bind(color)
    .bind(sort_order)
    .execute(pool)
    .await?;

    log::debug!("Created tag: {}", name);

    // Return the created tag
    let tag = sqlx::query_as::<_, LibraryTag>(
        r#"
        SELECT id, name, color, sort_order, created_at, updated_at
        FROM library_tags
        WHERE name = ?
        "#
    )
    .bind(name)
    .fetch_one(pool)
    .await?;

    Ok(tag)
}

/// Get all tags
pub async fn get_all_tags(pool: &SqlitePool) -> Result<Vec<LibraryTag>> {
    let tags = sqlx::query_as::<_, LibraryTag>(
        r#"
        SELECT id, name, color, sort_order, created_at, updated_at
        FROM library_tags
        ORDER BY sort_order ASC, name ASC
        "#
    )
    .fetch_all(pool)
    .await?;

    Ok(tags)
}

/// Get all tags with their item counts
pub async fn get_tags_with_counts(pool: &SqlitePool) -> Result<Vec<LibraryTagWithCount>> {
    use sqlx::Row;

    let rows = sqlx::query(
        r#"
        SELECT
            t.id, t.name, t.color, t.sort_order, t.created_at, t.updated_at,
            COUNT(a.id) as item_count
        FROM library_tags t
        LEFT JOIN library_tag_assignments a ON t.id = a.tag_id
        GROUP BY t.id
        ORDER BY t.sort_order ASC, t.name ASC
        "#
    )
    .fetch_all(pool)
    .await?;

    let mut results = Vec::new();
    for row in rows {
        let tag = LibraryTag {
            id: row.try_get(0)?,
            name: row.try_get(1)?,
            color: row.try_get(2)?,
            sort_order: row.try_get(3)?,
            created_at: row.try_get(4)?,
            updated_at: row.try_get(5)?,
        };
        let item_count: i64 = row.try_get(6)?;

        results.push(LibraryTagWithCount { tag, item_count });
    }

    Ok(results)
}

/// Update a tag
pub async fn update_tag(
    pool: &SqlitePool,
    tag_id: i64,
    name: Option<&str>,
    color: Option<&str>,
) -> Result<()> {
    if let Some(name) = name {
        sqlx::query(
            r#"
            UPDATE library_tags
            SET name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#
        )
        .bind(name)
        .bind(tag_id)
        .execute(pool)
        .await?;
    }

    if let Some(color) = color {
        sqlx::query(
            r#"
            UPDATE library_tags
            SET color = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#
        )
        .bind(color)
        .bind(tag_id)
        .execute(pool)
        .await?;
    }

    log::debug!("Updated tag {}", tag_id);

    Ok(())
}

/// Delete a tag
pub async fn delete_tag(pool: &SqlitePool, tag_id: i64) -> Result<()> {
    sqlx::query("DELETE FROM library_tags WHERE id = ?")
        .bind(tag_id)
        .execute(pool)
        .await?;

    log::debug!("Deleted tag {}", tag_id);

    Ok(())
}

/// Assign a tag to a media item (by media_id)
pub async fn assign_tag(
    pool: &SqlitePool,
    media_id: &str,
    tag_id: i64,
) -> Result<()> {
    // First, get the library entry ID for this media
    let library_entry_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM library WHERE media_id = ?"
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await?;

    let library_entry_id = library_entry_id
        .ok_or_else(|| anyhow::anyhow!("Media not found in library"))?;

    // Insert the assignment (ignore if already exists)
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO library_tag_assignments (library_entry_id, tag_id, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        "#
    )
    .bind(library_entry_id)
    .bind(tag_id)
    .execute(pool)
    .await?;

    log::debug!("Assigned tag {} to media {}", tag_id, media_id);

    Ok(())
}

/// Unassign a tag from a media item (by media_id)
pub async fn unassign_tag(
    pool: &SqlitePool,
    media_id: &str,
    tag_id: i64,
) -> Result<()> {
    // First, get the library entry ID for this media
    let library_entry_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM library WHERE media_id = ?"
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await?;

    if let Some(library_entry_id) = library_entry_id {
        sqlx::query(
            "DELETE FROM library_tag_assignments WHERE library_entry_id = ? AND tag_id = ?"
        )
        .bind(library_entry_id)
        .bind(tag_id)
        .execute(pool)
        .await?;

        log::debug!("Unassigned tag {} from media {}", tag_id, media_id);
    }

    Ok(())
}

/// Get all tags for a specific media item
pub async fn get_tags_for_media(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<Vec<LibraryTag>> {
    let tags = sqlx::query_as::<_, LibraryTag>(
        r#"
        SELECT t.id, t.name, t.color, t.sort_order, t.created_at, t.updated_at
        FROM library_tags t
        INNER JOIN library_tag_assignments a ON t.id = a.tag_id
        INNER JOIN library l ON a.library_entry_id = l.id
        WHERE l.media_id = ?
        ORDER BY t.sort_order ASC, t.name ASC
        "#
    )
    .bind(media_id)
    .fetch_all(pool)
    .await?;

    Ok(tags)
}

/// Get all library entries with a specific tag
pub async fn get_library_by_tag(
    pool: &SqlitePool,
    tag_id: i64,
) -> Result<Vec<LibraryEntryWithMedia>> {
    use sqlx::Row;

    let query = sqlx::query(
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
        INNER JOIN library_tag_assignments a ON l.id = a.library_entry_id
        WHERE a.tag_id = ?
        ORDER BY l.updated_at DESC
        "#
    )
    .bind(tag_id)
    .fetch_all(pool)
    .await?;

    let mut results = Vec::new();
    for row in query {
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

/// Bulk assign a tag to multiple media items
pub async fn bulk_assign_tag(
    pool: &SqlitePool,
    media_ids: &[String],
    tag_id: i64,
) -> Result<()> {
    for media_id in media_ids {
        // Get the library entry ID for this media
        let library_entry_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM library WHERE media_id = ?"
        )
        .bind(media_id)
        .fetch_optional(pool)
        .await?;

        if let Some(library_entry_id) = library_entry_id {
            // Insert the assignment (ignore if already exists)
            sqlx::query(
                r#"
                INSERT OR IGNORE INTO library_tag_assignments (library_entry_id, tag_id, created_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                "#
            )
            .bind(library_entry_id)
            .bind(tag_id)
            .execute(pool)
            .await?;
        }
    }

    log::debug!("Bulk assigned tag {} to {} items", tag_id, media_ids.len());
    Ok(())
}

/// Bulk unassign a tag from multiple media items
pub async fn bulk_unassign_tag(
    pool: &SqlitePool,
    media_ids: &[String],
    tag_id: i64,
) -> Result<()> {
    for media_id in media_ids {
        // Get the library entry ID for this media
        let library_entry_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM library WHERE media_id = ?"
        )
        .bind(media_id)
        .fetch_optional(pool)
        .await?;

        if let Some(library_entry_id) = library_entry_id {
            sqlx::query(
                "DELETE FROM library_tag_assignments WHERE library_entry_id = ? AND tag_id = ?"
            )
            .bind(library_entry_id)
            .bind(tag_id)
            .execute(pool)
            .await?;
        }
    }

    log::debug!("Bulk unassigned tag {} from {} items", tag_id, media_ids.len());
    Ok(())
}

impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for LibraryTag {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;

        Ok(LibraryTag {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            color: row.try_get("color")?,
            sort_order: row.try_get("sort_order")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}
