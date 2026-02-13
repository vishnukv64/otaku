// Release Checker Module V2
//
// Background service that checks for new episodes/chapters for media
// in the user's library using multi-signal detection for reliable notifications.
//
// Key improvements over V1:
// - Multi-signal detection (number, id, count) for reliable new release detection
// - Status normalization to handle API variations
// - Smart scheduling based on media status and activity
// - Retry mechanism with exponential backoff
// - Detailed logging for debugging

use crate::commands::AppState;
use crate::extensions::{ExtensionRuntime, ExtensionType};
use crate::notifications::{emit_notification, NotificationPayload, NotificationType};
use crate::status_normalizer::{normalize_status, NormalizedStatus};
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

/// Maximum retries for failed API calls
#[allow(dead_code)]
const MAX_RETRIES: u32 = 3;

/// Base delay for exponential backoff (in seconds)
const RETRY_BASE_DELAY_SECS: u64 = 5;

// ==================== Data Types ====================

/// Settings for release checking (V2 with more granular intervals)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseCheckSettings {
    pub enabled: bool,
    pub interval_minutes: u32,           // Default check interval (120 = 2 hours)
    pub fast_interval_minutes: u32,      // For recently active media (30 min)
    pub retry_delay_minutes: u32,        // Delay after failure (5 min)
    pub max_retries: u32,                // Max retry attempts
    pub last_full_check: Option<i64>,    // Unix timestamp in ms
    // Legacy field for backwards compatibility
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_hours: Option<u32>,
}

impl Default for ReleaseCheckSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_minutes: 120,        // 2 hours default
            fast_interval_minutes: 30,    // 30 minutes for active media
            retry_delay_minutes: 5,
            max_retries: 3,
            last_full_check: None,
            interval_hours: None,
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
    pub media_type: String,
    pub previous_count: i32,
    pub current_count: i32,
    pub previous_number: Option<f32>,
    pub current_number: Option<f32>,
    pub new_releases: i32,
    pub extension_id: String,
    pub detection_signal: String,  // "number", "id", "count"
}

/// Progress update during release checking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseCheckProgress {
    pub current_index: u32,
    pub total_count: u32,
    pub media_title: String,
    pub media_type: String,
    pub is_complete: bool,
    pub status: String,
    pub error_message: Option<String>,
}

/// Media release state for frontend (NEW badge, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaReleaseState {
    pub media_id: String,
    pub has_new_release: bool,
    pub latest_number: Option<f32>,
    pub notified_up_to: Option<f32>,
    pub last_checked: Option<i64>,
    pub normalized_status: String,
}

/// Check log entry for debugging
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckLogEntry {
    pub id: i64,
    pub media_id: String,
    pub check_timestamp: i64,
    pub result_type: String,
    pub previous_count: Option<i32>,
    pub new_count: Option<i32>,
    pub previous_latest_number: Option<f32>,
    pub new_latest_number: Option<f32>,
    pub detection_signal: Option<String>,
    pub error_message: Option<String>,
    pub notification_sent: bool,
}

/// Debug info for tracking status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackingDebugInfo {
    pub media_id: String,
    pub extension_id: String,
    pub media_type: String,
    pub last_known_count: Option<i32>,
    pub last_known_latest_number: Option<f32>,
    pub last_known_latest_id: Option<String>,
    pub raw_status: Option<String>,
    pub normalized_status: String,
    pub user_notified_up_to: Option<f32>,
    pub notification_enabled: bool,
    pub last_checked_at: Option<i64>,
    pub next_scheduled_check: Option<i64>,
    pub consecutive_failures: i32,
    pub last_error: Option<String>,
    pub recent_logs: Vec<CheckLogEntry>,
}

/// Media item eligible for release checking
#[derive(Debug, Clone)]
struct EligibleMedia {
    media_id: String,
    extension_id: String,
    title: String,
    media_type: String,
    last_known_count: i32,
    last_known_latest_number: Option<f32>,
    last_known_latest_id: Option<String>,
    #[allow(dead_code)]
    normalized_status: NormalizedStatus,
    #[allow(dead_code)]
    consecutive_failures: i32,
    user_notified_up_to: Option<f32>,
}

/// Extracted episode info for comparison
#[derive(Debug, Clone)]
struct EpisodeInfo {
    count: i32,
    latest_number: Option<f32>,
    latest_id: Option<String>,
    raw_status: Option<String>,
}

// ==================== Settings Management ====================

/// Get release check settings from database
pub async fn get_release_settings(pool: &SqlitePool) -> Result<ReleaseCheckSettings> {
    let enabled: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'release_check_enabled'"
    )
    .fetch_optional(pool)
    .await?;

    let interval_minutes: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'release_check_interval_minutes'"
    )
    .fetch_optional(pool)
    .await?;

    let fast_interval: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'release_check_fast_interval_minutes'"
    )
    .fetch_optional(pool)
    .await?;

    let retry_delay: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'release_check_retry_delay_minutes'"
    )
    .fetch_optional(pool)
    .await?;

    let max_retries: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'release_check_max_retries'"
    )
    .fetch_optional(pool)
    .await?;

    let last_check: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'release_last_full_check'"
    )
    .fetch_optional(pool)
    .await?;

    // Also check legacy interval_hours setting and convert
    let legacy_hours: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'release_check_interval_hours'"
    )
    .fetch_optional(pool)
    .await?;

    let interval = interval_minutes
        .and_then(|v| v.parse().ok())
        .or_else(|| legacy_hours.and_then(|h| h.parse::<u32>().ok()).map(|h| h * 60))
        .unwrap_or(120);

    Ok(ReleaseCheckSettings {
        enabled: enabled.map(|v| v == "1").unwrap_or(true),
        interval_minutes: interval,
        fast_interval_minutes: fast_interval.and_then(|v| v.parse().ok()).unwrap_or(30),
        retry_delay_minutes: retry_delay.and_then(|v| v.parse().ok()).unwrap_or(5),
        max_retries: max_retries.and_then(|v| v.parse().ok()).unwrap_or(3),
        last_full_check: last_check.and_then(|v| v.parse().ok()),
        interval_hours: None,
    })
}

/// Update release check settings in database
pub async fn update_release_settings(
    pool: &SqlitePool,
    settings: &ReleaseCheckSettings,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    // Helper to upsert a setting
    async fn upsert_setting(pool: &SqlitePool, key: &str, value: &str, now: i64) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            "#
        )
        .bind(key)
        .bind(value)
        .bind(now)
        .execute(pool)
        .await?;
        Ok(())
    }

    upsert_setting(pool, "release_check_enabled", if settings.enabled { "1" } else { "0" }, now).await?;
    upsert_setting(pool, "release_check_interval_minutes", &settings.interval_minutes.to_string(), now).await?;
    upsert_setting(pool, "release_check_fast_interval_minutes", &settings.fast_interval_minutes.to_string(), now).await?;
    upsert_setting(pool, "release_check_retry_delay_minutes", &settings.retry_delay_minutes.to_string(), now).await?;
    upsert_setting(pool, "release_check_max_retries", &settings.max_retries.to_string(), now).await?;

    if let Some(last_check) = settings.last_full_check {
        upsert_setting(pool, "release_last_full_check", &last_check.to_string(), now).await?;
    }

    Ok(())
}

// ==================== Tracking Management (V2) ====================

/// Initialize tracking for a media item (called when adding to library)
pub async fn initialize_tracking(
    pool: &SqlitePool,
    media_id: &str,
    extension_id: &str,
    media_type: &str,
    current_count: i32,
) -> Result<()> {
    initialize_tracking_v2(pool, media_id, extension_id, media_type, current_count, None, None, None).await
}

/// Initialize tracking with full episode info (V2)
pub async fn initialize_tracking_v2(
    pool: &SqlitePool,
    media_id: &str,
    extension_id: &str,
    media_type: &str,
    current_count: i32,
    latest_number: Option<f32>,
    latest_id: Option<&str>,
    raw_status: Option<&str>,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let normalized = raw_status.map(normalize_status).unwrap_or(NormalizedStatus::Unknown);
    let next_check = now + (normalized.recommended_interval_minutes() as i64 * 60 * 1000);

    sqlx::query(
        r#"
        INSERT INTO release_tracking_v2 (
            media_id, extension_id, media_type,
            last_known_count, last_known_latest_number, last_known_latest_id,
            raw_status, normalized_status,
            user_notified_up_to,
            last_checked_at, next_scheduled_check
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(media_id) DO UPDATE SET
            extension_id = excluded.extension_id,
            last_known_count = excluded.last_known_count,
            last_known_latest_number = excluded.last_known_latest_number,
            last_known_latest_id = excluded.last_known_latest_id,
            raw_status = excluded.raw_status,
            normalized_status = excluded.normalized_status,
            last_checked_at = excluded.last_checked_at,
            next_scheduled_check = excluded.next_scheduled_check,
            consecutive_failures = 0,
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        "#
    )
    .bind(media_id)
    .bind(extension_id)
    .bind(media_type)
    .bind(current_count)
    .bind(latest_number)
    .bind(latest_id)
    .bind(raw_status)
    .bind(normalized.as_str())
    .bind(None::<f32>) // user_notified_up_to = NULL, let release checker set this when notifying
    .bind(now)
    .bind(next_check)
    .execute(pool)
    .await?;

    log::debug!(
        "Initialized V2 tracking for {} with count={}, number={:?}, status={:?}",
        media_id, current_count, latest_number, normalized
    );

    // Also update legacy table for backwards compatibility
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

    Ok(())
}

/// Update tracking after checking
async fn update_tracking_v2(
    pool: &SqlitePool,
    media_id: &str,
    info: &EpisodeInfo,
    notified_number: Option<f32>,
    error: Option<&str>,
    settings: &ReleaseCheckSettings,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let normalized = info.raw_status.as_deref().map(normalize_status).unwrap_or(NormalizedStatus::Unknown);

    // Calculate next check time based on status
    let interval_minutes = if normalized == NormalizedStatus::Ongoing {
        settings.interval_minutes
    } else {
        normalized.recommended_interval_minutes()
    };
    let next_check = now + (interval_minutes as i64 * 60 * 1000);

    if let Some(err) = error {
        // Update with error, increment failure counter
        sqlx::query(
            r#"
            UPDATE release_tracking_v2 SET
                last_checked_at = ?,
                consecutive_failures = consecutive_failures + 1,
                last_error = ?,
                next_scheduled_check = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE media_id = ?
            "#
        )
        .bind(now)
        .bind(err)
        .bind(now + (settings.retry_delay_minutes as i64 * 60 * 1000))
        .bind(media_id)
        .execute(pool)
        .await?;
    } else {
        // Successful update
        if let Some(notified_num) = notified_number {
            sqlx::query(
                r#"
                UPDATE release_tracking_v2 SET
                    last_known_count = ?,
                    last_known_latest_number = ?,
                    last_known_latest_id = ?,
                    raw_status = ?,
                    normalized_status = ?,
                    user_notified_up_to = ?,
                    user_acknowledged_at = NULL,
                    last_checked_at = ?,
                    next_scheduled_check = ?,
                    consecutive_failures = 0,
                    last_error = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE media_id = ?
                "#
            )
            .bind(info.count)
            .bind(info.latest_number)
            .bind(&info.latest_id)
            .bind(&info.raw_status)
            .bind(normalized.as_str())
            .bind(notified_num)
            .bind(now)
            .bind(next_check)
            .bind(media_id)
            .execute(pool)
            .await?;
        } else {
            // No notification, just update check time
            sqlx::query(
                r#"
                UPDATE release_tracking_v2 SET
                    last_known_count = ?,
                    last_known_latest_number = ?,
                    last_known_latest_id = ?,
                    raw_status = ?,
                    normalized_status = ?,
                    last_checked_at = ?,
                    next_scheduled_check = ?,
                    consecutive_failures = 0,
                    last_error = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE media_id = ?
                "#
            )
            .bind(info.count)
            .bind(info.latest_number)
            .bind(&info.latest_id)
            .bind(&info.raw_status)
            .bind(normalized.as_str())
            .bind(now)
            .bind(next_check)
            .bind(media_id)
            .execute(pool)
            .await?;
        }

        // Also update legacy table
        sqlx::query(
            r#"
            INSERT INTO release_tracking (media_id, extension_id, media_type, last_known_count, last_checked_at, last_notified_count)
            VALUES (?, (SELECT extension_id FROM release_tracking_v2 WHERE media_id = ?),
                    (SELECT media_type FROM release_tracking_v2 WHERE media_id = ?), ?, ?, ?)
            ON CONFLICT(media_id) DO UPDATE SET
                last_known_count = excluded.last_known_count,
                last_checked_at = excluded.last_checked_at,
                last_notified_count = COALESCE(excluded.last_notified_count, release_tracking.last_notified_count),
                updated_at = CURRENT_TIMESTAMP
            "#
        )
        .bind(media_id)
        .bind(media_id)
        .bind(media_id)
        .bind(info.count)
        .bind(now)
        .bind(notified_number.map(|n| n as i32))
        .execute(pool)
        .await?;
    }

    Ok(())
}

/// Log a check result for debugging
async fn log_check_result(
    pool: &SqlitePool,
    media_id: &str,
    result_type: &str,
    prev_count: Option<i32>,
    new_count: Option<i32>,
    prev_number: Option<f32>,
    new_number: Option<f32>,
    detection_signal: Option<&str>,
    new_releases: Option<i32>,
    error: Option<&str>,
    notification_sent: bool,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO release_check_log (
            media_id, check_timestamp, result_type,
            previous_count, new_count,
            previous_latest_number, new_latest_number,
            detection_signal, new_releases_count,
            error_message, notification_sent
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#
    )
    .bind(media_id)
    .bind(now)
    .bind(result_type)
    .bind(prev_count)
    .bind(new_count)
    .bind(prev_number)
    .bind(new_number)
    .bind(detection_signal)
    .bind(new_releases)
    .bind(error)
    .bind(notification_sent as i32)
    .execute(pool)
    .await?;

    Ok(())
}

/// Get media items eligible for release checking (V2)
async fn get_eligible_media(pool: &SqlitePool) -> Result<Vec<EligibleMedia>> {
    let now = chrono::Utc::now().timestamp_millis();

    // Query media that:
    // 1. Has normalized_status in ('ongoing', 'unknown') - status normalization!
    // 2. Is in library with watching/reading/plan_to status OR is favorited
    // 3. Has notification_enabled = 1
    // 4. Is due for a check (next_scheduled_check <= now OR NULL)
    let rows = sqlx::query(
        r#"
        SELECT
            m.id as media_id,
            COALESCE(rt.extension_id, m.extension_id) as extension_id,
            m.title,
            m.media_type,
            COALESCE(rt.last_known_count, 0) as last_known_count,
            rt.last_known_latest_number,
            rt.last_known_latest_id,
            COALESCE(rt.normalized_status, 'unknown') as normalized_status,
            COALESCE(rt.consecutive_failures, 0) as consecutive_failures,
            rt.user_notified_up_to
        FROM media m
        INNER JOIN library l ON m.id = l.media_id
        LEFT JOIN release_tracking_v2 rt ON m.id = rt.media_id
        WHERE (
                COALESCE(rt.normalized_status, 'unknown') IN ('ongoing', 'unknown')
                OR rt.normalized_status IS NULL
            )
            AND (
                l.status IN ('watching', 'reading', 'plan_to_watch', 'plan_to_read')
                OR l.favorite = 1
            )
            AND COALESCE(rt.notification_enabled, 1) = 1
            AND (rt.next_scheduled_check IS NULL OR rt.next_scheduled_check <= ?)
        ORDER BY
            CASE WHEN m.media_type = 'anime' THEN 0 ELSE 1 END,
            rt.last_checked_at ASC NULLS FIRST
        "#
    )
    .bind(now)
    .fetch_all(pool)
    .await?;

    let mut eligible = Vec::new();
    for row in rows {
        let status_str: String = row.try_get("normalized_status")?;
        eligible.push(EligibleMedia {
            media_id: row.try_get("media_id")?,
            extension_id: row.try_get("extension_id")?,
            title: row.try_get("title")?,
            media_type: row.try_get("media_type")?,
            last_known_count: row.try_get("last_known_count")?,
            last_known_latest_number: row.try_get("last_known_latest_number")?,
            last_known_latest_id: row.try_get("last_known_latest_id")?,
            normalized_status: NormalizedStatus::from_str(&status_str),
            consecutive_failures: row.try_get("consecutive_failures")?,
            user_notified_up_to: row.try_get("user_notified_up_to")?,
        });
    }

    Ok(eligible)
}

// ==================== Multi-Signal Detection ====================

/// Detect if there's a new release using multiple signals
fn detect_new_release(
    media: &EligibleMedia,
    current: &EpisodeInfo,
) -> Option<(String, i32)> {
    // Signal priority: number > id > count

    // 1. Check latest_number (primary signal)
    if let (Some(prev_num), Some(curr_num)) = (media.last_known_latest_number, current.latest_number) {
        if curr_num > prev_num {
            let new_count = ((curr_num - prev_num).ceil()) as i32;
            log::debug!(
                "New release detected via NUMBER for {}: {:.1} -> {:.1} ({} new)",
                media.media_id, prev_num, curr_num, new_count
            );
            return Some(("number".to_string(), new_count.max(1)));
        }
    }

    // 2. Check latest_id (strongest signal when number also changed)
    if let (Some(ref prev_id), Some(ref curr_id)) = (&media.last_known_latest_id, &current.latest_id) {
        if prev_id != curr_id {
            // ID changed, check if number also increased
            if let (Some(prev_num), Some(curr_num)) = (media.last_known_latest_number, current.latest_number) {
                if curr_num > prev_num {
                    let new_count = ((curr_num - prev_num).ceil()) as i32;
                    log::debug!(
                        "New release detected via ID for {}: {} -> {} (number {:.1} -> {:.1})",
                        media.media_id, prev_id, curr_id, prev_num, curr_num
                    );
                    return Some(("id".to_string(), new_count.max(1)));
                }
            }
            // ID changed but number didn't increase - might be a re-upload, skip
        }
    }

    // 3. Fallback: check count (least reliable)
    if current.count > media.last_known_count && media.last_known_count > 0 {
        let new_count = current.count - media.last_known_count;
        log::debug!(
            "New release detected via COUNT for {}: {} -> {} ({} new)",
            media.media_id, media.last_known_count, current.count, new_count
        );
        return Some(("count".to_string(), new_count));
    }

    None
}

/// Check if we should notify (haven't already notified for this episode)
fn should_notify(media: &EligibleMedia, current_number: Option<f32>) -> bool {
    match (media.user_notified_up_to, current_number) {
        (Some(notified), Some(current)) => current > notified,
        (None, Some(_)) => true,  // Never notified, should notify
        _ => false,  // No current number to notify about
    }
}

// ==================== Release Checking Logic ====================

/// Fetch episode info with retry
async fn fetch_episode_info_with_retry(
    app_state: &AppState,
    pool: &SqlitePool,
    media: &EligibleMedia,
    max_retries: u32,
) -> Result<EpisodeInfo> {
    let mut last_error = None;

    for attempt in 0..=max_retries {
        if attempt > 0 {
            let delay = Duration::from_secs(RETRY_BASE_DELAY_SECS * (1 << (attempt - 1)));
            log::debug!("Retry attempt {} for {} after {:?}", attempt, media.media_id, delay);
            tokio::time::sleep(delay).await;
        }

        match fetch_episode_info(app_state, pool, media).await {
            Ok(info) => return Ok(info),
            Err(e) => {
                log::warn!(
                    "Attempt {} failed for {}: {}",
                    attempt + 1, media.media_id, e
                );
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Unknown error")))
}

/// Get the NSFW filter setting from database
/// Returns true if NSFW filter is enabled (hide adult content), false otherwise
async fn get_nsfw_filter_setting(pool: &SqlitePool) -> bool {
    let result: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'nsfw_filter'"
    )
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    // Default to false (allow adult content) if not set
    // Frontend uses nsfwFilter=true to hide adult, so "1" means hide adult
    result.map(|v| v == "1").unwrap_or(false)
}

/// Fetch current episode info from extension
async fn fetch_episode_info(
    app_state: &AppState,
    pool: &SqlitePool,
    media: &EligibleMedia,
) -> Result<EpisodeInfo> {
    // Get NSFW filter setting BEFORE acquiring lock to avoid holding lock across await
    // nsfwFilter=true means "hide adult content", so allow_adult should be !nsfwFilter
    let nsfw_filter = get_nsfw_filter_setting(pool).await;
    let allow_adult = !nsfw_filter;

    log::debug!("Creating extension runtime with allow_adult={} (nsfw_filter={})", allow_adult, nsfw_filter);

    let extension = {
        let extensions = app_state.extensions.read()
            .map_err(|e| anyhow::anyhow!("Failed to lock extensions: {}", e))?;

        extensions.iter()
            .find(|ext| ext.metadata.id == media.extension_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Extension {} not found", media.extension_id))?
    }; // MutexGuard dropped here

    let runtime = ExtensionRuntime::with_options(extension.clone(), allow_adult)
        .context("Failed to create extension runtime")?;

    match extension.metadata.extension_type {
        ExtensionType::Anime => {
            let details = runtime.get_details(&media.media_id)
                .context("Failed to get anime details")?;

            let latest_ep = details.episodes.iter()
                .max_by(|a, b| a.number.partial_cmp(&b.number).unwrap_or(std::cmp::Ordering::Equal));

            Ok(EpisodeInfo {
                count: details.episodes.len() as i32,
                latest_number: latest_ep.map(|e| e.number),
                latest_id: latest_ep.map(|e| e.id.clone()),
                raw_status: details.status,
            })
        }
        ExtensionType::Manga => {
            let details = runtime.get_manga_details(&media.media_id)
                .context("Failed to get manga details")?;

            let latest_ch = details.chapters.iter()
                .max_by(|a, b| a.number.partial_cmp(&b.number).unwrap_or(std::cmp::Ordering::Equal));

            Ok(EpisodeInfo {
                count: details.chapters.len() as i32,
                latest_number: latest_ch.map(|c| c.number),
                latest_id: latest_ch.map(|c| c.id.clone()),
                raw_status: details.status,
            })
        }
    }
}

/// Check a single media item for new releases
async fn check_single_media(
    app_state: &AppState,
    pool: &SqlitePool,
    media: &EligibleMedia,
    settings: &ReleaseCheckSettings,
) -> Result<Option<ReleaseCheckResult>> {
    // Fetch with retry
    let current = match fetch_episode_info_with_retry(app_state, pool, media, settings.max_retries).await {
        Ok(info) => info,
        Err(e) => {
            // Log error
            let _ = log_check_result(
                pool, &media.media_id, "api_error",
                Some(media.last_known_count), None,
                media.last_known_latest_number, None,
                None, None,
                Some(&e.to_string()), false
            ).await;

            // Update tracking with error
            let _ = update_tracking_v2(
                pool, &media.media_id,
                &EpisodeInfo {
                    count: media.last_known_count,
                    latest_number: media.last_known_latest_number,
                    latest_id: media.last_known_latest_id.clone(),
                    raw_status: None,
                },
                None,
                Some(&e.to_string()),
                settings
            ).await;

            return Err(e);
        }
    };

    // First-time initialization (no previous data)
    if media.last_known_count == 0 && media.last_known_latest_number.is_none() {
        log::info!(
            "First-time tracking for {}: count={}, number={:?}",
            media.media_id, current.count, current.latest_number
        );

        let _ = log_check_result(
            pool, &media.media_id, "first_check",
            None, Some(current.count),
            None, current.latest_number,
            None, None, None, false
        ).await;

        let _ = update_tracking_v2(pool, &media.media_id, &current, current.latest_number, None, settings).await;

        return Ok(None);
    }

    // Check for count decrease (API inconsistency)
    if current.count < media.last_known_count {
        log::warn!(
            "Count decreased for {}: {} -> {} (ignoring)",
            media.media_id, media.last_known_count, current.count
        );

        let _ = log_check_result(
            pool, &media.media_id, "count_decreased",
            Some(media.last_known_count), Some(current.count),
            media.last_known_latest_number, current.latest_number,
            None, None, None, false
        ).await;

        // Don't update tracking with decreased count
        return Ok(None);
    }

    // Detect new release using multi-signal
    if let Some((signal, new_count)) = detect_new_release(media, &current) {
        let should_send = should_notify(media, current.latest_number);

        log::info!(
            "New {} detected for {} via {}: {} new (notify={})",
            if media.media_type == "anime" { "episodes" } else { "chapters" },
            media.media_id, signal, new_count, should_send
        );

        let _ = log_check_result(
            pool, &media.media_id, "new_release",
            Some(media.last_known_count), Some(current.count),
            media.last_known_latest_number, current.latest_number,
            Some(&signal), Some(new_count), None, should_send
        ).await;

        // Update tracking
        let _ = update_tracking_v2(
            pool, &media.media_id, &current,
            if should_send { current.latest_number } else { None },
            None, settings
        ).await;

        if should_send {
            return Ok(Some(ReleaseCheckResult {
                media_id: media.media_id.clone(),
                media_title: media.title.clone(),
                media_type: media.media_type.clone(),
                previous_count: media.last_known_count,
                current_count: current.count,
                previous_number: media.last_known_latest_number,
                current_number: current.latest_number,
                new_releases: new_count,
                extension_id: media.extension_id.clone(),
                detection_signal: signal,
            }));
        }
    } else {
        // No change
        let _ = log_check_result(
            pool, &media.media_id, "no_change",
            Some(media.last_known_count), Some(current.count),
            media.last_known_latest_number, current.latest_number,
            None, None, None, false
        ).await;

        let _ = update_tracking_v2(pool, &media.media_id, &current, None, None, settings).await;
    }

    Ok(None)
}

/// Run a full release check on all eligible media
pub async fn run_full_release_check(
    app_handle: &AppHandle,
) -> Result<Vec<ReleaseCheckResult>> {
    let app_state: tauri::State<'_, AppState> = app_handle.state();
    let pool = app_state.database.pool();

    let settings = get_release_settings(pool).await?;

    // Get eligible media
    let eligible = get_eligible_media(pool).await?;
    let total_count = eligible.len() as u32;
    log::info!("Checking {} media items for new releases", total_count);

    let mut results = Vec::new();

    for (index, media) in eligible.iter().enumerate() {
        // Check if we should stop
        if CHECKER_STOP_FLAG.load(Ordering::SeqCst) {
            log::info!("Release check stopped by user");
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

        // Emit progress
        let _ = app_handle.emit("release_check_progress", ReleaseCheckProgress {
            current_index: index as u32 + 1,
            total_count,
            media_title: media.title.clone(),
            media_type: media.media_type.clone(),
            is_complete: false,
            status: "checking".to_string(),
            error_message: None,
        });

        match check_single_media(&app_state, pool, media, &settings).await {
            Ok(Some(result)) => {
                // Emit success
                let _ = app_handle.emit("release_check_progress", ReleaseCheckProgress {
                    current_index: index as u32 + 1,
                    total_count,
                    media_title: media.title.clone(),
                    media_type: media.media_type.clone(),
                    is_complete: false,
                    status: "success".to_string(),
                    error_message: None,
                });

                // Emit notification
                if let Err(e) = emit_release_notification(app_handle, pool, &result).await {
                    log::error!("Failed to emit notification for {}: {}", result.media_id, e);
                }

                results.push(result);
            }
            Ok(None) => {
                // No new release, progress continues
            }
            Err(e) => {
                log::error!("Failed to check {}: {}", media.media_id, e);
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

        // Rate limiting
        tokio::time::sleep(Duration::from_millis(API_DELAY_MS)).await;
    }

    // Emit completion
    let _ = app_handle.emit("release_check_progress", ReleaseCheckProgress {
        current_index: total_count,
        total_count,
        media_title: String::new(),
        media_type: String::new(),
        is_complete: true,
        status: "complete".to_string(),
        error_message: None,
    });

    // Update last check timestamp
    let mut settings = settings;
    settings.last_full_check = Some(chrono::Utc::now().timestamp_millis());
    update_release_settings(pool, &settings).await?;

    // Summary notification
    if results.len() > 3 {
        emit_summary_notification(app_handle, pool, &results).await?;
    }

    Ok(results)
}

// ==================== Notification Emission ====================

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
                    result.media_title,
                    result.current_number.map(|n| format!("{:.0}", n)).unwrap_or_else(|| result.current_count.to_string())
                )
            } else {
                format!(
                    "{} - {} new episodes available!",
                    result.media_title, result.new_releases
                )
            },
        )
    } else {
        (
            "New Chapter Available",
            if result.new_releases == 1 {
                format!(
                    "{} - Chapter {} is now available!",
                    result.media_title,
                    result.current_number.map(|n| format!("{:.0}", n)).unwrap_or_else(|| result.current_count.to_string())
                )
            } else {
                format!(
                    "{} - {} new chapters available!",
                    result.media_title, result.new_releases
                )
            },
        )
    };

    let action_route = if result.media_type == "anime" {
        format!("/watch?extensionId={}&animeId={}", result.extension_id, result.media_id)
    } else {
        format!("/read?extensionId={}&mangaId={}", result.extension_id, result.media_id)
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
            "current_number": result.current_number,
            "current_count": result.current_count,
            "detection_signal": result.detection_signal,
            "extension_id": result.extension_id,
        }));

    emit_notification(app_handle, Some(pool), notification).await?;
    Ok(())
}

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

// ==================== Public API for Commands ====================

/// Get release states for multiple media (for NEW badge)
pub async fn get_media_release_states(
    pool: &SqlitePool,
    media_ids: Vec<String>,
) -> Result<Vec<MediaReleaseState>> {
    if media_ids.is_empty() {
        return Ok(vec![]);
    }

    let placeholders = media_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let query = format!(
        r#"
        SELECT
            media_id,
            last_known_latest_number,
            user_notified_up_to,
            user_acknowledged_at,
            last_checked_at,
            normalized_status
        FROM release_tracking_v2
        WHERE media_id IN ({})
        "#,
        placeholders
    );

    let mut query_builder = sqlx::query(&query);
    for id in &media_ids {
        query_builder = query_builder.bind(id);
    }

    let rows = query_builder.fetch_all(pool).await?;

    let mut states = Vec::new();
    for row in rows {
        let media_id: String = row.try_get("media_id")?;
        let latest: Option<f32> = row.try_get("last_known_latest_number")?;
        let notified: Option<f32> = row.try_get("user_notified_up_to")?;
        let acknowledged: Option<i64> = row.try_get("user_acknowledged_at")?;
        let last_checked: Option<i64> = row.try_get("last_checked_at")?;
        let status: String = row.try_get("normalized_status")?;

        // Has new release if: latest > notified AND not acknowledged
        let has_new = match (latest, notified) {
            (Some(l), Some(n)) => l > n && acknowledged.is_none(),
            (Some(_), None) => false, // First time, no notification yet
            _ => false,
        };

        states.push(MediaReleaseState {
            media_id,
            has_new_release: has_new,
            latest_number: latest,
            notified_up_to: notified,
            last_checked,
            normalized_status: status,
        });
    }

    Ok(states)
}

/// Acknowledge new releases (dismiss NEW badge)
pub async fn acknowledge_new_releases(
    pool: &SqlitePool,
    media_id: &str,
    up_to_number: Option<f32>,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        UPDATE release_tracking_v2 SET
            user_acknowledged_at = ?,
            user_notified_up_to = COALESCE(?, last_known_latest_number),
            updated_at = CURRENT_TIMESTAMP
        WHERE media_id = ?
        "#
    )
    .bind(now)
    .bind(up_to_number)
    .bind(media_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Get check history for debugging
pub async fn get_release_check_history(
    pool: &SqlitePool,
    media_id: &str,
    limit: i32,
) -> Result<Vec<CheckLogEntry>> {
    let rows = sqlx::query(
        r#"
        SELECT
            id, media_id, check_timestamp, result_type,
            previous_count, new_count,
            previous_latest_number, new_latest_number,
            detection_signal, error_message, notification_sent
        FROM release_check_log
        WHERE media_id = ?
        ORDER BY check_timestamp DESC
        LIMIT ?
        "#
    )
    .bind(media_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(CheckLogEntry {
            id: row.try_get("id")?,
            media_id: row.try_get("media_id")?,
            check_timestamp: row.try_get("check_timestamp")?,
            result_type: row.try_get("result_type")?,
            previous_count: row.try_get("previous_count")?,
            new_count: row.try_get("new_count")?,
            previous_latest_number: row.try_get("previous_latest_number")?,
            new_latest_number: row.try_get("new_latest_number")?,
            detection_signal: row.try_get("detection_signal")?,
            error_message: row.try_get("error_message")?,
            notification_sent: row.try_get::<i32, _>("notification_sent")? == 1,
        });
    }

    Ok(entries)
}

/// Get full tracking debug info
pub async fn get_release_tracking_debug(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<Option<TrackingDebugInfo>> {
    let row = sqlx::query(
        r#"
        SELECT
            media_id, extension_id, media_type,
            last_known_count, last_known_latest_number, last_known_latest_id,
            raw_status, normalized_status,
            user_notified_up_to, notification_enabled,
            last_checked_at, next_scheduled_check,
            consecutive_failures, last_error
        FROM release_tracking_v2
        WHERE media_id = ?
        "#
    )
    .bind(media_id)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(row) => {
            let logs = get_release_check_history(pool, media_id, 10).await?;

            Ok(Some(TrackingDebugInfo {
                media_id: row.try_get("media_id")?,
                extension_id: row.try_get("extension_id")?,
                media_type: row.try_get("media_type")?,
                last_known_count: row.try_get("last_known_count")?,
                last_known_latest_number: row.try_get("last_known_latest_number")?,
                last_known_latest_id: row.try_get("last_known_latest_id")?,
                raw_status: row.try_get("raw_status")?,
                normalized_status: row.try_get("normalized_status")?,
                user_notified_up_to: row.try_get("user_notified_up_to")?,
                notification_enabled: row.try_get::<i32, _>("notification_enabled")? == 1,
                last_checked_at: row.try_get("last_checked_at")?,
                next_scheduled_check: row.try_get("next_scheduled_check")?,
                consecutive_failures: row.try_get("consecutive_failures")?,
                last_error: row.try_get("last_error")?,
                recent_logs: logs,
            }))
        }
        None => Ok(None),
    }
}

// ==================== Background Checker ====================

/// Start the background release checker
pub async fn start_release_checker(app_handle: AppHandle) {
    if CHECKER_RUNNING.swap(true, Ordering::SeqCst) {
        log::warn!("Release checker is already running");
        return;
    }

    CHECKER_STOP_FLAG.store(false, Ordering::SeqCst);
    log::info!("Starting background release checker V2");

    tokio::spawn(async move {
        loop {
            if CHECKER_STOP_FLAG.load(Ordering::SeqCst) {
                log::info!("Release checker stopping");
                break;
            }

            let app_state: tauri::State<'_, AppState> = app_handle.state();
            let settings = match get_release_settings(app_state.database.pool()).await {
                Ok(s) => s,
                Err(e) => {
                    log::error!("Failed to get release settings: {}", e);
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    continue;
                }
            };

            if !settings.enabled {
                log::debug!("Release check is disabled, sleeping");
                tokio::time::sleep(Duration::from_secs(60)).await;
                continue;
            }

            // Check if it's time
            let now = chrono::Utc::now().timestamp_millis();
            let interval_ms = (settings.interval_minutes as i64) * 60 * 1000;
            let should_check = match settings.last_full_check {
                Some(last) => (now - last) >= interval_ms,
                None => true,
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

/// Check if the release checker is running
pub fn is_checker_running() -> bool {
    CHECKER_RUNNING.load(Ordering::SeqCst)
}

/// Get current release check status
pub async fn get_release_check_status(pool: &SqlitePool) -> Result<ReleaseCheckStatus> {
    let settings = get_release_settings(pool).await?;

    let next_check = settings.last_full_check.map(|last| {
        last + (settings.interval_minutes as i64) * 60 * 1000
    });

    let items_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM media m
        INNER JOIN library l ON m.id = l.media_id
        LEFT JOIN release_tracking_v2 rt ON m.id = rt.media_id
        WHERE (
                COALESCE(rt.normalized_status, 'unknown') IN ('ongoing', 'unknown')
                OR rt.normalized_status IS NULL
            )
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
        new_releases_found: 0,
    })
}
