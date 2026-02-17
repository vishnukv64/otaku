// Auto-Backup Module
//
// Handles automatic scheduled backups of user data
// Runs as a background task and manages backup rotation

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::AppState;
use crate::database::export_import::export_all_data;

/// Global flag for backup task control
static BACKUP_TASK_RUNNING: AtomicBool = AtomicBool::new(false);

/// Auto-backup settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoBackupSettings {
    pub enabled: bool,
    pub interval_hours: u32,
    pub backup_location: Option<String>,
    pub max_backups: u32,
    pub last_backup: Option<String>,
}

impl Default for AutoBackupSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_hours: 24, // Daily by default
            backup_location: None, // Will use default app data directory
            max_backups: 7, // Keep 7 backups by default
            last_backup: None,
        }
    }
}

/// Result of a backup operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub success: bool,
    pub file_path: Option<String>,
    pub timestamp: String,
    pub error: Option<String>,
    pub items_backed_up: BackupStats,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BackupStats {
    pub library_count: usize,
    pub watch_history_count: usize,
    pub reading_history_count: usize,
}

/// Get auto-backup settings from database
pub async fn get_auto_backup_settings(pool: &SqlitePool) -> Result<AutoBackupSettings> {
    let settings_json: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'auto_backup_settings'"
    )
    .fetch_optional(pool)
    .await?;

    match settings_json {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(AutoBackupSettings::default()),
    }
}

/// Save auto-backup settings to database
pub async fn save_auto_backup_settings(pool: &SqlitePool, settings: &AutoBackupSettings) -> Result<()> {
    let json = serde_json::to_string(settings)?;
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('auto_backup_settings', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        "#
    )
    .bind(&json)
    .bind(now)
    .execute(pool)
    .await?;

    Ok(())
}

/// Get the default backup directory
pub fn get_default_backup_dir(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| {
            #[cfg(not(target_os = "android"))]
            { dirs::home_dir().unwrap_or_default().join(".otaku") }
            #[cfg(target_os = "android")]
            { PathBuf::from("/data/local/tmp/otaku") }
        })
        .join("backups")
}

/// Get the backup directory (custom or default)
pub fn get_backup_dir(settings: &AutoBackupSettings, app_handle: &AppHandle) -> PathBuf {
    settings
        .backup_location
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| get_default_backup_dir(app_handle))
}

/// List existing backup files sorted by date (newest first)
pub async fn list_backups(backup_dir: &PathBuf) -> Result<Vec<(PathBuf, DateTime<Utc>)>> {
    let mut backups = Vec::new();

    if !backup_dir.exists() {
        return Ok(backups);
    }

    let mut entries = tokio::fs::read_dir(backup_dir).await?;

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();

        // Only consider .json files that match our naming pattern
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                if filename.starts_with("otaku-auto-backup-") {
                    // Extract timestamp from filename
                    if let Ok(metadata) = entry.metadata().await {
                        if let Ok(modified) = metadata.modified() {
                            let datetime: DateTime<Utc> = modified.into();
                            backups.push((path, datetime));
                        }
                    }
                }
            }
        }
    }

    // Sort by date, newest first
    backups.sort_by(|a, b| b.1.cmp(&a.1));

    Ok(backups)
}

/// Delete old backups beyond the max limit
pub async fn cleanup_old_backups(backup_dir: &PathBuf, max_backups: u32) -> Result<u32> {
    let backups = list_backups(backup_dir).await?;
    let mut deleted = 0;

    // Skip the first `max_backups` and delete the rest
    for (path, _) in backups.into_iter().skip(max_backups as usize) {
        if let Err(e) = tokio::fs::remove_file(&path).await {
            log::warn!("Failed to delete old backup {:?}: {}", path, e);
        } else {
            log::debug!("Deleted old backup: {:?}", path);
            deleted += 1;
        }
    }

    Ok(deleted)
}

/// Perform a backup
pub async fn perform_backup(
    pool: &SqlitePool,
    app_handle: &AppHandle,
    settings: &AutoBackupSettings,
) -> Result<BackupResult> {
    let backup_dir = get_backup_dir(settings, app_handle);

    // Ensure backup directory exists
    tokio::fs::create_dir_all(&backup_dir).await?;

    // Generate filename with timestamp
    let timestamp = Utc::now();
    let filename = format!(
        "otaku-auto-backup-{}.json",
        timestamp.format("%Y-%m-%d_%H-%M-%S")
    );
    let file_path = backup_dir.join(&filename);

    // Get app version
    let app_version = env!("CARGO_PKG_VERSION");

    // Export data
    let export_data = export_all_data(pool, app_version).await?;

    let stats = BackupStats {
        library_count: export_data.metadata.library_count,
        watch_history_count: export_data.metadata.watch_history_count,
        reading_history_count: export_data.metadata.reading_history_count,
    };

    // Write to file
    let json = serde_json::to_string_pretty(&export_data)?;
    tokio::fs::write(&file_path, json).await?;

    log::info!("Auto-backup created: {:?}", file_path);

    // Cleanup old backups
    let deleted = cleanup_old_backups(&backup_dir, settings.max_backups).await?;
    if deleted > 0 {
        log::info!("Cleaned up {} old backup(s)", deleted);
    }

    // Update last backup timestamp in settings
    let mut updated_settings = settings.clone();
    updated_settings.last_backup = Some(timestamp.to_rfc3339());
    save_auto_backup_settings(pool, &updated_settings).await?;

    Ok(BackupResult {
        success: true,
        file_path: Some(file_path.to_string_lossy().to_string()),
        timestamp: timestamp.to_rfc3339(),
        error: None,
        items_backed_up: stats,
    })
}

/// Check if a backup is due based on settings
pub fn is_backup_due(settings: &AutoBackupSettings) -> bool {
    if !settings.enabled {
        return false;
    }

    let Some(last_backup_str) = &settings.last_backup else {
        // No backup yet, one is due
        return true;
    };

    let Ok(last_backup) = DateTime::parse_from_rfc3339(last_backup_str) else {
        // Can't parse last backup time, assume one is due
        return true;
    };

    let now = Utc::now();
    let elapsed = now.signed_duration_since(last_backup.with_timezone(&Utc));
    let interval = chrono::Duration::hours(settings.interval_hours as i64);

    elapsed >= interval
}

/// Start the auto-backup background task
pub async fn start_auto_backup_task(app_handle: AppHandle) {
    // Only allow one backup task
    if BACKUP_TASK_RUNNING.swap(true, Ordering::SeqCst) {
        log::debug!("Auto-backup task already running");
        return;
    }

    log::info!("Starting auto-backup background task");

    tokio::spawn(async move {
        // Initial delay to let app fully initialize
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;

        loop {
            // Check every hour if a backup is due
            let check_interval = std::time::Duration::from_secs(3600);

            // Get current settings
            let state = match app_handle.try_state::<AppState>() {
                Some(s) => s,
                None => {
                    log::warn!("AppState not available for auto-backup");
                    tokio::time::sleep(check_interval).await;
                    continue;
                }
            };

            let pool = state.database.pool();

            match get_auto_backup_settings(pool).await {
                Ok(settings) => {
                    if settings.enabled && is_backup_due(&settings) {
                        log::info!("Auto-backup is due, starting backup...");

                        match perform_backup(pool, &app_handle, &settings).await {
                            Ok(result) => {
                                log::info!(
                                    "Auto-backup completed: {} library items, {} watch history entries",
                                    result.items_backed_up.library_count,
                                    result.items_backed_up.watch_history_count
                                );

                                // Emit event to notify frontend
                                let _ = app_handle.emit("auto-backup-completed", &result);
                            }
                            Err(e) => {
                                log::error!("Auto-backup failed: {}", e);

                                let _ = app_handle.emit("auto-backup-failed", serde_json::json!({
                                    "error": e.to_string()
                                }));
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Failed to get auto-backup settings: {}", e);
                }
            }

            tokio::time::sleep(check_interval).await;
        }
    });
}

/// Stop the auto-backup task (called on settings change when disabled)
#[allow(dead_code)]
pub fn stop_auto_backup_task() {
    BACKUP_TASK_RUNNING.store(false, Ordering::SeqCst);
    log::info!("Auto-backup task stopped");
}

/// Check if auto-backup task is running
#[allow(dead_code)]
pub fn is_auto_backup_running() -> bool {
    BACKUP_TASK_RUNNING.load(Ordering::SeqCst)
}
