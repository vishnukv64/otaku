// Release Checker Module
//
// Background service that checks for new episodes/chapters for media
// in the user's library and emits notifications when new content is found.

use crate::commands::AppState;
use crate::extensions::{ExtensionRuntime, ExtensionType};
use crate::notifications::{emit_notification, NotificationPayload, NotificationType};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Global flag to control the background checker
static CHECKER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Global handle to stop the checker
static CHECKER_STOP_FLAG: AtomicBool = AtomicBool::new(false);

/// Delay between API calls to avoid rate limiting (in milliseconds)
const API_DELAY_MS: u64 = 2000;

/// Settings for release checking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseCheckSettings {
    pub enabled: bool,
    pub interval_hours: u32,
    pub last_full_check: Option<i64>, // Unix timestamp in ms
}

impl Default for ReleaseCheckSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_hours: 24,
            last_full_check: None,
        }
    }
}

/// Status of the release checker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseCheckStatus {
    pub is_running: bool,
    pub last_check: Option<i64>,
    pub next_check: Option<i64>,
    pub items_checked: u32,
    pub new_releases_found: u32,
}

/// Result from checking a single media item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseCheckResult {
    pub media_id: String,
    pub media_title: String,
    pub media_type: String, // "anime" or "manga"
    pub previous_count: i32,
    pub current_count: i32,
    pub new_releases: i32,
    pub extension_id: String,
}

/// Progress update during release checking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseCheckProgress {
    pub current_index: u32,
    pub total_count: u32,
    pub media_title: String,
    pub media_type: String, // "anime" or "manga"
    pub is_complete: bool,
    pub status: String, // "checking", "success", "failed", "complete"
    pub error_message: Option<String>,
}

/// Media item eligible for release checking
#[derive(Debug, Clone)]
struct EligibleMedia {
    media_id: String,
    extension_id: String,
    title: String,
    media_type: String,
    last_known_count: i32,
}

// ==================== Settings Management ====================

/// Get release check settings from database
pub async fn get_release_settings(pool: &SqlitePool) -> Result<ReleaseCheckSettings> {
    let enabled: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'release_check_enabled'"
    )
    .fetch_optional(pool)
    .await?;

    let interval: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'release_check_interval_hours'"
    )
    .fetch_optional(pool)
    .await?;

    let last_check: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'release_last_full_check'"
    )
    .fetch_optional(pool)
    .await?;

    Ok(ReleaseCheckSettings {
        enabled: enabled.map(|v| v == "1").unwrap_or(true),
        interval_hours: interval.and_then(|v| v.parse().ok()).unwrap_or(24),
        last_full_check: last_check.and_then(|v| v.parse().ok()),
    })
}

/// Update release check settings in database
pub async fn update_release_settings(
    pool: &SqlitePool,
    settings: &ReleaseCheckSettings,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    // Update enabled setting
    sqlx::query(
        r#"
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('release_check_enabled', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        "#
    )
    .bind(if settings.enabled { "1" } else { "0" })
    .bind(now)
    .execute(pool)
    .await?;

    // Update interval setting
    sqlx::query(
        r#"
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('release_check_interval_hours', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        "#
    )
    .bind(settings.interval_hours.to_string())
    .bind(now)
    .execute(pool)
    .await?;

    // Update last check timestamp if provided
    if let Some(last_check) = settings.last_full_check {
        sqlx::query(
            r#"
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ('release_last_full_check', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            "#
        )
        .bind(last_check.to_string())
        .bind(now)
        .execute(pool)
        .await?;
    }

    Ok(())
}

// ==================== Tracking Management ====================

/// Initialize tracking for a media item (called when adding to library)
pub async fn initialize_tracking(
    pool: &SqlitePool,
    media_id: &str,
    extension_id: &str,
    media_type: &str,
    current_count: i32,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO release_tracking (media_id, extension_id, media_type, last_known_count, last_checked_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(media_id) DO UPDATE SET
            extension_id = excluded.extension_id,
            last_known_count = excluded.last_known_count,
            last_checked_at = excluded.last_checked_at,
            updated_at = CURRENT_TIMESTAMP
        "#
    )
    .bind(media_id)
    .bind(extension_id)
    .bind(media_type)
    .bind(current_count)
    .bind(now)
    .execute(pool)
    .await?;

    log::debug!(
        "Initialized release tracking for {} with count {}",
        media_id,
        current_count
    );

    Ok(())
}

/// Update tracking after checking (uses upsert to handle items without tracking records)
async fn update_tracking(
    pool: &SqlitePool,
    media_id: &str,
    extension_id: &str,
    media_type: &str,
    current_count: i32,
    notified: bool,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    if notified {
        sqlx::query(
            r#"
            INSERT INTO release_tracking (media_id, extension_id, media_type, last_known_count, last_checked_at, last_notified_count)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(media_id) DO UPDATE SET
                last_known_count = excluded.last_known_count,
                last_checked_at = excluded.last_checked_at,
                last_notified_count = excluded.last_notified_count,
                updated_at = CURRENT_TIMESTAMP
            "#
        )
        .bind(media_id)
        .bind(extension_id)
        .bind(media_type)
        .bind(current_count)
        .bind(now)
        .bind(current_count)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            r#"
            INSERT INTO release_tracking (media_id, extension_id, media_type, last_known_count, last_checked_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(media_id) DO UPDATE SET
                last_known_count = excluded.last_known_count,
                last_checked_at = excluded.last_checked_at,
                updated_at = CURRENT_TIMESTAMP
            "#
        )
        .bind(media_id)
        .bind(extension_id)
        .bind(media_type)
        .bind(current_count)
        .bind(now)
        .execute(pool)
        .await?;
    }

    Ok(())
}

/// Get media items eligible for release checking
async fn get_eligible_media(pool: &SqlitePool) -> Result<Vec<EligibleMedia>> {
    // Query media that:
    // 1. Has status 'Ongoing' (skip completed series)
    // 2. Is in library with watching/reading/plan_to status OR is favorited
    // 3. Has release tracking initialized
    let rows = sqlx::query(
        r#"
        SELECT
            m.id as media_id,
            m.extension_id,
            m.title,
            m.media_type,
            COALESCE(rt.last_known_count, 0) as last_known_count
        FROM media m
        INNER JOIN library l ON m.id = l.media_id
        LEFT JOIN release_tracking rt ON m.id = rt.media_id
        WHERE m.status IN ('Ongoing', 'Releasing')
            AND (
                l.status IN ('watching', 'reading', 'plan_to_watch', 'plan_to_read')
                OR l.favorite = 1
            )
        ORDER BY rt.last_checked_at ASC NULLS FIRST
        "#
    )
    .fetch_all(pool)
    .await?;

    let mut eligible = Vec::new();
    for row in rows {
        eligible.push(EligibleMedia {
            media_id: row.try_get("media_id")?,
            extension_id: row.try_get("extension_id")?,
            title: row.try_get("title")?,
            media_type: row.try_get("media_type")?,
            last_known_count: row.try_get("last_known_count")?,
        });
    }

    Ok(eligible)
}

// ==================== Release Checking Logic ====================

/// Check a single media item for new releases
async fn check_single_media(
    app_state: &AppState,
    media: &EligibleMedia,
) -> Result<Option<ReleaseCheckResult>> {
    // Get the extension
    let extensions = app_state.extensions.lock()
        .map_err(|e| anyhow::anyhow!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == media.extension_id)
        .cloned();

    drop(extensions);

    let extension = match extension {
        Some(ext) => ext,
        None => {
            log::warn!(
                "Extension {} not loaded, skipping release check for {}",
                media.extension_id,
                media.media_id
            );
            return Ok(None);
        }
    };

    // Create runtime and get current count
    let runtime = ExtensionRuntime::new(extension.clone())
        .context("Failed to create extension runtime")?;

    let current_count = match extension.metadata.extension_type {
        ExtensionType::Anime => {
            let details = runtime.get_details(&media.media_id)
                .context("Failed to get anime details")?;
            details.episodes.len() as i32
        }
        ExtensionType::Manga => {
            let details = runtime.get_manga_details(&media.media_id)
                .context("Failed to get manga details")?;
            details.chapters.len() as i32
        }
    };

    // Compare counts
    if current_count > media.last_known_count {
        // If this is the first time tracking (last_known_count = 0), 
        // silently initialize without creating a notification
        if media.last_known_count == 0 {
            log::info!(
                "Initializing tracking for {} with {} episodes/chapters (no notification)",
                media.media_id,
                current_count
            );
            return Ok(None);
        }
        
        let new_releases = current_count - media.last_known_count;
        Ok(Some(ReleaseCheckResult {
            media_id: media.media_id.clone(),
            media_title: media.title.clone(),
            media_type: media.media_type.clone(),
            previous_count: media.last_known_count,
            current_count,
            new_releases,
            extension_id: media.extension_id.clone(),
        }))
    } else if current_count < media.last_known_count {
        // Count decreased - log warning but don't update (API inconsistency)
        log::warn!(
            "Episode/chapter count decreased for {}: {} -> {} (API inconsistency)",
            media.media_id,
            media.last_known_count,
            current_count
        );
        Ok(None)
    } else {
        Ok(None)
    }
}

/// Run a full release check on all eligible media
pub async fn run_full_release_check(
    app_handle: &AppHandle,
) -> Result<Vec<ReleaseCheckResult>> {
    let app_state: tauri::State<'_, AppState> = app_handle.state();
    let pool = app_state.database.pool();

    // Get eligible media
    let eligible = get_eligible_media(pool).await?;
    let total_count = eligible.len() as u32;
    log::info!("Checking {} media items for new releases", total_count);

    let mut results = Vec::new();

    for (index, media) in eligible.iter().enumerate() {
        // Check if we should stop
        if CHECKER_STOP_FLAG.load(Ordering::SeqCst) {
            log::info!("Release check stopped by user");
            // Emit completion on stop
            let _ = app_handle.emit("release_check_progress", ReleaseCheckProgress {
                current_index: index as u32 + 1,
                total_count,
                media_title: String::new(),
                media_type: String::new(),
                is_complete: true,
                status: "complete".to_string(),
                error_message: None,
            });
            break;
        }

        // Emit progress before checking each item
        let _ = app_handle.emit("release_check_progress", ReleaseCheckProgress {
            current_index: index as u32 + 1,
            total_count,
            media_title: media.title.clone(),
            media_type: media.media_type.clone(),
            is_complete: false,
            status: "checking".to_string(),
            error_message: None,
        });

        match check_single_media(&app_state, media).await {
            Ok(Some(result)) => {
                log::info!(
                    "New {} found: {} ({} new)",
                    if result.media_type == "anime" { "episodes" } else { "chapters" },
                    result.media_title,
                    result.new_releases
                );

                // Emit success status
                let _ = app_handle.emit("release_check_progress", ReleaseCheckProgress {
                    current_index: index as u32 + 1,
                    total_count,
                    media_title: media.title.clone(),
                    media_type: media.media_type.clone(),
                    is_complete: false,
                    status: "success".to_string(),
                    error_message: None,
                });

                // Update tracking
                if let Err(e) = update_tracking(pool, &result.media_id, &result.extension_id, &result.media_type, result.current_count, true).await {
                    log::error!("Failed to update tracking for {}: {}", result.media_id, e);
                }

                // Emit notification
                if let Err(e) = emit_release_notification(app_handle, pool, &result).await {
                    log::error!("Failed to emit notification for {}: {}", result.media_id, e);
                }

                results.push(result);
            }
            Ok(None) => {
                // No new releases, update last checked time
                if let Err(e) = update_tracking(pool, &media.media_id, &media.extension_id, &media.media_type, media.last_known_count, false).await {
                    log::error!("Failed to update tracking for {}: {}", media.media_id, e);
                }
            }
            Err(e) => {
                log::error!("Failed to check {}: {}", media.media_id, e);
                // Emit failure status
                let _ = app_handle.emit("release_check_progress", ReleaseCheckProgress {
                    current_index: index as u32 + 1,
                    total_count,
                    media_title: media.title.clone(),
                    media_type: media.media_type.clone(),
                    is_complete: false,
                    status: "failed".to_string(),
                    error_message: Some(e.to_string()),
                });
            }
        }

        // Rate limiting delay
        tokio::time::sleep(Duration::from_millis(API_DELAY_MS)).await;
    }

    // Emit completion progress
    let _ = app_handle.emit("release_check_progress", ReleaseCheckProgress {
        current_index: total_count,
        total_count,
        media_title: String::new(),
        media_type: String::new(),
        is_complete: true,
        status: "complete".to_string(),
        error_message: None,
    });

    // Update last full check timestamp
    let mut settings = get_release_settings(pool).await?;
    settings.last_full_check = Some(chrono::Utc::now().timestamp_millis());
    update_release_settings(pool, &settings).await?;

    // Emit summary notification if many releases found
    if results.len() > 3 {
        emit_summary_notification(app_handle, pool, &results).await?;
    }

    Ok(results)
}

// ==================== Notification Emission ====================

/// Emit a notification for a new release
async fn emit_release_notification(
    app_handle: &AppHandle,
    pool: &SqlitePool,
    result: &ReleaseCheckResult,
) -> Result<()> {
    let (title, message) = if result.media_type == "anime" {
        (
            "New Episode Available",
            if result.new_releases == 1 {
                format!(
                    "{} - Episode {} is now available!",
                    result.media_title, result.current_count
                )
            } else {
                format!(
                    "{} - {} new episodes available! (up to Episode {})",
                    result.media_title, result.new_releases, result.current_count
                )
            },
        )
    } else {
        (
            "New Chapter Available",
            if result.new_releases == 1 {
                format!(
                    "{} - Chapter {} is now available!",
                    result.media_title, result.current_count
                )
            } else {
                format!(
                    "{} - {} new chapters available! (up to Chapter {})",
                    result.media_title, result.new_releases, result.current_count
                )
            },
        )
    };

    // Build action route - navigate to the watch/read page without a specific episode/chapter
    // The page will automatically find the next unwatched or resume from progress
    let action_route = if result.media_type == "anime" {
        format!(
            "/watch?extensionId={}&animeId={}",
            result.extension_id, result.media_id
        )
    } else {
        format!(
            "/read?extensionId={}&mangaId={}",
            result.extension_id, result.media_id
        )
    };

    let notification = NotificationPayload::new(NotificationType::Info, title, message)
        .with_source("release")
        .with_action(
            if result.media_type == "anime" { "Watch Now" } else { "Read Now" },
            Some(action_route),
            None,
        )
        .with_metadata(serde_json::json!({
            "media_id": result.media_id,
            "media_title": result.media_title,
            "media_type": result.media_type,
            "new_releases": result.new_releases,
            "current_count": result.current_count,
            "extension_id": result.extension_id,
        }));

    emit_notification(app_handle, Some(pool), notification).await?;

    Ok(())
}

/// Emit a summary notification when many releases are found
async fn emit_summary_notification(
    app_handle: &AppHandle,
    pool: &SqlitePool,
    results: &[ReleaseCheckResult],
) -> Result<()> {
    let total_releases: i32 = results.iter().map(|r| r.new_releases).sum();
    let unique_titles = results.len();

    let message = format!(
        "{} new episodes/chapters found across {} titles",
        total_releases, unique_titles
    );

    let notification = NotificationPayload::new(
        NotificationType::Info,
        "New Releases Available",
        message,
    )
    .with_source("release")
    .with_action("View Library", Some("/library".to_string()), None)
    .with_metadata(serde_json::json!({
        "total_releases": total_releases,
        "unique_titles": unique_titles,
        "is_summary": true,
    }));

    emit_notification(app_handle, Some(pool), notification).await?;

    Ok(())
}

// ==================== Background Checker ====================

/// Start the background release checker
pub async fn start_release_checker(app_handle: AppHandle) {
    // Check if already running
    if CHECKER_RUNNING.swap(true, Ordering::SeqCst) {
        log::warn!("Release checker is already running");
        return;
    }

    CHECKER_STOP_FLAG.store(false, Ordering::SeqCst);

    log::info!("Starting background release checker");

    tokio::spawn(async move {
        loop {
            // Check stop flag
            if CHECKER_STOP_FLAG.load(Ordering::SeqCst) {
                log::info!("Release checker stopping");
                break;
            }

            // Get settings
            let app_state: tauri::State<'_, AppState> = app_handle.state();
            let settings = match get_release_settings(app_state.database.pool()).await {
                Ok(s) => s,
                Err(e) => {
                    log::error!("Failed to get release settings: {}", e);
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    continue;
                }
            };

            // Check if enabled
            if !settings.enabled {
                log::debug!("Release check is disabled, sleeping");
                tokio::time::sleep(Duration::from_secs(60)).await;
                continue;
            }

            // Check if it's time for a check
            let now = chrono::Utc::now().timestamp_millis();
            let interval_ms = (settings.interval_hours as i64) * 60 * 60 * 1000;
            let should_check = match settings.last_full_check {
                Some(last) => (now - last) >= interval_ms,
                None => true, // Never checked before
            };

            if should_check {
                log::info!("Running scheduled release check");
                match run_full_release_check(&app_handle).await {
                    Ok(results) => {
                        log::info!("Release check complete: {} new releases found", results.len());
                    }
                    Err(e) => {
                        log::error!("Release check failed: {}", e);
                    }
                }
            }

            // Sleep for 5 minutes before checking again
            tokio::time::sleep(Duration::from_secs(5 * 60)).await;
        }

        CHECKER_RUNNING.store(false, Ordering::SeqCst);
        log::info!("Release checker stopped");
    });
}

/// Stop the background release checker
pub fn stop_release_checker() {
    log::info!("Stopping release checker");
    CHECKER_STOP_FLAG.store(true, Ordering::SeqCst);
}

/// Check if the release checker is currently running
pub fn is_checker_running() -> bool {
    CHECKER_RUNNING.load(Ordering::SeqCst)
}

/// Get current release check status
pub async fn get_release_check_status(pool: &SqlitePool) -> Result<ReleaseCheckStatus> {
    let settings = get_release_settings(pool).await?;

    let next_check = settings.last_full_check.map(|last| {
        last + (settings.interval_hours as i64) * 60 * 60 * 1000
    });

    // Count items that would be checked
    let items_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM media m
        INNER JOIN library l ON m.id = l.media_id
        WHERE m.status IN ('Ongoing', 'Releasing')
            AND (
                l.status IN ('watching', 'reading', 'plan_to_watch', 'plan_to_read')
                OR l.favorite = 1
            )
        "#
    )
    .fetch_one(pool)
    .await?;

    Ok(ReleaseCheckStatus {
        is_running: is_checker_running(),
        last_check: settings.last_full_check,
        next_check,
        items_checked: items_count as u32,
        new_releases_found: 0, // This is per-session, not persisted
    })
}
