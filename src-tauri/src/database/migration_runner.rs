// Migration Runner — AllAnime → Jikan data migration
//
// On first launch after upgrade, detects unmigrated data (extension_id = 'allanime'
// or 'allanime-manga'), resolves each title to a MAL ID via Jikan search, and rewrites
// all database references. Archives unmatched entries for potential manual recovery.

use crate::jikan::anime::extract_image_url;
use crate::jikan::bridge::title_similarity;
use crate::jikan::client::JIKAN;
use crate::jikan::types::*;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Progress information emitted to frontend during migration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationProgress {
    pub total: usize,
    pub processed: usize,
    pub matched: usize,
    pub archived: usize,
    pub failed: usize,
    pub current_title: String,
    pub status: String, // "pending" | "running" | "completed" | "error"
}

impl Default for MigrationProgress {
    fn default() -> Self {
        Self {
            total: 0,
            processed: 0,
            matched: 0,
            archived: 0,
            failed: 0,
            current_title: String::new(),
            status: "pending".to_string(),
        }
    }
}

lazy_static::lazy_static! {
    /// Shared progress state accessible from commands
    pub static ref MIGRATION_PROGRESS: Arc<Mutex<MigrationProgress>> =
        Arc::new(Mutex::new(MigrationProgress::default()));
}

/// A single AllAnime media entry pending migration
struct PendingEntry {
    id: String,
    extension_id: String,
    title: String,
    english_name: Option<String>,
    media_type: String,
    year: Option<i32>,
}

/// Check whether there are AllAnime entries that need migrating
pub async fn needs_migration(pool: &SqlitePool) -> Result<bool, String> {
    // First check if migration was already completed
    let completed: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'migration_v1_status'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error checking migration status: {}", e))?;

    if completed.as_deref() == Some("completed") {
        return Ok(false);
    }

    // Check if there are any AllAnime ANIME entries left to migrate
    // Note: manga stays on AllAnime (Jikan is only used for anime metadata)
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM media WHERE extension_id IN ('allanime', 'com.allanime.source') AND media_type != 'manga'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("DB error counting AllAnime entries: {}", e))?;

    Ok(count > 0)
}

/// Run the full migration. Spawns blocking work on a tokio task.
/// Emits "migration_progress" events to the frontend as it runs.
pub async fn run_migration(pool: SqlitePool, app_handle: AppHandle) -> Result<(), String> {
    // Prevent concurrent migration runs (e.g. React strict mode double-mounting)
    {
        let progress = MIGRATION_PROGRESS.lock().unwrap();
        if progress.status == "running" {
            log::warn!("Migration already in progress, skipping duplicate call");
            return Ok(());
        }
    }

    // Get all AllAnime entries to migrate
    let entries: Vec<PendingEntry> = sqlx::query(
        r#"
        SELECT id, extension_id, title, english_name, media_type, year
        FROM media
        WHERE extension_id IN ('allanime', 'com.allanime.source')
          AND media_type != 'manga'
        ORDER BY title
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to fetch entries for migration: {}", e))?
    .into_iter()
    .map(|row| PendingEntry {
        id: row.get("id"),
        extension_id: row.get("extension_id"),
        title: row.get("title"),
        english_name: row.get("english_name"),
        media_type: row.get("media_type"),
        year: row.get("year"),
    })
    .collect();

    let total = entries.len();

    {
        let mut progress = MIGRATION_PROGRESS.lock().unwrap();
        *progress = MigrationProgress {
            total,
            status: "running".to_string(),
            ..Default::default()
        };
    }

    emit_progress(&app_handle);

    for entry in &entries {
        // Update current title
        {
            let mut progress = MIGRATION_PROGRESS.lock().unwrap();
            progress.current_title = entry.title.clone();
        }
        emit_progress(&app_handle);

        // Search Jikan for a match (blocking HTTP call via ureq)
        let mal_match = tokio::task::spawn_blocking({
            let title = entry.title.clone();
            let english_name = entry.english_name.clone();
            let year = entry.year;
            move || search_jikan_for_match(&title, english_name.as_deref(), year)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?;

        match mal_match {
            Ok(Some((mal_id, jikan_data))) => {
                // Check if MAL ID already exists in media table
                // (from a previous entry in this run, or from Jikan frontend browsing)
                let existing: Option<String> = sqlx::query_scalar(
                    "SELECT id FROM media WHERE id = ?",
                )
                .bind(&mal_id)
                .fetch_optional(&pool)
                .await
                .map_err(|e| format!("DB error: {}", e))?;

                let is_duplicate = existing.is_some() && existing.as_deref() != Some(&entry.id);

                if is_duplicate {
                    // MAL ID already taken — merge user data into existing row
                    log::info!(
                        "Migration: merging duplicate '{}' → existing MAL ID {}",
                        entry.title, mal_id
                    );
                    merge_into_existing(&pool, &entry.id, &mal_id).await?;
                } else {
                    // Normal migration — try insert-reparent-delete
                    match migrate_single_entry(&pool, &entry, &mal_id, &jikan_data).await {
                        Ok(()) => {
                            log::info!(
                                "Migration: '{}' ({}) → MAL ID {}",
                                entry.title, entry.id, mal_id
                            );
                        }
                        Err(e) if e.contains("UNIQUE constraint") => {
                            // Race/edge case: MAL ID appeared between check and insert.
                            // Fall back to merge.
                            log::warn!(
                                "Migration: UNIQUE conflict for '{}', falling back to merge → MAL ID {}",
                                entry.title, mal_id
                            );
                            merge_into_existing(&pool, &entry.id, &mal_id).await?;
                        }
                        Err(e) => {
                            log::error!(
                                "Migration failed for '{}': {}",
                                entry.title, e
                            );
                            archive_entry_with_error(&pool, &entry.id, &e).await?;
                            let mut progress = MIGRATION_PROGRESS.lock().unwrap();
                            progress.failed += 1;
                            progress.processed += 1;
                            emit_progress(&app_handle);
                            continue;
                        }
                    }
                }

                let mut progress = MIGRATION_PROGRESS.lock().unwrap();
                progress.matched += 1;
            }
            Ok(None) => {
                // No match found — archive the entry
                log::warn!("Migration: no Jikan match for '{}' ({})", entry.title, entry.id);
                archive_entry(&pool, &entry.id, None, "archived").await?;

                let mut progress = MIGRATION_PROGRESS.lock().unwrap();
                progress.archived += 1;
            }
            Err(e) => {
                // API error — archive with error message
                log::error!(
                    "Migration: Jikan search failed for '{}': {}",
                    entry.title, e
                );
                archive_entry_with_error(&pool, &entry.id, &e).await?;

                let mut progress = MIGRATION_PROGRESS.lock().unwrap();
                progress.failed += 1;
            }
        }

        {
            let mut progress = MIGRATION_PROGRESS.lock().unwrap();
            progress.processed += 1;
        }
        emit_progress(&app_handle);

        // Rate limit: ~350ms between Jikan searches
        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
    }

    // Clear discover cache (it's stale after migration)
    let _ = sqlx::query("DELETE FROM discover_cache")
        .execute(&pool)
        .await;

    // Mark migration as completed
    sqlx::query(
        "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('migration_v1_status', 'completed', strftime('%s', 'now') * 1000)",
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to mark migration complete: {}", e))?;

    {
        let mut progress = MIGRATION_PROGRESS.lock().unwrap();
        progress.status = "completed".to_string();
        progress.current_title = String::new();
    }
    emit_progress(&app_handle);

    log::info!("Migration completed successfully");

    Ok(())
}

/// Emit current progress to the frontend
fn emit_progress(app_handle: &AppHandle) {
    let progress = MIGRATION_PROGRESS.lock().unwrap().clone();
    let _ = app_handle.emit("migration_progress", &progress);
}

/// Search Jikan API for an anime title match, returning (mal_id_string, JikanSearchData)
fn search_jikan_for_match(
    title: &str,
    english_name: Option<&str>,
    year: Option<i32>,
) -> Result<Option<(String, JikanSearchData)>, String> {
    // Try english name first (often more unique), then original title
    let queries: Vec<&str> = [english_name, Some(title)]
        .iter()
        .filter_map(|q| *q)
        .collect();

    let mut best_match: Option<(String, f64, JikanSearchData)> = None;

    for query in &queries {
        let results = search_jikan_anime(query)?;

        for item in &results {
            let mut score = title_similarity(&item.title, title) * 10.0;

            // Score against english name
            if let Some(eng) = english_name {
                let eng_score = title_similarity(&item.title, eng) * 10.0;
                score = score.max(eng_score);

                if let Some(ref item_eng) = item.title_english {
                    let cross = title_similarity(item_eng, eng) * 10.0;
                    score = score.max(cross);
                }
            }

            if let Some(ref item_eng) = item.title_english {
                let eng_score = title_similarity(item_eng, title) * 10.0;
                score = score.max(eng_score);
            }

            // Year bonus
            if let (Some(item_year), Some(search_year)) = (item.year, year) {
                if item_year == search_year {
                    score += 3.0;
                }
            }

            let dominated = best_match.as_ref().map_or(false, |(_, s, _)| score <= *s);
            if !dominated && score > 5.0 {
                best_match = Some((item.mal_id.to_string(), score, item.clone()));
            }
        }

        // Stop early on strong match
        if best_match.as_ref().map_or(false, |(_, s, _)| *s >= 8.0) {
            break;
        }
    }

    Ok(best_match.map(|(id, _, data)| (id, data)))
}

/// Minimal data from Jikan search results needed for migration
#[derive(Debug, Clone)]
struct JikanSearchData {
    mal_id: i64,
    title: String,
    title_english: Option<String>,
    title_japanese: Option<String>,
    synopsis: Option<String>,
    images: JikanImages,
    score: Option<f64>,
    status: Option<String>,
    year: Option<i32>,
    genres: Option<Vec<JikanMalEntry>>,
    media_sub_type: Option<String>, // TV, Movie, Manga, etc.
    episode_count: Option<i32>,
}

fn search_jikan_anime(query: &str) -> Result<Vec<JikanSearchData>, String> {
    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query("/anime", &[("q", query), ("limit", "5"), ("sfw", "true")])?;

    Ok(response
        .data
        .into_iter()
        .map(|a| JikanSearchData {
            mal_id: a.mal_id,
            title: a.title,
            title_english: a.title_english,
            title_japanese: a.title_japanese,
            synopsis: a.synopsis,
            images: a.images,
            score: a.score,
            status: a.status,
            year: a.year,
            genres: a.genres,
            media_sub_type: a.anime_type,
            episode_count: a.episodes,
        })
        .collect())
}

/// Migrate a single AllAnime entry to its Jikan equivalent.
/// Runs the entire operation in one transaction:
/// 1. Insert new media row with Jikan metadata
/// 2. Reparent all child table references
/// 3. Save bridge mapping
/// 4. Record in migration archive
/// 5. Delete old media row
async fn migrate_single_entry(
    pool: &SqlitePool,
    entry: &PendingEntry,
    mal_id: &str,
    jikan_data: &JikanSearchData,
) -> Result<(), String> {
    let old_id = &entry.id;
    let cover_url = extract_image_url(&jikan_data.images);
    let genres_json = jikan_data
        .genres
        .as_ref()
        .map(|g| {
            serde_json::to_string(&g.iter().map(|e| &e.name).collect::<Vec<_>>())
                .unwrap_or_default()
        });

    // Map Jikan status to our internal status format
    let status = jikan_data.status.as_deref().map(|s| match s {
        "Currently Airing" => "Releasing",
        "Finished Airing" => "Completed",
        "Not yet aired" => "Not Yet Released",
        "Publishing" => "Releasing",
        "Finished" => "Completed",
        "On Hiatus" => "On Hiatus",
        "Discontinued" => "Discontinued",
        other => other,
    });

    // We must temporarily disable FK checks to do the insert-delete dance.
    // This is because child tables have UNIQUE constraints that reference the old ID,
    // and we need to reparent them BETWEEN the insert and delete.
    // Actually, let's use a transaction and do insert new → reparent → delete old.
    // FK checks are fine as long as we insert first.
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    // 1. Insert new media row with Jikan metadata
    sqlx::query(
        r#"
        INSERT INTO media (
            id, extension_id, title, english_name, native_name, description,
            cover_url, media_type, content_type, status, year, rating,
            episode_count, genres, created_at, updated_at
        ) VALUES (?, 'jikan', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        "#,
    )
    .bind(mal_id)
    .bind(&jikan_data.title)
    .bind(&jikan_data.title_english)
    .bind(&jikan_data.title_japanese)
    .bind(&jikan_data.synopsis)
    .bind(&cover_url)
    .bind(&entry.media_type)
    .bind(&jikan_data.media_sub_type)
    .bind(status)
    .bind(jikan_data.year)
    .bind(jikan_data.score)
    .bind(jikan_data.episode_count)
    .bind(&genres_json)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to insert new media row: {}", e))?;

    // 2. Reparent all child tables
    // Episodes: update media_id and rebuild episode ID
    sqlx::query(
        "UPDATE episodes SET media_id = ?, id = ? || '-' || number, extension_id = 'jikan' WHERE media_id = ?",
    )
    .bind(mal_id)
    .bind(mal_id)
    .bind(old_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to update episodes: {}", e))?;

    // Watch history: update media_id and rebuild episode_id
    sqlx::query(
        "UPDATE watch_history SET media_id = ?, episode_id = ? || '-' || episode_number WHERE media_id = ?",
    )
    .bind(mal_id)
    .bind(mal_id)
    .bind(old_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to update watch_history: {}", e))?;

    // Note: reading_history and chapter_downloads are manga-only — not migrated

    // Library: update media_id (has UNIQUE constraint, use INSERT OR IGNORE to avoid collision)
    sqlx::query("UPDATE library SET media_id = ? WHERE media_id = ?")
        .bind(mal_id)
        .bind(old_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to update library: {}", e))?;

    // Downloads: no FK constraint, just update
    sqlx::query(
        "UPDATE downloads SET media_id = ?, episode_id = ? || '-' || episode_number WHERE media_id = ?",
    )
    .bind(mal_id)
    .bind(mal_id)
    .bind(old_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to update downloads: {}", e))?;

    // Release tracking (v1)
    sqlx::query(
        "UPDATE release_tracking SET media_id = ?, extension_id = 'jikan' WHERE media_id = ?",
    )
    .bind(mal_id)
    .bind(old_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to update release_tracking: {}", e))?;

    // Release tracking v2
    sqlx::query(
        "UPDATE release_tracking_v2 SET media_id = ?, extension_id = 'jikan' WHERE media_id = ?",
    )
    .bind(mal_id)
    .bind(old_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to update release_tracking_v2: {}", e))?;

    // Release check log
    sqlx::query("UPDATE release_check_log SET media_id = ? WHERE media_id = ?")
        .bind(mal_id)
        .bind(old_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to update release_check_log: {}", e))?;

    // Tracker mappings
    sqlx::query("UPDATE tracker_mappings SET media_id = ? WHERE media_id = ?")
        .bind(mal_id)
        .bind(old_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to update tracker_mappings: {}", e))?;

    // 3. Save bridge mapping for future AllAnime lookups
    sqlx::query(
        "INSERT OR REPLACE INTO id_mappings (mal_id, allanime_id, media_type, title) VALUES (?, ?, ?, ?)",
    )
    .bind(mal_id)
    .bind(old_id)
    .bind(&entry.media_type)
    .bind(&entry.title)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to save id_mapping: {}", e))?;

    // 4. Record in migration archive
    sqlx::query(
        r#"
        INSERT OR REPLACE INTO migration_archive (
            original_id, original_extension_id, media_type, title, english_name,
            new_mal_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'matched')
        "#,
    )
    .bind(old_id)
    .bind(&entry.extension_id)
    .bind(&entry.media_type)
    .bind(&entry.title)
    .bind(&entry.english_name)
    .bind(mal_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to record in migration_archive: {}", e))?;

    // 5. Delete old media row (all children already reparented)
    sqlx::query("DELETE FROM media WHERE id = ?")
        .bind(old_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete old media row: {}", e))?;

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit migration transaction: {}", e))?;

    Ok(())
}

/// Merge user data from a duplicate AllAnime entry into an existing MAL row.
/// Used when two AllAnime slugs resolve to the same MAL ID.
async fn merge_into_existing(
    pool: &SqlitePool,
    old_id: &str,
    mal_id: &str,
) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin merge transaction: {}", e))?;

    // Reparent watch history (INSERT OR IGNORE to skip duplicates)
    let watch_rows: Vec<(i32, f64, Option<f64>, bool, String)> = sqlx::query_as(
        "SELECT episode_number, progress_seconds, duration, completed, last_watched FROM watch_history WHERE media_id = ?",
    )
    .bind(old_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| format!("Failed to fetch watch history for merge: {}", e))?;

    for (ep_num, progress, duration, completed, last_watched) in &watch_rows {
        let new_ep_id = format!("{}-{}", mal_id, ep_num);
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO watch_history (media_id, episode_id, episode_number, progress_seconds, duration, completed, last_watched)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(mal_id)
        .bind(&new_ep_id)
        .bind(ep_num)
        .bind(progress)
        .bind(duration)
        .bind(completed)
        .bind(last_watched)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to merge watch history: {}", e))?;
    }

    // Note: reading_history is manga-only — not migrated

    // Library: INSERT OR IGNORE (keep existing)
    sqlx::query(
        "INSERT OR IGNORE INTO library (media_id, status) SELECT ?, status FROM library WHERE media_id = ?",
    )
    .bind(mal_id)
    .bind(old_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to merge library: {}", e))?;

    // Delete the old AllAnime entry (CASCADE cleans children)
    sqlx::query("DELETE FROM media WHERE id = ?")
        .bind(old_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete duplicate entry: {}", e))?;

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit merge: {}", e))?;

    Ok(())
}

/// Archive an entry that couldn't be matched (or was merged as a duplicate).
/// Serializes the original data as JSON for potential manual recovery.
async fn archive_entry(
    pool: &SqlitePool,
    old_id: &str,
    new_mal_id: Option<&str>,
    status: &str,
) -> Result<(), String> {
    // Serialize the media row
    let media_json: Option<String> = sqlx::query_scalar(
        r#"
        SELECT json_object(
            'id', id, 'extension_id', extension_id, 'title', title,
            'english_name', english_name, 'media_type', media_type,
            'status', status, 'year', year, 'rating', rating,
            'cover_url', cover_url, 'genres', genres
        ) FROM media WHERE id = ?
        "#,
    )
    .bind(old_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to serialize media: {}", e))?;

    // Serialize child data
    let children_json = serialize_children(pool, old_id).await?;

    // Get entry metadata
    let row = sqlx::query("SELECT extension_id, title, english_name, media_type FROM media WHERE id = ?")
        .bind(old_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?;

    if let Some(row) = row {
        let extension_id: String = row.get("extension_id");
        let title: String = row.get("title");
        let english_name: Option<String> = row.get("english_name");
        let media_type: String = row.get("media_type");

        sqlx::query(
            r#"
            INSERT OR REPLACE INTO migration_archive (
                original_id, original_extension_id, media_type, title, english_name,
                new_mal_id, status, original_media_json, original_children_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(old_id)
        .bind(&extension_id)
        .bind(&media_type)
        .bind(&title)
        .bind(&english_name)
        .bind(new_mal_id)
        .bind(status)
        .bind(&media_json)
        .bind(&children_json)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to archive entry: {}", e))?;

        // Delete the original (CASCADE cleans children)
        if status == "archived" {
            sqlx::query("DELETE FROM media WHERE id = ?")
                .bind(old_id)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to delete archived entry: {}", e))?;
        }
    }

    Ok(())
}

/// Archive an entry that failed due to API error
async fn archive_entry_with_error(
    pool: &SqlitePool,
    old_id: &str,
    error: &str,
) -> Result<(), String> {
    let row = sqlx::query("SELECT extension_id, title, english_name, media_type FROM media WHERE id = ?")
        .bind(old_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?;

    if let Some(row) = row {
        let extension_id: String = row.get("extension_id");
        let title: String = row.get("title");
        let english_name: Option<String> = row.get("english_name");
        let media_type: String = row.get("media_type");

        let media_json: Option<String> = sqlx::query_scalar(
            r#"
            SELECT json_object(
                'id', id, 'extension_id', extension_id, 'title', title,
                'english_name', english_name, 'media_type', media_type,
                'status', status, 'year', year, 'rating', rating,
                'cover_url', cover_url, 'genres', genres
            ) FROM media WHERE id = ?
            "#,
        )
        .bind(old_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to serialize media: {}", e))?;

        let children_json = serialize_children(pool, old_id).await?;

        sqlx::query(
            r#"
            INSERT OR REPLACE INTO migration_archive (
                original_id, original_extension_id, media_type, title, english_name,
                status, error_message, original_media_json, original_children_json
            ) VALUES (?, ?, ?, ?, ?, 'failed', ?, ?, ?)
            "#,
        )
        .bind(old_id)
        .bind(&extension_id)
        .bind(&media_type)
        .bind(&title)
        .bind(&english_name)
        .bind(error)
        .bind(&media_json)
        .bind(&children_json)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to archive failed entry: {}", e))?;

        // Don't delete failed entries — leave them for retry on next launch
    }

    Ok(())
}

/// Serialize child data (watch history, reading history, library) as JSON for archival
async fn serialize_children(pool: &SqlitePool, media_id: &str) -> Result<Option<String>, String> {
    // Collect watch history
    let watch: Vec<serde_json::Value> = sqlx::query(
        "SELECT episode_id, episode_number, progress_seconds, duration, completed, last_watched FROM watch_history WHERE media_id = ?",
    )
    .bind(media_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?
    .iter()
    .map(|row| {
        serde_json::json!({
            "episode_id": row.get::<String, _>("episode_id"),
            "episode_number": row.get::<i32, _>("episode_number"),
            "progress_seconds": row.get::<f64, _>("progress_seconds"),
            "duration": row.get::<Option<f64>, _>("duration"),
            "completed": row.get::<bool, _>("completed"),
            "last_watched": row.get::<String, _>("last_watched"),
        })
    })
    .collect();

    // Collect reading history
    let reading: Vec<serde_json::Value> = sqlx::query(
        "SELECT chapter_id, chapter_number, current_page, total_pages, completed, last_read FROM reading_history WHERE media_id = ?",
    )
    .bind(media_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?
    .iter()
    .map(|row| {
        serde_json::json!({
            "chapter_id": row.get::<String, _>("chapter_id"),
            "chapter_number": row.get::<f64, _>("chapter_number"),
            "current_page": row.get::<i32, _>("current_page"),
            "total_pages": row.get::<Option<i32>, _>("total_pages"),
            "completed": row.get::<bool, _>("completed"),
            "last_read": row.get::<String, _>("last_read"),
        })
    })
    .collect();

    // Collect library entry
    let library: Option<serde_json::Value> = sqlx::query(
        "SELECT status, favorite, score, notes FROM library WHERE media_id = ?",
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?
    .map(|row| {
        serde_json::json!({
            "status": row.get::<String, _>("status"),
            "favorite": row.get::<bool, _>("favorite"),
            "score": row.get::<Option<f64>, _>("score"),
            "notes": row.get::<Option<String>, _>("notes"),
        })
    });

    let children = serde_json::json!({
        "watch_history": watch,
        "reading_history": reading,
        "library": library,
    });

    Ok(Some(children.to_string()))
}
