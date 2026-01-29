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
}

/// Emit a notification event to the frontend and optionally save to database
pub async fn emit_notification(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    notification: NotificationPayload,
) -> Result<()> {
    // Emit event to frontend
    if let Err(e) = app_handle.emit(NOTIFICATION_EVENT, &notification) {
        log::error!("Failed to emit notification event: {}", e);
    } else {
        log::debug!("Emitted notification: {} - {}", notification.title, notification.message);
    }

    // Save to database if pool is provided
    if let Some(pool) = pool {
        save_notification(pool, &notification).await?;
    }

    Ok(())
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
) -> Result<()> {
    let notification = NotificationPayload::new(
        NotificationType::Info,
        "Download Started",
        format!("Started downloading {} Episode {}", title, episode_number),
    )
    .with_source("download")
    .with_metadata(serde_json::json!({
        "title": title,
        "episode_number": episode_number
    }));

    emit_notification(app_handle, pool, notification).await
}

/// Emit a download completed notification
pub async fn notify_download_complete(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    title: &str,
    episode_number: i32,
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
        "episode_number": episode_number
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
        "error": error
    }));

    emit_notification(app_handle, pool, notification).await
}

/// Emit a chapter download completed notification
pub async fn notify_chapter_download_complete(
    app_handle: &AppHandle,
    pool: Option<&SqlitePool>,
    manga_title: &str,
    chapter_number: f64,
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
        "chapter_number": chapter_number
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
        "error": error
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
