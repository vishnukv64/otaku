use super::anime;
use crate::notifications::{emit_notification, NotificationPayload, NotificationType};
use chrono::Local;
use sqlx::SqlitePool;
use tauri::AppHandle;

/// Check today's schedule against user library and emit notifications
pub async fn check_daily_schedule_inner(app: &AppHandle, pool: &SqlitePool) -> Result<(), String> {
    // 1. Check if we already notified today
    let today = Local::now().format("%Y-%m-%d").to_string();
    let last_check: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'last_schedule_notify_date'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    if last_check.as_ref() == Some(&today) {
        log::debug!("Schedule notifications already sent today");
        return Ok(());
    }

    // 2. Determine today's day name for Jikan filter
    let day_name = Local::now().format("%A").to_string().to_lowercase();
    log::info!("Checking schedule for {} ({})", day_name, today);

    // 3. Fetch today's schedule (page 1 only for notifications)
    let schedule = tokio::task::spawn_blocking(move || anime::schedules(Some(&day_name), 1, true))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| format!("Schedule fetch error: {}", e))?;

    // 4. Cross-reference with library
    let mut matches = Vec::new();
    for result in &schedule.results {
        let in_lib: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM library WHERE media_id = ? AND status IN ('watching', 'plan_to_watch')",
        )
        .bind(&result.id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?;

        if in_lib {
            matches.push(result.clone());
        }
    }

    log::info!(
        "Found {} library anime airing today out of {} total",
        matches.len(),
        schedule.results.len()
    );

    // 5. Mark today as checked (even if no matches, to avoid re-fetching)
    sqlx::query(
        "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_schedule_notify_date', ?, datetime('now'))",
    )
    .bind(&today)
    .execute(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    if matches.is_empty() {
        return Ok(());
    }

    // 6. Emit notification(s)
    let notification = if matches.len() == 1 {
        let anime = &matches[0];
        let time_str = anime.broadcast_time.as_deref().unwrap_or("today");
        NotificationPayload::new(
            NotificationType::Info,
            format!("{} airs today", anime.title),
            format!("Airs at {} (JST)", time_str),
        )
        .with_source("schedule")
        .with_action("View Schedule", Some("/schedule".to_string()), None)
    } else {
        let titles: String = matches
            .iter()
            .take(3)
            .map(|a| a.title.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        NotificationPayload::new(
            NotificationType::Info,
            format!("{} anime from your library air today", matches.len()),
            titles,
        )
        .with_source("schedule")
        .with_action("View Schedule", Some("/schedule".to_string()), None)
    };

    emit_notification(app, Some(pool), notification)
        .await
        .map_err(|e| format!("Notification error: {}", e))?;

    Ok(())
}
