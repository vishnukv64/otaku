// Export/Import Module
//
// Handles exporting all user data to JSON and importing it back
// Enables users to transfer their data between devices

use sqlx::{SqlitePool, Row};
use serde::{Deserialize, Serialize};
use anyhow::Result;
use chrono::Utc;

use super::library::{LibraryEntry, LibraryStatus};
use super::watch_history::WatchHistory;
use super::reading_history::ReadingHistory;
use super::media::MediaEntry;
use super::tags::LibraryTag;

/// Format version for the export file
pub const EXPORT_FORMAT_VERSION: &str = "1.0.0";

/// Top-level export data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportData {
    pub format_version: String,
    pub app_version: String,
    pub exported_at: String,
    pub data: ExportedTables,
    pub metadata: ExportMetadata,
}

/// All exported database tables
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedTables {
    pub library: Vec<LibraryEntry>,
    pub watch_history: Vec<WatchHistory>,
    pub reading_history: Vec<ReadingHistory>,
    pub library_tags: Vec<LibraryTag>,
    pub tag_assignments: Vec<TagAssignment>,
    pub app_settings: Vec<AppSetting>,
    pub media_cache: Vec<MediaEntry>,
    pub tracker_mappings: Vec<TrackerMapping>,
}

/// Tag assignment record (library_tag_assignments table)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagAssignment {
    pub library_entry_id: i64,
    pub tag_id: i64,
    pub media_id: String, // Included for easier import resolution
    pub created_at: String,
}

/// App setting record (app_settings table)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSetting {
    pub key: String,
    pub value: String,
}

/// Tracker mapping record (tracker_mappings table)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerMapping {
    pub media_id: String,
    pub tracker_type: String,
    pub tracker_id: String,
    pub created_at: String,
}


/// Export metadata for summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportMetadata {
    pub library_count: usize,
    pub watch_history_count: usize,
    pub reading_history_count: usize,
    pub tag_count: usize,
    pub media_cache_count: usize,
}

/// Import strategy options
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportStrategy {
    /// Clear all existing data and import fresh
    ReplaceAll,
    /// Only import items that don't exist locally
    MergeKeepExisting,
    /// Overwrite existing items with imported data
    MergePreferImport,
}

/// Options for what to import
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportOptions {
    pub strategy: ImportStrategy,
    pub import_library: bool,
    pub import_watch_history: bool,
    pub import_reading_history: bool,
    pub import_tags: bool,
    pub import_settings: bool,
    pub import_media_cache: bool,
    pub import_tracker_mappings: bool,
}

impl Default for ImportOptions {
    fn default() -> Self {
        Self {
            strategy: ImportStrategy::MergeKeepExisting,
            import_library: true,
            import_watch_history: true,
            import_reading_history: true,
            import_tags: true,
            import_settings: true,
            import_media_cache: true,
            import_tracker_mappings: true,
        }
    }
}

/// Result of an import operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub success: bool,
    pub library_imported: usize,
    pub library_skipped: usize,
    pub watch_history_imported: usize,
    pub watch_history_skipped: usize,
    pub reading_history_imported: usize,
    pub reading_history_skipped: usize,
    pub tags_imported: usize,
    pub tags_skipped: usize,
    pub tag_assignments_imported: usize,
    pub settings_imported: usize,
    pub media_cache_imported: usize,
    pub tracker_mappings_imported: usize,
    pub warnings: Vec<String>,
}

impl Default for ImportResult {
    fn default() -> Self {
        Self {
            success: true,
            library_imported: 0,
            library_skipped: 0,
            watch_history_imported: 0,
            watch_history_skipped: 0,
            reading_history_imported: 0,
            reading_history_skipped: 0,
            tags_imported: 0,
            tags_skipped: 0,
            tag_assignments_imported: 0,
            settings_imported: 0,
            media_cache_imported: 0,
            tracker_mappings_imported: 0,
            warnings: Vec::new(),
        }
    }
}

/// Export all user data to a structured format
pub async fn export_all_data(
    pool: &SqlitePool,
    app_version: &str,
) -> Result<ExportData> {
    log::info!("Starting data export");

    // Export library entries
    let library = sqlx::query(
        r#"
        SELECT id, media_id, status, favorite, score, notes, added_at, updated_at
        FROM library
        ORDER BY added_at ASC
        "#
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        let status_str: String = row.try_get("status").unwrap_or_default();
        LibraryEntry {
            id: row.try_get("id").unwrap_or_default(),
            media_id: row.try_get("media_id").unwrap_or_default(),
            status: LibraryStatus::from_str(&status_str).unwrap_or(LibraryStatus::PlanToWatch),
            favorite: row.try_get("favorite").unwrap_or_default(),
            score: row.try_get("score").ok(),
            notes: row.try_get("notes").ok(),
            added_at: row.try_get("added_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        }
    })
    .collect::<Vec<_>>();

    log::debug!("Exported {} library entries", library.len());

    // Export watch history
    let watch_history = sqlx::query_as::<_, WatchHistory>(
        r#"
        SELECT id, media_id, episode_id, episode_number, progress_seconds, duration, completed, last_watched, created_at
        FROM watch_history
        ORDER BY created_at ASC
        "#
    )
    .fetch_all(pool)
    .await?;

    log::debug!("Exported {} watch history entries", watch_history.len());

    // Export reading history
    let reading_history = sqlx::query_as::<_, ReadingHistory>(
        r#"
        SELECT id, media_id, chapter_id, chapter_number, current_page, total_pages, completed, last_read, created_at
        FROM reading_history
        ORDER BY created_at ASC
        "#
    )
    .fetch_all(pool)
    .await?;

    log::debug!("Exported {} reading history entries", reading_history.len());

    // Export library tags
    let library_tags = sqlx::query_as::<_, LibraryTag>(
        r#"
        SELECT id, name, color, sort_order, created_at, updated_at
        FROM library_tags
        ORDER BY sort_order ASC
        "#
    )
    .fetch_all(pool)
    .await?;

    log::debug!("Exported {} library tags", library_tags.len());

    // Export tag assignments with media_id for easier import
    let tag_assignments = sqlx::query(
        r#"
        SELECT a.library_entry_id, a.tag_id, l.media_id, a.created_at
        FROM library_tag_assignments a
        INNER JOIN library l ON a.library_entry_id = l.id
        ORDER BY a.created_at ASC
        "#
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| TagAssignment {
        library_entry_id: row.try_get("library_entry_id").unwrap_or_default(),
        tag_id: row.try_get("tag_id").unwrap_or_default(),
        media_id: row.try_get("media_id").unwrap_or_default(),
        created_at: row.try_get("created_at").unwrap_or_default(),
    })
    .collect::<Vec<_>>();

    log::debug!("Exported {} tag assignments", tag_assignments.len());

    // Export app settings
    let app_settings = sqlx::query(
        r#"
        SELECT key, value FROM app_settings
        "#
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| AppSetting {
        key: row.try_get("key").unwrap_or_default(),
        value: row.try_get("value").unwrap_or_default(),
    })
    .collect::<Vec<_>>();

    log::debug!("Exported {} app settings", app_settings.len());

    // Export media cache
    let media_cache = sqlx::query_as::<_, MediaEntry>(
        r#"
        SELECT
            id, extension_id, title, english_name, native_name, description,
            cover_url, banner_url, trailer_url, media_type, content_type, status,
            year, rating, episode_count, episode_duration,
            season_quarter, season_year,
            aired_start_year, aired_start_month, aired_start_date,
            genres, created_at, updated_at
        FROM media
        ORDER BY created_at ASC
        "#
    )
    .fetch_all(pool)
    .await?;

    log::debug!("Exported {} media cache entries", media_cache.len());

    // Export tracker mappings
    let tracker_mappings = sqlx::query(
        r#"
        SELECT media_id, tracker_type, tracker_id, created_at
        FROM tracker_mappings
        ORDER BY created_at ASC
        "#
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|row| TrackerMapping {
        media_id: row.try_get("media_id").unwrap_or_default(),
        tracker_type: row.try_get("tracker_type").unwrap_or_default(),
        tracker_id: row.try_get("tracker_id").unwrap_or_default(),
        created_at: row.try_get("created_at").unwrap_or_default(),
    })
    .collect::<Vec<_>>();

    log::debug!("Exported {} tracker mappings", tracker_mappings.len());

    let metadata = ExportMetadata {
        library_count: library.len(),
        watch_history_count: watch_history.len(),
        reading_history_count: reading_history.len(),
        tag_count: library_tags.len(),
        media_cache_count: media_cache.len(),
    };

    let export_data = ExportData {
        format_version: EXPORT_FORMAT_VERSION.to_string(),
        app_version: app_version.to_string(),
        exported_at: Utc::now().to_rfc3339(),
        data: ExportedTables {
            library,
            watch_history,
            reading_history,
            library_tags,
            tag_assignments,
            app_settings,
            media_cache,
            tracker_mappings,
        },
        metadata,
    };

    log::info!("Data export completed successfully");

    Ok(export_data)
}

/// Import data from an export file
pub async fn import_data(
    pool: &SqlitePool,
    data: ExportData,
    options: ImportOptions,
) -> Result<ImportResult> {
    log::info!("Starting data import with strategy: {:?}", options.strategy);

    let mut result = ImportResult::default();

    // Validate format version
    if data.format_version != EXPORT_FORMAT_VERSION {
        result.warnings.push(format!(
            "Export file version {} differs from current version {}. Some data may not import correctly.",
            data.format_version, EXPORT_FORMAT_VERSION
        ));
    }

    // Clear existing data if replace strategy
    if matches!(options.strategy, ImportStrategy::ReplaceAll) {
        log::info!("Clearing existing data for ReplaceAll strategy");

        if options.import_tags {
            sqlx::query("DELETE FROM library_tag_assignments").execute(pool).await?;
            sqlx::query("DELETE FROM library_tags").execute(pool).await?;
        }
        if options.import_library {
            sqlx::query("DELETE FROM library").execute(pool).await?;
        }
        if options.import_watch_history {
            sqlx::query("DELETE FROM watch_history").execute(pool).await?;
        }
        if options.import_reading_history {
            sqlx::query("DELETE FROM reading_history").execute(pool).await?;
        }
        if options.import_settings {
            sqlx::query("DELETE FROM app_settings").execute(pool).await?;
        }
        if options.import_media_cache {
            sqlx::query("DELETE FROM media").execute(pool).await?;
        }
        if options.import_tracker_mappings {
            let _ = sqlx::query("DELETE FROM tracker_mappings").execute(pool).await;
        }
    }

    // Import media cache first (other tables reference it)
    if options.import_media_cache {
        for media in &data.data.media_cache {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM media WHERE id = ?)"
            )
            .bind(&media.id)
            .fetch_one(pool)
            .await?;

            let should_import = match options.strategy {
                ImportStrategy::ReplaceAll => true,
                ImportStrategy::MergeKeepExisting => !exists,
                ImportStrategy::MergePreferImport => true,
            };

            if should_import {
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
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        english_name = excluded.english_name,
                        native_name = excluded.native_name,
                        description = excluded.description,
                        cover_url = excluded.cover_url,
                        banner_url = excluded.banner_url,
                        trailer_url = excluded.trailer_url,
                        status = excluded.status,
                        year = excluded.year,
                        rating = excluded.rating,
                        episode_count = excluded.episode_count,
                        genres = excluded.genres,
                        updated_at = excluded.updated_at
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
                .bind(&media.created_at)
                .bind(&media.updated_at)
                .execute(pool)
                .await?;

                result.media_cache_imported += 1;
            }
        }
        log::debug!("Imported {} media cache entries", result.media_cache_imported);
    }

    // Import library entries
    if options.import_library {
        for entry in &data.data.library {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM library WHERE media_id = ?)"
            )
            .bind(&entry.media_id)
            .fetch_one(pool)
            .await?;

            let should_import = match options.strategy {
                ImportStrategy::ReplaceAll => true,
                ImportStrategy::MergeKeepExisting => !exists,
                ImportStrategy::MergePreferImport => true,
            };

            if should_import {
                sqlx::query(
                    r#"
                    INSERT INTO library (media_id, status, favorite, score, notes, added_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(media_id) DO UPDATE SET
                        status = excluded.status,
                        favorite = excluded.favorite,
                        score = excluded.score,
                        notes = excluded.notes,
                        updated_at = excluded.updated_at
                    "#
                )
                .bind(&entry.media_id)
                .bind(entry.status.as_str())
                .bind(entry.favorite)
                .bind(entry.score)
                .bind(&entry.notes)
                .bind(&entry.added_at)
                .bind(&entry.updated_at)
                .execute(pool)
                .await?;

                result.library_imported += 1;
            } else {
                result.library_skipped += 1;
            }
        }
        log::debug!("Imported {} library entries, skipped {}", result.library_imported, result.library_skipped);
    }

    // Import watch history
    if options.import_watch_history {
        for entry in &data.data.watch_history {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM watch_history WHERE media_id = ? AND episode_id = ?)"
            )
            .bind(&entry.media_id)
            .bind(&entry.episode_id)
            .fetch_one(pool)
            .await?;

            let should_import = match options.strategy {
                ImportStrategy::ReplaceAll => true,
                ImportStrategy::MergeKeepExisting => !exists,
                ImportStrategy::MergePreferImport => true,
            };

            if should_import {
                sqlx::query(
                    r#"
                    INSERT INTO watch_history (media_id, episode_id, episode_number, progress_seconds, duration, completed, last_watched, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(media_id, episode_id) DO UPDATE SET
                        progress_seconds = excluded.progress_seconds,
                        duration = excluded.duration,
                        completed = excluded.completed,
                        last_watched = excluded.last_watched
                    "#
                )
                .bind(&entry.media_id)
                .bind(&entry.episode_id)
                .bind(entry.episode_number)
                .bind(entry.progress_seconds)
                .bind(entry.duration)
                .bind(entry.completed)
                .bind(&entry.last_watched)
                .bind(&entry.created_at)
                .execute(pool)
                .await?;

                result.watch_history_imported += 1;
            } else {
                result.watch_history_skipped += 1;
            }
        }
        log::debug!("Imported {} watch history entries, skipped {}", result.watch_history_imported, result.watch_history_skipped);
    }

    // Import reading history
    if options.import_reading_history {
        for entry in &data.data.reading_history {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM reading_history WHERE media_id = ? AND chapter_id = ?)"
            )
            .bind(&entry.media_id)
            .bind(&entry.chapter_id)
            .fetch_one(pool)
            .await?;

            let should_import = match options.strategy {
                ImportStrategy::ReplaceAll => true,
                ImportStrategy::MergeKeepExisting => !exists,
                ImportStrategy::MergePreferImport => true,
            };

            if should_import {
                sqlx::query(
                    r#"
                    INSERT INTO reading_history (media_id, chapter_id, chapter_number, current_page, total_pages, completed, last_read, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(media_id, chapter_id) DO UPDATE SET
                        current_page = excluded.current_page,
                        total_pages = excluded.total_pages,
                        completed = excluded.completed,
                        last_read = excluded.last_read
                    "#
                )
                .bind(&entry.media_id)
                .bind(&entry.chapter_id)
                .bind(entry.chapter_number)
                .bind(entry.current_page)
                .bind(entry.total_pages)
                .bind(entry.completed)
                .bind(&entry.last_read)
                .bind(&entry.created_at)
                .execute(pool)
                .await?;

                result.reading_history_imported += 1;
            } else {
                result.reading_history_skipped += 1;
            }
        }
        log::debug!("Imported {} reading history entries, skipped {}", result.reading_history_imported, result.reading_history_skipped);
    }

    // Import library tags
    // We need to track old_id -> new_id mapping for tag assignments
    let mut tag_id_map: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();

    if options.import_tags {
        for tag in &data.data.library_tags {
            let existing_id: Option<i64> = sqlx::query_scalar(
                "SELECT id FROM library_tags WHERE name = ?"
            )
            .bind(&tag.name)
            .fetch_optional(pool)
            .await?;

            let should_import = match options.strategy {
                ImportStrategy::ReplaceAll => true,
                ImportStrategy::MergeKeepExisting => existing_id.is_none(),
                ImportStrategy::MergePreferImport => true,
            };

            if should_import {
                sqlx::query(
                    r#"
                    INSERT INTO library_tags (name, color, sort_order, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(name) DO UPDATE SET
                        color = excluded.color,
                        sort_order = excluded.sort_order,
                        updated_at = excluded.updated_at
                    "#
                )
                .bind(&tag.name)
                .bind(&tag.color)
                .bind(tag.sort_order)
                .bind(&tag.created_at)
                .bind(&tag.updated_at)
                .execute(pool)
                .await?;

                // Get the new ID for this tag
                let new_id: i64 = sqlx::query_scalar(
                    "SELECT id FROM library_tags WHERE name = ?"
                )
                .bind(&tag.name)
                .fetch_one(pool)
                .await?;

                tag_id_map.insert(tag.id, new_id);
                result.tags_imported += 1;
            } else if let Some(existing) = existing_id {
                tag_id_map.insert(tag.id, existing);
                result.tags_skipped += 1;
            }
        }
        log::debug!("Imported {} tags, skipped {}", result.tags_imported, result.tags_skipped);

        // Import tag assignments
        for assignment in &data.data.tag_assignments {
            // Get the new tag ID from our mapping
            let new_tag_id = match tag_id_map.get(&assignment.tag_id) {
                Some(id) => *id,
                None => {
                    result.warnings.push(format!(
                        "Tag assignment skipped: tag ID {} not found in import",
                        assignment.tag_id
                    ));
                    continue;
                }
            };

            // Get the library entry ID for this media_id
            let library_entry_id: Option<i64> = sqlx::query_scalar(
                "SELECT id FROM library WHERE media_id = ?"
            )
            .bind(&assignment.media_id)
            .fetch_optional(pool)
            .await?;

            let library_entry_id = match library_entry_id {
                Some(id) => id,
                None => {
                    // Library entry doesn't exist, skip this assignment
                    continue;
                }
            };

            // Insert assignment (ignore if already exists)
            let insert_result = sqlx::query(
                r#"
                INSERT OR IGNORE INTO library_tag_assignments (library_entry_id, tag_id, created_at)
                VALUES (?, ?, ?)
                "#
            )
            .bind(library_entry_id)
            .bind(new_tag_id)
            .bind(&assignment.created_at)
            .execute(pool)
            .await?;

            if insert_result.rows_affected() > 0 {
                result.tag_assignments_imported += 1;
            }
        }
        log::debug!("Imported {} tag assignments", result.tag_assignments_imported);
    }

    // Import app settings
    if options.import_settings {
        for setting in &data.data.app_settings {
            sqlx::query(
                r#"
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (?, ?, strftime('%s', 'now') * 1000)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = strftime('%s', 'now') * 1000
                "#
            )
            .bind(&setting.key)
            .bind(&setting.value)
            .execute(pool)
            .await?;

            result.settings_imported += 1;
        }
        log::debug!("Imported {} app settings", result.settings_imported);
    }

    // Import tracker mappings
    if options.import_tracker_mappings {
        for mapping in &data.data.tracker_mappings {
            let _ = sqlx::query(
                r#"
                INSERT INTO tracker_mappings (media_id, tracker_type, tracker_id, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(media_id, tracker_type) DO UPDATE SET
                    tracker_id = excluded.tracker_id
                "#
            )
            .bind(&mapping.media_id)
            .bind(&mapping.tracker_type)
            .bind(&mapping.tracker_id)
            .bind(&mapping.created_at)
            .execute(pool)
            .await;

            result.tracker_mappings_imported += 1;
        }
        log::debug!("Imported {} tracker mappings", result.tracker_mappings_imported);
    }

    log::info!("Data import completed successfully");

    Ok(result)
}
