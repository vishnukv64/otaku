// Notifications Module - In-app notification system
//
// Handles:
// - Notification emission via Tauri events
// - SQLite persistence for notification history
// - Read/dismiss state management

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};
use anyhow::Result;

fn default_true() -> bool { true }

/// Event name for notification events (matches frontend listener)
pub const NOTIFICATION_EVENT: &str = "notification";

/// Notification types supported by the system
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NotificationType {
    Success,
    Error,
    Warning,
    Info,
}

impl NotificationType {
    fn as_str(&self) -> &'static str {
        match self {
            NotificationType::Success => "success",
            NotificationType::Error => "error",
            NotificationType::Warning => "warning",
            NotificationType::Info => "info",
        }
    }
}

/// Action that can be performed when clicking a notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationAction {
    pub label: String,
    pub route: Option<String>,
    pub callback: Option<String>,
}

/// Notification payload sent to frontend and stored in database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPayload {
    pub id: String,
    #[serde(rename = "type")]
    pub notification_type: NotificationType,
    pub title: String,
    pub message: String,
    pub source: Option<String>,
    pub action: Option<NotificationAction>,
    pub metadata: Option<serde_json::Value>,
    pub read: bool,
    pub dismissed: bool,
    pub timestamp: i64, // Unix timestamp in milliseconds
    /// Should this notification escalate to a native OS banner when the window
    /// is hidden? Defaults true. Set false via `with_native(false)` for purely
    /// in-app notifications (e.g. "removed from library"). Not persisted to DB.
    #[serde(default = "default_true")]
    pub escalate_to_native: bool,
}

impl NotificationPayload {
    /// Create a new notification with a generated UUID
    pub fn new(
        notification_type: NotificationType,
        title: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            notification_type,
            title: title.into(),
            message: message.into(),
            source: None,
            action: None,
            metadata: None,
            read: false,
            dismissed: false,
            timestamp: chrono::Utc::now().timestamp_millis(),
            escalate_to_native: true,
        }
    }

    /// Set the source of the notification (e.g., "download", "library")
    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }

    /// Add an action to the notification
    pub fn with_action(mut self, label: impl Into<String>, route: Option<String>, callback: Option<String>) -> Self {
        self.action = Some(NotificationAction {
            label: label.into(),
            route,
            callback,
        });
        self
    }

    /// Add metadata to the notification
    pub fn with_metadata(mut self, metadata: serde_json::Value) -> Self {
        self.metadata = Some(metadata);
        self
    }

    /// Opt this notification out of native OS escalation.
    #[allow(dead_code)]
    pub fn with_native(mut self, escalate: bool) -> Self {
        self.escalate_to_native = escalate;
        self
    }
}

/// Emit a notification to the frontend, persist it, and optionally escalate
/// to a native OS banner.
///
/// Escalation rules (desktop only):
///   - desktop_notifications setting enabled (default true)
///   - payload.escalate_to_native true (default true)
///
/// Native banners fire regardless of whether the window is focused or hidden,
/// matching the Slack/Discord convention. The pending deep-link is set so
/// the next app activation (banner click, dock click, tray) navigates to the
/// notification's `action.route`.
pub async fn emit_notification(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    notification: NotificationPayload,
) -> Result<()> {
    // 1. In-app event (drives the existing toast UI and any other listeners).
    if let Err(e) = app_handle.emit(NOTIFICATION_EVENT, &notification) {
        log::error!("Failed to emit notification event: {}", e);
    } else {
        log::debug!(
            "Emitted notification: {} - {}",
            notification.title,
            notification.message
        );
    }

    // 2. Desktop: escalate to native banner whenever enabled + flagged.
    #[cfg(desktop)]
    {
        use tauri::Manager;

        let desktop_notifs_enabled = match pool {
            Some(pool) => read_desktop_notifications_setting(pool).await,
            None => true,
        };

        if should_escalate_native(desktop_notifs_enabled, notification.escalate_to_native) {
            send_system_notification(app_handle, &notification);

            if let Some(route) = notification.action.as_ref().and_then(|a| a.route.clone()) {
                if let Some(state) = app_handle.try_state::<crate::tray::TrayLifecycleState>() {
                    if let Ok(mut pending) = state.pending_deeplink.lock() {
                        *pending = Some(route);
                    }
                }
            }
        }
    }

    // 3. Android: always send a system notification (unchanged from before).
    #[cfg(target_os = "android")]
    {
        send_system_notification(app_handle, &notification);
    }

    // 4. Persist.
    if let Some(pool) = pool {
        save_notification(pool, &notification).await?;
    }

    Ok(())
}

/// Send a native system notification via the OS notification center.
/// Used on Android (always) and on desktop (gated by `should_escalate_native`).
fn send_system_notification(app_handle: &AppHandle, notification: &NotificationPayload) {
    use tauri_plugin_notification::NotificationExt;

    if let Err(e) = app_handle
        .notification()
        .builder()
        .title(&notification.title)
        .body(&notification.message)
        .show()
    {
        log::error!("Failed to send system notification: {}", e);
    }
}

/// Read the user's desktop-notification preference from `app_settings`.
/// Defaults to true if the row is missing or unreadable.
#[cfg(desktop)]
async fn read_desktop_notifications_setting(pool: &SqlitePool) -> bool {
    let row: Result<Option<String>, _> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'desktop_notifications_enabled'",
    )
    .fetch_optional(pool)
    .await;

    match row {
        Ok(Some(v)) => v != "false" && v != "0",
        Ok(None) => true,
        Err(e) => {
            log::warn!("Failed to read desktop_notifications_enabled: {}", e);
            true
        }
    }
}

/// Save a notification to the database (public version for commands)
pub async fn save_notification_public(pool: &SqlitePool, notification: &NotificationPayload) -> Result<()> {
    save_notification(pool, notification).await
}

/// Save a notification to the database
async fn save_notification(pool: &SqlitePool, notification: &NotificationPayload) -> Result<()> {
    let action_label = notification.action.as_ref().map(|a| a.label.clone());
    let action_route = notification.action.as_ref().and_then(|a| a.route.clone());
    let action_callback = notification.action.as_ref().and_then(|a| a.callback.clone());
    let metadata_json = notification.metadata.as_ref().map(|m| m.to_string());

    sqlx::query(
        r#"
        INSERT INTO notifications (
            id, notification_type, title, message, source,
            action_label, action_route, action_callback, metadata,
            read, dismissed, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#
    )
    .bind(&notification.id)
    .bind(notification.notification_type.as_str())
    .bind(&notification.title)
    .bind(&notification.message)
    .bind(&notification.source)
    .bind(&action_label)
    .bind(&action_route)
    .bind(&action_callback)
    .bind(&metadata_json)
    .bind(notification.read)
    .bind(notification.dismissed)
    .bind(notification.timestamp)
    .execute(pool)
    .await?;

    Ok(())
}

/// List notifications from the database
pub async fn list_notifications(
    pool: &SqlitePool,
    limit: i32,
    include_dismissed: bool,
) -> Result<Vec<NotificationPayload>> {
    let query = if include_dismissed {
        r#"
        SELECT id, notification_type, title, message, source,
               action_label, action_route, action_callback, metadata,
               read, dismissed, created_at
        FROM notifications
        ORDER BY created_at DESC
        LIMIT ?
        "#
    } else {
        r#"
        SELECT id, notification_type, title, message, source,
               action_label, action_route, action_callback, metadata,
               read, dismissed, created_at
        FROM notifications
        WHERE dismissed = 0
        ORDER BY created_at DESC
        LIMIT ?
        "#
    };

    let rows = sqlx::query(query)
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let mut notifications = Vec::new();
    for row in rows {
        use sqlx::Row;

        let notification_type_str: String = row.try_get("notification_type")?;
        let notification_type = match notification_type_str.as_str() {
            "success" => NotificationType::Success,
            "error" => NotificationType::Error,
            "warning" => NotificationType::Warning,
            "info" => NotificationType::Info,
            _ => NotificationType::Info,
        };

        let action_label: Option<String> = row.try_get("action_label").ok();
        let action_route: Option<String> = row.try_get("action_route").ok().flatten();
        let action_callback: Option<String> = row.try_get("action_callback").ok().flatten();
        let metadata_json: Option<String> = row.try_get("metadata").ok().flatten();

        let action = action_label.map(|label| NotificationAction {
            label,
            route: action_route,
            callback: action_callback,
        });

        let metadata = metadata_json.and_then(|json| serde_json::from_str(&json).ok());

        notifications.push(NotificationPayload {
            id: row.try_get("id")?,
            notification_type,
            title: row.try_get("title")?,
            message: row.try_get("message")?,
            source: row.try_get("source").ok().flatten(),
            action,
            metadata,
            read: row.try_get::<i32, _>("read")? != 0,
            dismissed: row.try_get::<i32, _>("dismissed")? != 0,
            timestamp: row.try_get("created_at")?,
            escalate_to_native: true,
        });
    }

    Ok(notifications)
}

/// Mark a notification as read
pub async fn mark_notification_read(pool: &SqlitePool, notification_id: &str) -> Result<()> {
    sqlx::query("UPDATE notifications SET read = 1 WHERE id = ?")
        .bind(notification_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Mark all notifications as read
pub async fn mark_all_notifications_read(pool: &SqlitePool) -> Result<()> {
    sqlx::query("UPDATE notifications SET read = 1 WHERE read = 0")
        .execute(pool)
        .await?;

    Ok(())
}

/// Dismiss a notification (soft delete)
pub async fn dismiss_notification(pool: &SqlitePool, notification_id: &str) -> Result<()> {
    sqlx::query("UPDATE notifications SET dismissed = 1 WHERE id = ?")
        .bind(notification_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Clear all notifications (hard delete)
pub async fn clear_all_notifications(pool: &SqlitePool) -> Result<()> {
    sqlx::query("DELETE FROM notifications")
        .execute(pool)
        .await?;

    Ok(())
}

/// Get count of unread notifications
pub async fn get_unread_count(pool: &SqlitePool) -> Result<i32> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notifications WHERE read = 0 AND dismissed = 0"
    )
    .fetch_one(pool)
    .await?;

    Ok(count as i32)
}

/// Should `emit_notification` escalate this payload to a native OS banner?
///
/// Fires whenever the user has desktop notifications enabled and the payload
/// is escalation-eligible. Window focus/visibility is intentionally ignored —
/// users want native banners (with macOS notification-center history) even
/// when the app is in view, matching the Slack/Discord convention.
pub(crate) fn should_escalate_native(
    desktop_notifs_enabled: bool,
    escalate_flag: bool,
) -> bool {
    desktop_notifs_enabled && escalate_flag
}

// ==================== Helper Functions for Common Notifications ====================
// These are utility functions that can be called from anywhere in the backend
// Some may not be used yet but are available for future use

/// Emit a download started notification
#[allow(dead_code)]
pub async fn notify_download_started(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    title: &str,
    episode_number: i32,
    media_id: &str,
) -> Result<()> {
    let notification = NotificationPayload::new(
        NotificationType::Info,
        "Download Started",
        format!("Started downloading {} Episode {}", title, episode_number),
    )
    .with_source("download")
    .with_metadata(serde_json::json!({
        "title": title,
        "episode_number": episode_number,
        "media_id": media_id
    }));

    emit_notification(app_handle, pool, notification).await
}

/// Emit a download completed notification
pub async fn notify_download_complete(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    title: &str,
    episode_number: i32,
    media_id: &str,
) -> Result<()> {
    let notification = NotificationPayload::new(
        NotificationType::Success,
        "Download Complete",
        format!("{} Episode {} downloaded successfully", title, episode_number),
    )
    .with_source("download")
    .with_action("Open Downloads", Some("/downloads".to_string()), None)
    .with_metadata(serde_json::json!({
        "title": title,
        "episode_number": episode_number,
        "media_id": media_id
    }));

    emit_notification(app_handle, pool, notification).await
}

/// Emit a download failed notification
pub async fn notify_download_failed(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    title: &str,
    episode_number: i32,
    error: &str,
    media_id: &str,
) -> Result<()> {
    let notification = NotificationPayload::new(
        NotificationType::Error,
        "Download Failed",
        format!("Failed to download {} Episode {}: {}", title, episode_number, error),
    )
    .with_source("download")
    .with_metadata(serde_json::json!({
        "title": title,
        "episode_number": episode_number,
        "error": error,
        "media_id": media_id
    }));

    emit_notification(app_handle, pool, notification).await
}

/// Emit a chapter download completed notification
pub async fn notify_chapter_download_complete(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    manga_title: &str,
    chapter_number: f64,
    media_id: &str,
) -> Result<()> {
    let notification = NotificationPayload::new(
        NotificationType::Success,
        "Chapter Downloaded",
        format!("{} Chapter {} downloaded successfully", manga_title, chapter_number),
    )
    .with_source("download")
    .with_action("Open Downloads", Some("/downloads".to_string()), None)
    .with_metadata(serde_json::json!({
        "manga_title": manga_title,
        "chapter_number": chapter_number,
        "media_id": media_id
    }));

    emit_notification(app_handle, pool, notification).await
}

/// Emit a chapter download failed notification
pub async fn notify_chapter_download_failed(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    manga_title: &str,
    chapter_number: f64,
    error: &str,
    media_id: &str,
) -> Result<()> {
    let notification = NotificationPayload::new(
        NotificationType::Error,
        "Chapter Download Failed",
        format!("Failed to download {} Chapter {}: {}", manga_title, chapter_number, error),
    )
    .with_source("download")
    .with_metadata(serde_json::json!({
        "manga_title": manga_title,
        "chapter_number": chapter_number,
        "error": error,
        "media_id": media_id
    }));

    emit_notification(app_handle, pool, notification).await
}

/// Emit a library added notification
#[allow(dead_code)]
pub async fn notify_added_to_library(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    title: &str,
) -> Result<()> {
    let notification = NotificationPayload::new(
        NotificationType::Success,
        "Added to Library",
        format!("'{}' has been added to your library", title),
    )
    .with_source("library")
    .with_action("View Library", Some("/library".to_string()), None);

    emit_notification(app_handle, pool, notification).await
}

/// Emit a library removed notification
#[allow(dead_code)]
pub async fn notify_removed_from_library(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    title: &str,
) -> Result<()> {
    let notification = NotificationPayload::new(
        NotificationType::Info,
        "Removed from Library",
        format!("'{}' has been removed from your library", title),
    )
    .with_source("library");

    emit_notification(app_handle, pool, notification).await
}

/// Emit an app-update-available notification. Routes through `emit_notification`
/// so it inherits the in-app toast, native banner escalation (when window is
/// hidden), and DB persistence.
pub async fn notify_app_update_available(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    version: &str,
) -> Result<()> {
    let notification = NotificationPayload::new(
        NotificationType::Info,
        "Update available",
        format!("Otaku {} is ready to install.", version),
    )
    .with_source("updater")
    .with_action(
        "Update",
        Some("/settings".to_string()),
        None,
    )
    .with_metadata(serde_json::json!({ "version": version }));

    emit_notification(app_handle, pool, notification).await
}

#[cfg(test)]
mod tests {
    use super::should_escalate_native;

    #[test]
    fn enabled_and_flagged_escalates() {
        // Default case: user has desktop notifications on and the payload
        // hasn't opted out. Native banner should fire regardless of window
        // focus/visibility (those are no longer inputs).
        assert!(should_escalate_native(true, true));
    }

    #[test]
    fn desktop_notifications_disabled_suppresses() {
        assert!(!should_escalate_native(false, true));
    }

    #[test]
    fn escalate_flag_false_suppresses() {
        // Cosmetic in-app-only notifications (e.g. "removed from library")
        // call `.with_native(false)` and must not fire a native banner.
        assert!(!should_escalate_native(true, false));
    }

    #[test]
    fn both_off_suppresses() {
        assert!(!should_escalate_native(false, false));
    }
}
