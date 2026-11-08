// Downloads Module - Download queue and management
//
// Handles:
// - Download queue with Tokio tasks
// - Progress tracking with database persistence
// - Pause/resume/cancel operations
// - Concurrent downloads (max 3)
// - File integrity verification
// - Chapter downloads for manga

pub mod chapter_downloads;
pub mod obfuscation;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use anyhow::{Result, Context};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use sqlx::{SqlitePool, Row};
use tauri::{AppHandle, Emitter};
use crate::notifications;
use crate::extensions::Subtitle;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub id: String,
    pub media_id: String,
    pub episode_id: String,
    pub episode_number: i32,
    pub filename: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_referrer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle_language: Option<String>,
    pub file_path: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub percentage: f32,
    pub speed: u64, // bytes per second
    pub status: DownloadStatus,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone)]
struct HlsSegment {
    url: String,
    duration: Option<f32>,
    is_map: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct HlsResumeState {
    downloaded: u64,
    map_bytes: u64,
    media_bytes: u64,
    completed_media_segments: usize,
    next_index: usize,
}

/// Event name for download progress updates
pub const DOWNLOAD_PROGRESS_EVENT: &str = "download-progress";

const MISSING_FILE_ERROR: &str = "File not found. Please re-download.";

pub struct DownloadManager {
    downloads: Arc<RwLock<HashMap<String, DownloadProgress>>>,
    active_downloads: Arc<Mutex<usize>>,
    max_concurrent: usize,
    download_dir: PathBuf,
    db_pool: Option<Arc<SqlitePool>>,
    app_handle: Option<AppHandle>,
}

impl DownloadManager {
    pub fn new(download_dir: PathBuf) -> Self {
        Self {
            downloads: Arc::new(RwLock::new(HashMap::new())),
            active_downloads: Arc::new(Mutex::new(0)),
            max_concurrent: 10,
            download_dir,
            db_pool: None,
            app_handle: None,
        }
    }

    /// Set the database pool for persistence
    pub fn with_database(mut self, pool: Arc<SqlitePool>) -> Self {
        self.db_pool = Some(pool);
        self
    }

    /// Set the app handle for emitting events
    pub fn with_app_handle(mut self, handle: AppHandle) -> Self {
        self.app_handle = Some(handle);
        self
    }

    /// Emit a download progress event to the frontend
    fn emit_progress(&self, progress: &DownloadProgress) {
        if let Some(ref handle) = self.app_handle {
            if let Err(e) = handle.emit(DOWNLOAD_PROGRESS_EVENT, progress) {
                log::error!("Failed to emit download progress event: {}", e);
            }
        }
    }

    /// Map a path saved under an older copy of the download folder (same folder name,
    /// different parent) onto the current one. `None` when it does not live there.
    fn rebase_into(download_dir: &std::path::Path, stored: &str) -> Option<PathBuf> {
        let dir_name = download_dir.file_name()?;
        let stored = std::path::Path::new(stored);
        let comps: Vec<_> = stored.components().collect();
        let at = comps.iter().rposition(|c| c.as_os_str() == dir_name)?;
        let rest: PathBuf = comps[at + 1..].iter().collect();
        (!rest.as_os_str().is_empty()).then(|| download_dir.join(rest))
    }

    /// Load downloads from database on startup
    pub async fn load_from_database(&self) -> Result<()> {
        if let Some(pool) = &self.db_pool {
            let rows = sqlx::query(
                r#"
                SELECT id, media_id, episode_id, episode_number, filename, url, source_referrer, file_path,
                       total_bytes, downloaded_bytes, percentage, speed, status, error_message
                FROM downloads
                "#
            )
            .fetch_all(pool.as_ref())
            .await?;

            let mut downloads = self.downloads.write().await;
            for row in rows {
                // Check if file still exists and get its size
                let stored_path: String = row.try_get("file_path")?;
                let mut original_status_str: String = row.try_get("status")?;
                let stored_error: Option<String> = row.try_get("error_message")?;
                let mut file_path = stored_path.clone();
                let mut file_exists = tokio::fs::metadata(&file_path).await.is_ok();
                let mut rebased = false;
                if !file_exists {
                    // iOS moves the app's data container on reinstall/update, so absolute
                    // paths saved earlier point at a folder that no longer exists while the
                    // files sit at the same place under the new container.
                    if let Some(moved) = Self::rebase_into(&self.download_dir, &stored_path) {
                        if tokio::fs::metadata(&moved).await.is_ok() {
                            file_path = moved.to_string_lossy().to_string();
                            file_exists = true;
                            rebased = true;
                            // Undo the earlier "file missing" downgrade for the same reason.
                            if original_status_str == "failed"
                                && stored_error.as_deref() == Some(MISSING_FILE_ERROR)
                            {
                                original_status_str = "completed".to_string();
                            }
                        }
                    }
                }

                let completed_file_missing = original_status_str == "completed" && !file_exists;
                let mut status_str = original_status_str.clone();
                // If completed but file missing, mark as failed
                if completed_file_missing {
                    status_str = "failed".to_string();
                }

                let status = match status_str.as_str() {
                    "queued" => DownloadStatus::Queued,
                    "downloading" => DownloadStatus::Failed, // Mark in-progress as failed on restart
                    "paused" => DownloadStatus::Paused,
                    "completed" if file_exists => DownloadStatus::Completed,
                    "completed" => DownloadStatus::Failed,
                    "failed" => DownloadStatus::Failed,
                    "cancelled" => DownloadStatus::Cancelled,
                    _ => DownloadStatus::Failed,
                };

                // Completed downloads should report the real file size, not an
                // earlier network estimate.
                let mut total_bytes = row.try_get::<i64, _>("total_bytes")? as u64;
                let mut downloaded_bytes = row.try_get::<i64, _>("downloaded_bytes")? as u64;

                if status == DownloadStatus::Completed && file_exists {
                    if let Ok(file_size) = Self::downloaded_file_size(&file_path).await {
                        if total_bytes != file_size || downloaded_bytes != file_size {
                            total_bytes = file_size;
                            downloaded_bytes = file_size;
                            log::debug!("Fixed completed download size");

                            // Update database with correct size
                            let updated_progress = DownloadProgress {
                                id: row.try_get("id")?,
                                media_id: row.try_get("media_id")?,
                                episode_id: row.try_get("episode_id")?,
                                episode_number: row.try_get("episode_number")?,
                                filename: row.try_get("filename")?,
                                url: row.try_get("url")?,
                                source_referrer: row.try_get("source_referrer")?,
                                subtitle_url: None,
                                subtitle_label: None,
                                subtitle_language: None,
                                file_path: file_path.clone(),
                                total_bytes,
                                downloaded_bytes,
                                percentage: 100.0,
                                speed: 0,
                                status: DownloadStatus::Completed,
                                error_message: None,
                            };
                            Self::save_progress_to_db(pool, &updated_progress).await.ok();
                        }
                    }
                }

                let progress = DownloadProgress {
                    id: row.try_get("id")?,
                    media_id: row.try_get("media_id")?,
                    episode_id: row.try_get("episode_id")?,
                    episode_number: row.try_get("episode_number")?,
                    filename: row.try_get("filename")?,
                    url: row.try_get("url")?,
                    source_referrer: row.try_get("source_referrer")?,
                    subtitle_url: None,
                    subtitle_label: None,
                    subtitle_language: None,
                    file_path,
                    total_bytes,
                    downloaded_bytes,
                    percentage: row.try_get::<f32, _>("percentage")?,
                    speed: row.try_get::<i64, _>("speed")? as u64,
                    status,
                    error_message: if completed_file_missing {
                        Some(MISSING_FILE_ERROR.to_string())
                    } else if rebased && status_str == "completed" {
                        None
                    } else {
                        stored_error
                    },
                };

                if completed_file_missing || rebased || original_status_str == "downloading" {
                    Self::save_progress_to_db(pool, &progress).await.ok();
                }

                downloads.insert(progress.id.clone(), progress);
            }

            log::debug!("Loaded {} downloads from database", downloads.len());
        }
        Ok(())
    }

    /// Save download to database
    async fn save_to_database(&self, download: &DownloadProgress) -> Result<()> {
        if let Some(pool) = &self.db_pool {
            let status_str = format!("{:?}", download.status).to_lowercase();
            sqlx::query(
                r#"
                INSERT INTO downloads (
                    id, media_id, episode_id, episode_number, filename, url, source_referrer, file_path,
                    total_bytes, downloaded_bytes, percentage, speed, status, error_message,
                    created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    source_referrer = ?,
                    total_bytes = ?,
                    downloaded_bytes = ?,
                    percentage = ?,
                    speed = ?,
                    status = ?,
                    error_message = ?,
                    updated_at = CURRENT_TIMESTAMP
                "#
            )
            .bind(&download.id)
            .bind(&download.media_id)
            .bind(&download.episode_id)
            .bind(download.episode_number)
            .bind(&download.filename)
            .bind(&download.url)
            .bind(&download.source_referrer)
            .bind(&download.file_path)
            .bind(download.total_bytes as i64)
            .bind(download.downloaded_bytes as i64)
            .bind(download.percentage)
            .bind(download.speed as i64)
            .bind(&status_str)
            .bind(&download.error_message)
            // For UPDATE
            .bind(&download.source_referrer)
            .bind(download.total_bytes as i64)
            .bind(download.downloaded_bytes as i64)
            .bind(download.percentage)
            .bind(download.speed as i64)
            .bind(&status_str)
            .bind(&download.error_message)
            .execute(pool.as_ref())
            .await?;
        }
        Ok(())
    }

    /// Delete download from database
    async fn delete_from_database(&self, download_id: &str) -> Result<()> {
        if let Some(pool) = &self.db_pool {
            sqlx::query("DELETE FROM downloads WHERE id = ?")
                .bind(download_id)
                .execute(pool.as_ref())
                .await?;
        }
        Ok(())
    }

    /// Queue a new download
    pub async fn queue_download(
        &self,
        id: String,
        media_id: String,
        episode_id: String,
        episode_number: i32,
        url: String,
        filename: String,
        custom_path: Option<String>,
        source_referrer: Option<String>,
        subtitle_url: Option<String>,
        subtitle_label: Option<String>,
        subtitle_language: Option<String>,
    ) -> Result<()> {
        let filename = if Self::is_hls_url(&url) && filename.ends_with(".otaku") {
            format!("{}.m3u8", filename.trim_end_matches(".otaku"))
        } else {
            filename
        };

        // Use custom path if provided, otherwise use default download_dir
        let download_dir = custom_path
            .map(PathBuf::from)
            .unwrap_or_else(|| self.download_dir.clone());

        // Ensure the directory exists
        tokio::fs::create_dir_all(&download_dir).await.ok();

        let file_path = download_dir.join(&filename);

        let progress = DownloadProgress {
            id: id.clone(),
            media_id,
            episode_id,
            episode_number,
            filename,
            url,
            source_referrer,
            subtitle_url,
            subtitle_label,
            subtitle_language,
            file_path: file_path.to_string_lossy().to_string(),
            total_bytes: 0,
            downloaded_bytes: 0,
            percentage: 0.0,
            speed: 0,
            status: DownloadStatus::Queued,
            error_message: None,
        };

        // Save to database
        self.save_to_database(&progress).await.ok();

        let mut downloads = self.downloads.write().await;
        downloads.insert(id.clone(), progress.clone());
        drop(downloads);

        // Emit queued event
        self.emit_progress(&progress);

        log::debug!("Queued download: {}", id);

        // Start download task
        self.start_download_task(id).await?;

        Ok(())
    }

    /// Start a download task
    async fn start_download_task(&self, download_id: String) -> Result<()> {
        let downloads = self.downloads.clone();
        let active_downloads = self.active_downloads.clone();
        let max_concurrent = self.max_concurrent;
        let db_pool = self.db_pool.clone();
        let app_handle = self.app_handle.clone();

        tokio::spawn(async move {
            // Wait for available slot
            loop {
                let active = active_downloads.lock().await;
                if *active < max_concurrent {
                    break;
                }
                drop(active);
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }

            // Check if download was cancelled while waiting in queue
            {
                let downloads_map = downloads.read().await;
                if let Some(progress) = downloads_map.get(&download_id) {
                    if progress.status == DownloadStatus::Cancelled {
                        log::debug!("Download was cancelled while queued: {}", download_id);
                        return;
                    }
                }
            }

            // Acquire slot
            {
                let mut active = active_downloads.lock().await;
                *active += 1;
            }

            // Update status to downloading and emit event
            let should_proceed = {
                let mut downloads_map = downloads.write().await;
                if let Some(progress) = downloads_map.get_mut(&download_id) {
                    // Check again if cancelled (could have been cancelled between the read and write)
                    if progress.status == DownloadStatus::Cancelled {
                        log::debug!("Download was cancelled before starting: {}", download_id);
                        false
                    } else {
                        progress.status = DownloadStatus::Downloading;

                        // Emit event
                        if let Some(ref handle) = app_handle {
                            let _ = handle.emit(DOWNLOAD_PROGRESS_EVENT, progress.clone());
                        }

                        // Save to database
                        if let Some(pool) = &db_pool {
                            Self::save_progress_to_db(pool, progress).await.ok();
                        }
                        true
                    }
                } else {
                    false
                }
            };

            // Update tray downloads count after transitioning to Downloading
            if should_proceed {
                if let (Some(ref handle), Some(ref pool)) = (&app_handle, &db_pool) {
                    let active = total_active_downloads(&downloads, pool.as_ref()).await;
                    crate::tray::update_downloads_count(handle, active);
                }
            }

            // If cancelled or not found, release slot and return
            if !should_proceed {
                let mut active = active_downloads.lock().await;
                *active -= 1;
                return;
            }

            // Perform download
            let result = Self::perform_download(
                download_id.clone(),
                downloads.clone(),
                db_pool.clone(),
                app_handle.clone(),
            ).await;

            // Release slot
            {
                let mut active = active_downloads.lock().await;
                *active -= 1;
            }

            // Update final status and emit event
            {
                let mut downloads_map = downloads.write().await;
                if let Some(progress) = downloads_map.get_mut(&download_id) {
                    match result {
                        Ok(_) => {
                            progress.status = DownloadStatus::Completed;
                            progress.percentage = 100.0;

                            // Persist the final local size. HLS media bytes live in
                            // a sibling segment directory, not in the playlist file.
                            if let Ok(file_size) = Self::downloaded_file_size(&progress.file_path).await {
                                if file_size > 0 {
                                    progress.total_bytes = file_size;
                                    progress.downloaded_bytes = file_size;
                                    log::debug!("Updated total_bytes to actual file size: {} bytes", file_size);
                                }
                            }

                            log::debug!("Download completed: {} ({} bytes)", download_id, progress.total_bytes);

                            // Emit notification for completed download
                            if let Some(ref handle) = app_handle {
                                // Extract title from filename (format: Title_EP1_quality.mp4)
                                let title = progress.filename
                                    .split("_EP")
                                    .next()
                                    .unwrap_or(&progress.filename)
                                    .replace('_', " ");

                                let _ = notifications::notify_download_complete(
                                    handle,
                                    db_pool.as_ref().map(|p| p.as_ref()),
                                    &title,
                                    progress.episode_number,
                                    &progress.media_id,
                                ).await;
                            }
                        }
                        Err(e) => {
                            // Don't overwrite Cancelled or Paused status - they were intentional
                            if progress.status != DownloadStatus::Cancelled && progress.status != DownloadStatus::Paused {
                                progress.status = DownloadStatus::Failed;
                                progress.error_message = Some(e.to_string());
                                log::error!("Download failed: {} - {}", download_id, e);

                                // Emit notification for failed download
                                if let Some(ref handle) = app_handle {
                                    // Extract title from filename
                                    let title = progress.filename
                                        .split("_EP")
                                        .next()
                                        .unwrap_or(&progress.filename)
                                        .replace('_', " ");

                                    let _ = notifications::notify_download_failed(
                                        handle,
                                        db_pool.as_ref().map(|p| p.as_ref()),
                                        &title,
                                        progress.episode_number,
                                        &e.to_string(),
                                        &progress.media_id,
                                    ).await;
                                }
                            } else if progress.status == DownloadStatus::Cancelled {
                                log::debug!("Download was cancelled: {}", download_id);
                            } else {
                                log::debug!("Download was paused: {}", download_id);
                            }
                        }
                    }

                    // Emit final status event
                    if let Some(ref handle) = app_handle {
                        let _ = handle.emit(DOWNLOAD_PROGRESS_EVENT, progress.clone());
                    }

                    // Save final status to database
                    if let Some(pool) = &db_pool {
                        Self::save_progress_to_db(pool, progress).await.ok();
                    }
                }
            }

            // Update tray downloads count after final status transition
            if let (Some(ref handle), Some(ref pool)) = (&app_handle, &db_pool) {
                let active = total_active_downloads(&downloads, pool.as_ref()).await;
                crate::tray::update_downloads_count(handle, active);
            }
        });

        Ok(())
    }

    /// Helper to save progress to database (for use in spawned tasks)
    async fn save_progress_to_db(pool: &Arc<SqlitePool>, progress: &DownloadProgress) -> Result<()> {
        let status_str = format!("{:?}", progress.status).to_lowercase();
        sqlx::query(
            r#"
            INSERT INTO downloads (
                id, media_id, episode_id, episode_number, filename, url, source_referrer, file_path,
                total_bytes, downloaded_bytes, percentage, speed, status, error_message,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                source_referrer = ?,
                file_path = ?,
                total_bytes = ?,
                downloaded_bytes = ?,
                percentage = ?,
                speed = ?,
                status = ?,
                error_message = ?,
                updated_at = CURRENT_TIMESTAMP
            "#
        )
        .bind(&progress.id)
        .bind(&progress.media_id)
        .bind(&progress.episode_id)
        .bind(progress.episode_number)
        .bind(&progress.filename)
        .bind(&progress.url)
        .bind(&progress.source_referrer)
        .bind(&progress.file_path)
        .bind(progress.total_bytes as i64)
        .bind(progress.downloaded_bytes as i64)
        .bind(progress.percentage)
        .bind(progress.speed as i64)
        .bind(&status_str)
        .bind(&progress.error_message)
        // For UPDATE
        .bind(&progress.source_referrer)
        .bind(&progress.file_path)
        .bind(progress.total_bytes as i64)
        .bind(progress.downloaded_bytes as i64)
        .bind(progress.percentage)
        .bind(progress.speed as i64)
        .bind(&status_str)
        .bind(&progress.error_message)
        .execute(pool.as_ref())
        .await?;
        Ok(())
    }

    fn is_hls_url(url: &str) -> bool {
        url.to_ascii_lowercase().contains(".m3u8")
    }

    fn absolutize_hls_uri(uri: &str, base_url: &str) -> Result<String> {
        if uri.starts_with("http://") || uri.starts_with("https://") {
            return Ok(uri.to_string());
        }

        reqwest::Url::parse(base_url)
            .context("Invalid HLS playlist URL")?
            .join(uri)
            .context("Invalid HLS playlist entry")
            .map(|url| url.to_string())
    }

    fn parse_hls_attribute(line: &str, name: &str) -> Option<String> {
        let pattern = format!("{}=", name);
        let start = line.find(&pattern)? + pattern.len();
        let rest = &line[start..];

        if let Some(quoted) = rest.strip_prefix('"') {
            return quoted.find('"').map(|end| quoted[..end].to_string());
        }

        rest.split(',').next().map(|value| value.trim().to_string())
    }

    fn hls_variant_height(line: &str) -> u32 {
        Self::parse_hls_attribute(line, "RESOLUTION")
            .and_then(|resolution| resolution.split_once('x').map(|(_, height)| height.to_string()))
            .and_then(|height| height.parse::<u32>().ok())
            .unwrap_or(0)
    }

    /// Separate audio rendition (EXT-X-MEDIA TYPE=AUDIO with URI); DEFAULT=YES wins, else first.
    // ponytail: ignores the variant's AUDIO group-id (KAA masters have one group);
    // match GROUP-ID to the chosen variant if a provider ever ships several.
    fn parse_hls_audio_uri(text: &str, base_url: &str) -> Option<String> {
        let mut first = None;
        for line in text.lines().map(str::trim).filter(|l| l.starts_with("#EXT-X-MEDIA")) {
            if Self::parse_hls_attribute(line, "TYPE").as_deref() != Some("AUDIO") {
                continue;
            }
            let Some(uri) = Self::parse_hls_attribute(line, "URI") else { continue };
            let Ok(url) = Self::absolutize_hls_uri(&uri, base_url) else { continue };
            if Self::parse_hls_attribute(line, "DEFAULT").as_deref() == Some("YES") {
                return Some(url);
            }
            first.get_or_insert(url);
        }
        first
    }

    fn parse_hls_playlist(text: &str, base_url: &str) -> Result<(Vec<(u32, String)>, Vec<HlsSegment>)> {
        let mut variants = Vec::new();
        let mut segments = Vec::new();
        let mut pending_variant_height: Option<u32> = None;
        let mut pending_duration: Option<f32> = None;

        for raw_line in text.lines() {
            let line = raw_line.trim();
            if line.is_empty() {
                continue;
            }

            if line.starts_with("#EXT-X-KEY") && !line.contains("METHOD=NONE") {
                return Err(anyhow::anyhow!("Encrypted HLS downloads are not supported yet"));
            }

            if line.starts_with("#EXT-X-STREAM-INF") {
                pending_variant_height = Some(Self::hls_variant_height(line));
                continue;
            }

            if let Some(height) = pending_variant_height.take() {
                if line.starts_with('#') {
                    pending_variant_height = Some(height);
                    continue;
                }
                variants.push((height, Self::absolutize_hls_uri(line, base_url)?));
                continue;
            }

            if line.starts_with("#EXTINF:") {
                pending_duration = line
                    .trim_start_matches("#EXTINF:")
                    .split(',')
                    .next()
                    .and_then(|value| value.parse::<f32>().ok());
                continue;
            }

            if line.starts_with("#EXT-X-MAP") {
                if let Some(uri) = Self::parse_hls_attribute(line, "URI") {
                    segments.push(HlsSegment {
                        url: Self::absolutize_hls_uri(&uri, base_url)?,
                        duration: None,
                        is_map: true,
                    });
                }
                continue;
            }

            if !line.starts_with('#') {
                segments.push(HlsSegment {
                    url: Self::absolutize_hls_uri(line, base_url)?,
                    duration: pending_duration.take(),
                    is_map: false,
                });
            }
        }

        Ok((variants, segments))
    }

    async fn fetch_hls_text(client: &reqwest::Client, url: &str, referrer: &str) -> Result<String> {
        let response = client
            .get(url)
            .header("User-Agent", "Mozilla/5.0")
            .header("Referer", referrer)
            .header("Origin", crate::video_server::origin_from_referrer(referrer))
            .send()
            .await
            .context("Failed to fetch HLS playlist")?
            .error_for_status()
            .context("HLS playlist request failed")?;

        response.text().await.context("Failed to read HLS playlist")
    }

    /// Returns (video segments, audio segments). The audio list is empty for muxed streams.
    /// A `#otaku-audio=<encoded url>` fragment on `url` names the audio playlist when the
    /// caller already resolved a video-only variant.
    async fn resolve_hls_segments(
        client: &reqwest::Client,
        url: &str,
        referrer: &str,
    ) -> Result<(Vec<HlsSegment>, Vec<HlsSegment>)> {
        let (url, frag) = url.split_once("#otaku-audio=").unwrap_or((url, ""));
        let mut audio_url = urlencoding::decode(frag).ok().map(|v| v.into_owned()).filter(|v| !v.is_empty());
        let mut playlist_url = url.to_string();

        for _ in 0..4 {
            let text = Self::fetch_hls_text(client, &playlist_url, referrer).await?;
            let (variants, segments) = Self::parse_hls_playlist(&text, &playlist_url)?;

            if !segments.is_empty() {
                let mut audio = Vec::new();
                if let Some(audio_url) = audio_url {
                    let text = Self::fetch_hls_text(client, &audio_url, referrer).await?;
                    audio = Self::parse_hls_playlist(&text, &audio_url)?.1;
                }
                return Ok((segments, audio));
            }

            if let Some((_, next_url)) = variants.into_iter().max_by_key(|(height, _)| *height) {
                audio_url = audio_url.or_else(|| Self::parse_hls_audio_uri(&text, &playlist_url));
                playlist_url = next_url;
                continue;
            }

            return Err(anyhow::anyhow!("HLS playlist did not contain media segments"));
        }

        Err(anyhow::anyhow!("HLS playlist nesting is too deep"))
    }

    fn normalize_hls_segment(bytes: Vec<u8>) -> Vec<u8> {
        if bytes.first() == Some(&0x47) {
            return bytes;
        }

        const PNG_SIGNATURE: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        if !bytes.starts_with(PNG_SIGNATURE) {
            return bytes;
        }

        match bytes[PNG_SIGNATURE.len()..].iter().position(|byte| *byte == 0x47) {
            Some(relative_offset) => {
                let offset = PNG_SIGNATURE.len() + relative_offset;
                bytes[offset..].to_vec()
            }
            None => bytes,
        }
    }

    fn sidecar_label(label: Option<&str>, language: Option<&str>) -> String {
        let raw = label
            .filter(|value| !value.trim().is_empty())
            .or_else(|| language.filter(|value| !value.trim().is_empty()))
            .unwrap_or("subtitles");
        let sanitized: String = raw
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
            .collect();
        let trimmed = sanitized.trim_matches('_');
        if trimmed.is_empty() {
            "subtitles".to_string()
        } else {
            trimmed.to_string()
        }
    }

    fn subtitle_sidecar_path(file_path: &str, label: Option<&str>, language: Option<&str>) -> PathBuf {
        let path = PathBuf::from(file_path);
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("subtitle");
        let filename = format!("{}.{}.vtt", stem, Self::sidecar_label(label, language));
        path.with_file_name(filename)
    }

    async fn download_subtitle_sidecar(
        client: &reqwest::Client,
        subtitle_url: Option<&str>,
        subtitle_label: Option<&str>,
        subtitle_language: Option<&str>,
        referrer: &str,
        file_path: &str,
    ) -> Result<()> {
        let Some(subtitle_url) = subtitle_url.filter(|url| !url.trim().is_empty()) else {
            return Ok(());
        };

        let response = client
            .get(subtitle_url)
            .header("User-Agent", "Mozilla/5.0")
            .header("Referer", referrer)
            .header("Origin", crate::video_server::origin_from_referrer(referrer))
            .send()
            .await
            .context("Failed to fetch subtitle")?
            .error_for_status()
            .context("Subtitle request failed")?;

        let sidecar_path = Self::subtitle_sidecar_path(file_path, subtitle_label, subtitle_language);
        let bytes = response.bytes().await.context("Failed to read subtitle")?;
        tokio::fs::write(&sidecar_path, bytes)
            .await
            .with_context(|| format!("Failed to write subtitle sidecar: {}", sidecar_path.display()))?;
        Ok(())
    }

    async fn remove_subtitle_sidecars(file_path: &str) {
        let path = PathBuf::from(file_path);
        let Some(dir) = path.parent() else {
            return;
        };
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            return;
        };
        let prefix = format!("{}.", stem);
        let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
            return;
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let entry_path = entry.path();
            let Some(name) = entry_path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if name.starts_with(&prefix) && name.ends_with(".vtt") {
                tokio::fs::remove_file(entry_path).await.ok();
            }
        }
    }

    fn hls_segment_dir(file_path: &str) -> Option<PathBuf> {
        let path = PathBuf::from(file_path);
        let dir = path.parent()?;
        let stem = path.file_stem().and_then(|value| value.to_str())?;
        Some(dir.join(format!("{}_segments", stem)))
    }

    async fn downloaded_file_size(file_path: &str) -> Result<u64> {
        let mut size = tokio::fs::metadata(file_path).await?.len();

        if let Some(dir) = Self::hls_segment_dir(file_path) {
            if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
                while let Some(entry) = entries.next_entry().await? {
                    let metadata = entry.metadata().await?;
                    if metadata.is_file() {
                        size += metadata.len();
                    }
                }
            }
        }

        Ok(size)
    }

    fn sum_hls_content_lengths<I>(lengths: I) -> Option<u64>
    where
        I: IntoIterator<Item = Option<u64>>,
    {
        let mut total = 0;
        for length in lengths {
            total += length?;
        }
        Some(total)
    }

    fn infer_hls_total_bytes(
        downloaded: u64,
        completed_segments: usize,
        total_segments: usize,
    ) -> Option<u64> {
        if downloaded == 0 || completed_segments == 0 || total_segments == 0 {
            return None;
        }
        let total = (downloaded as u128 * total_segments as u128)
            .div_ceil(completed_segments as u128);
        Some(total.min(u64::MAX as u128) as u64)
    }

    async fn estimate_hls_total_bytes(
        client: &reqwest::Client,
        segments: &[HlsSegment],
        referrer: &str,
    ) -> Option<u64> {
        use futures_util::{stream, StreamExt};

        // HEAD-ing every segment (hundreds, 24 at a time) gets CDNs like KAA's to answer
        // 429 and then refuse the download itself. Sample a few evenly spaced segments
        // and extrapolate instead.
        // ponytail: average-based estimate; progress corrects itself as bytes arrive.
        const SAMPLES: usize = 6;
        const HEAD_CONCURRENCY: usize = 2;
        let step = segments.len().div_ceil(SAMPLES).max(1);
        let urls = segments
            .iter()
            .step_by(step)
            .map(|segment| segment.url.clone())
            .collect::<Vec<_>>();
        let sampled = urls.len();
        let lengths: Vec<Option<u64>> = stream::iter(urls.into_iter().map(|url| {
            let client = client.clone();
            let referrer = referrer.to_string();
            async move {
                client
                    .head(&url)
                    .header("User-Agent", "Mozilla/5.0")
                    .header("Referer", &referrer)
                    .header("Origin", crate::video_server::origin_from_referrer(&referrer))
                    .send()
                    .await
                    .ok()?
                    .error_for_status()
                    .ok()?
                    .content_length()
            }
        }))
        .buffer_unordered(HEAD_CONCURRENCY)
        .collect()
        .await;

        let sum = Self::sum_hls_content_lengths(lengths)?;
        if sampled == segments.len() {
            return Some(sum);
        }
        Some(sum / sampled as u64 * segments.len() as u64)
    }

    /// GET a segment, backing off on 429/503 (honours Retry-After, capped at 30s).
    async fn fetch_hls_segment(
        client: &reqwest::Client,
        url: &str,
        referrer: &str,
    ) -> Result<reqwest::Response> {
        const MAX_TRIES: u32 = 6;
        let mut attempt = 0;
        loop {
            attempt += 1;
            let response = client
                .get(url)
                .header("User-Agent", "Mozilla/5.0")
                .header("Referer", referrer)
                .header("Origin", crate::video_server::origin_from_referrer(referrer))
                .send()
                .await?;
            let status = response.status();
            let throttled = status == reqwest::StatusCode::TOO_MANY_REQUESTS
                || status == reqwest::StatusCode::SERVICE_UNAVAILABLE;
            if !throttled || attempt >= MAX_TRIES {
                return Ok(response);
            }
            let wait = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<u64>().ok())
                .unwrap_or(1u64 << attempt)
                .min(30);
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
        }
    }

    async fn remove_hls_segments(file_path: &str) {
        if let Some(dir) = Self::hls_segment_dir(file_path) {
            tokio::fs::remove_dir_all(dir).await.ok();
        }
    }

    fn local_segment_name(index: usize, is_map: bool, source_url: &str) -> String {
        let extension = source_url
            .split('?')
            .next()
            .and_then(|value| value.rsplit('.').next())
            .filter(|value| value.len() <= 5 && value.chars().all(|ch| ch.is_ascii_alphanumeric()))
            .unwrap_or(if is_map { "mp4" } else { "ts" });
        if is_map {
            format!("init_{:05}.{}", index, extension)
        } else {
            format!("segment_{:05}.{}", index, extension)
        }
    }

    async fn hls_resume_state(
        segment_dir: &Path,
        segment_names: &[String],
        segments: &[HlsSegment],
    ) -> Result<HlsResumeState> {
        let mut state = HlsResumeState::default();

        for (index, (segment, name)) in segments.iter().zip(segment_names).enumerate() {
            let path = segment_dir.join(name);
            let Ok(metadata) = tokio::fs::metadata(path).await else {
                break;
            };
            if !metadata.is_file() || metadata.len() == 0 {
                break;
            }

            let size = metadata.len();
            state.downloaded += size;
            state.next_index = index + 1;
            if segment.is_map {
                state.map_bytes += size;
            } else {
                state.media_bytes += size;
                state.completed_media_segments += 1;
            }
        }

        Ok(state)
    }

    async fn write_local_hls_playlist(
        playlist_path: &str,
        segments: &[HlsSegment],
        segment_names: &[String],
        uri_prefix: &str,
    ) -> Result<()> {
        let max_duration = segments
            .iter()
            .filter_map(|segment| segment.duration)
            .fold(6.0f32, f32::max)
            .ceil() as u32;
        let mut playlist = String::from("#EXTM3U\n#EXT-X-VERSION:3\n");
        playlist.push_str(&format!("#EXT-X-TARGETDURATION:{}\n#EXT-X-MEDIA-SEQUENCE:0\n", max_duration));

        for (segment, name) in segments.iter().zip(segment_names.iter()) {
            let uri = format!("{}{}", uri_prefix, name);
            if segment.is_map {
                playlist.push_str(&format!("#EXT-X-MAP:URI=\"{}\"\n", uri));
                continue;
            }
            playlist.push_str(&format!("#EXTINF:{:.3},\n{}\n", segment.duration.unwrap_or(6.0), uri));
        }

        playlist.push_str("#EXT-X-ENDLIST\n");
        tokio::fs::write(playlist_path, playlist)
            .await
            .with_context(|| format!("Failed to write HLS playlist: {}", playlist_path))?;
        Ok(())
    }

    pub async fn downloaded_subtitles_for_file(
        file_path: String,
        port: u16,
        token: String,
    ) -> Vec<Subtitle> {
        let path = PathBuf::from(&file_path);
        let Some(dir) = path.parent() else {
            return Vec::new();
        };
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            return Vec::new();
        };
        let prefix = format!("{}.", stem);
        let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
            return Vec::new();
        };
        let mut out = Vec::new();

        while let Ok(Some(entry)) = entries.next_entry().await {
            let entry_path = entry.path();
            let Some(name) = entry_path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !name.starts_with(&prefix) || !name.ends_with(".vtt") {
                continue;
            }
            let label = name
                .trim_start_matches(&prefix)
                .trim_end_matches(".vtt")
                .replace('_', " ");
            out.push(Subtitle {
                url: format!(
                    "http://127.0.0.1:{}/absolute?path={}&token={}",
                    port,
                    urlencoding::encode(&entry_path.to_string_lossy()),
                    token
                ),
                language: label.clone(),
                label,
            });
        }

        out
    }

    async fn perform_hls_download(
        download_id: String,
        downloads: Arc<RwLock<HashMap<String, DownloadProgress>>>,
        db_pool: Option<Arc<SqlitePool>>,
        app_handle: Option<AppHandle>,
        client: reqwest::Client,
        url: String,
        referrer: String,
        file_path: String,
        subtitle_url: Option<String>,
        subtitle_label: Option<String>,
        subtitle_language: Option<String>,
    ) -> Result<()> {
        let (video_segments, audio_segments) = Self::resolve_hls_segments(&client, &url, &referrer).await?;
        let video_len = video_segments.len();
        let mut segments = video_segments;
        segments.extend(audio_segments);
        if segments.is_empty() {
            return Err(anyhow::anyhow!("HLS playlist did not contain media segments"));
        }
        let estimated_total = Self::estimate_hls_total_bytes(&client, &segments, &referrer)
            .await
            .unwrap_or(0);
        let total_media_segments = segments.iter().filter(|segment| !segment.is_map).count();
        let segment_dir = Self::hls_segment_dir(&file_path)
            .context("Failed to derive HLS segment directory")?;
        tokio::fs::create_dir_all(&segment_dir)
            .await
            .context("Failed to create HLS segment directory")?;
        let segment_names: Vec<String> = segments
            .iter()
            .enumerate()
            .map(|(index, segment)| Self::local_segment_name(index, segment.is_map, &segment.url))
            .collect();
        let resume_state = Self::hls_resume_state(&segment_dir, &segment_names, &segments)
            .await
            .context("Failed to inspect HLS resume state")?;
        let mut downloaded = resume_state.downloaded;
        let mut downloaded_map_bytes = resume_state.map_bytes;
        let mut downloaded_media_bytes = resume_state.media_bytes;
        let mut completed_media_segments = resume_state.completed_media_segments;
        let mut fallback_total = if estimated_total == 0 {
            Self::infer_hls_total_bytes(
                downloaded_media_bytes,
                completed_media_segments,
                total_media_segments,
            )
            .map(|media_total| media_total.saturating_add(downloaded_map_bytes))
            .unwrap_or(0)
        } else {
            0
        };
        let initial_total = if estimated_total > 0 {
            estimated_total
        } else {
            fallback_total
        };
        let initial_percentage = if estimated_total > 0 {
            ((downloaded as f32 / estimated_total as f32) * 100.0).min(99.9)
        } else {
            ((resume_state.next_index as f32 / segments.len() as f32) * 100.0).min(99.9)
        };

        let initial_progress = {
            let mut downloads_map = downloads.write().await;
            if let Some(progress) = downloads_map.get_mut(&download_id) {
                progress.downloaded_bytes = downloaded;
                progress.total_bytes = if initial_total > 0 {
                    initial_total.max(downloaded)
                } else {
                    downloaded
                };
                progress.percentage = initial_percentage;
                progress.speed = 0;
                Some(progress.clone())
            } else {
                None
            }
        };
        if let Some(progress) = initial_progress {
            if let Some(ref handle) = app_handle {
                let _ = handle.emit(DOWNLOAD_PROGRESS_EVENT, progress.clone());
            }
            if let Some(pool) = &db_pool {
                Self::save_progress_to_db(pool, &progress).await.ok();
            }
        }

        let start_time = std::time::Instant::now();
        let session_start_downloaded = downloaded;
        let mut last_event_time = std::time::Instant::now();
        let mut last_db_save = downloaded;
        const DB_SAVE_INTERVAL: u64 = 5 * 1024 * 1024;
        const EVENT_THROTTLE_MS: u128 = 500;

        for (index, segment) in segments.iter().enumerate().skip(resume_state.next_index) {
            {
                let downloads_map = downloads.read().await;
                if let Some(progress) = downloads_map.get(&download_id) {
                    if progress.status == DownloadStatus::Cancelled {
                        tokio::fs::remove_file(&file_path).await.ok();
                        tokio::fs::remove_dir_all(&segment_dir).await.ok();
                        return Err(anyhow::anyhow!("Download cancelled"));
                    }
                    if progress.status == DownloadStatus::Paused {
                        return Err(anyhow::anyhow!("Download paused"));
                    }
                }
            }

            let response = Self::fetch_hls_segment(&client, &segment.url, &referrer)
                .await
                .with_context(|| format!("Failed to fetch HLS segment {}", index + 1))?;
            let status = response.status();
            if !status.is_success() {
                anyhow::bail!(
                    "HLS segment {} request failed: HTTP {} from {}",
                    index + 1,
                    status.as_u16(),
                    reqwest::Url::parse(&segment.url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default()
                );
            }

            let data = Self::normalize_hls_segment(
                response
                    .bytes()
                    .await
                    .with_context(|| format!("Failed to read HLS segment {}", index + 1))?
                    .to_vec(),
            );

            let write_len = data.len() as u64;
            let segment_path = segment_dir.join(&segment_names[index]);
            tokio::fs::write(&segment_path, &data)
                .await
                .with_context(|| format!("Failed to write HLS segment {}", index + 1))?;
            downloaded += write_len;
            if segment.is_map {
                downloaded_map_bytes += write_len;
            } else {
                downloaded_media_bytes += write_len;
                completed_media_segments += 1;
                if estimated_total == 0 && fallback_total == 0 {
                    fallback_total = Self::infer_hls_total_bytes(
                        downloaded_media_bytes,
                        completed_media_segments,
                        total_media_segments,
                    )
                    .map(|media_total| media_total.saturating_add(downloaded_map_bytes))
                    .unwrap_or(0);
                }
            }

            let elapsed = start_time.elapsed().as_secs();
            let speed = if elapsed > 0 {
                (downloaded - session_start_downloaded) / elapsed
            } else {
                0
            };
            let total_bytes = if estimated_total > 0 {
                estimated_total
            } else {
                fallback_total
            };
            let percentage = if estimated_total > 0 {
                ((downloaded as f32 / estimated_total as f32) * 100.0).min(99.9)
            } else {
                ((index + 1) as f32 / segments.len() as f32) * 100.0
            };
            let should_save_db = downloaded - last_db_save >= DB_SAVE_INTERVAL;
            let should_emit_event = last_event_time.elapsed().as_millis() >= EVENT_THROTTLE_MS;

            let progress_snapshot = {
                let mut downloads_map = downloads.write().await;
                downloads_map.get_mut(&download_id).map(|progress| {
                    progress.downloaded_bytes = downloaded;
                    progress.total_bytes = if total_bytes > 0 {
                        total_bytes.max(downloaded)
                    } else {
                        downloaded
                    };
                    progress.percentage = percentage;
                    progress.speed = speed;
                    progress.clone()
                })
            };

            if let Some(progress) = progress_snapshot {
                if should_emit_event {
                    if let Some(ref handle) = app_handle {
                        let _ = handle.emit(DOWNLOAD_PROGRESS_EVENT, progress.clone());
                    }
                    last_event_time = std::time::Instant::now();
                }

                if should_save_db {
                    if let Some(pool) = &db_pool {
                        Self::save_progress_to_db(pool, &progress).await.ok();
                    }
                    last_db_save = downloaded;
                }
            }
        }

        if segments.len() == video_len {
            let dir_name = segment_dir.file_name().map(|v| v.to_string_lossy().to_string()).unwrap_or_default();
            Self::write_local_hls_playlist(&file_path, &segments, &segment_names, &format!("{}/", dir_name)).await?;
        } else {
            // Video-only variant + separate audio rendition: master at file_path points at both.
            let video_pl = segment_dir.join("video.m3u8");
            let audio_pl = segment_dir.join("audio.m3u8");
            Self::write_local_hls_playlist(&video_pl.to_string_lossy(), &segments[..video_len], &segment_names[..video_len], "").await?;
            Self::write_local_hls_playlist(&audio_pl.to_string_lossy(), &segments[video_len..], &segment_names[video_len..], "").await?;
            let dir_name = segment_dir.file_name().map(|v| v.to_string_lossy().to_string()).unwrap_or_default();
            let master = format!(
                r#"#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="{d}/audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="a"
{d}/video.m3u8
"#,
                d = dir_name
            );
            tokio::fs::write(&file_path, master).await.context("Failed to write HLS master playlist")?;
        }
        Self::download_subtitle_sidecar(
            &client,
            subtitle_url.as_deref(),
            subtitle_label.as_deref(),
            subtitle_language.as_deref(),
            &referrer,
            &file_path,
        )
        .await?;
        Ok(())
    }

    /// Perform the actual download
    async fn perform_download(
        download_id: String,
        downloads: Arc<RwLock<HashMap<String, DownloadProgress>>>,
        db_pool: Option<Arc<SqlitePool>>,
        app_handle: Option<AppHandle>,
    ) -> Result<()> {
        // Get download info, check if cancelled, and get resume offset
        let (
            url,
            source_referrer,
            subtitle_url,
            subtitle_label,
            subtitle_language,
            file_path,
            resume_from,
            existing_total,
        ) = {
            let downloads_map = downloads.read().await;
            let progress = downloads_map
                .get(&download_id)
                .context("Download not found")?;

            // Check if cancelled before starting HTTP request
            if progress.status == DownloadStatus::Cancelled {
                return Err(anyhow::anyhow!("Download was cancelled"));
            }

            (
                progress.url.clone(),
                progress.source_referrer.clone(),
                progress.subtitle_url.clone(),
                progress.subtitle_label.clone(),
                progress.subtitle_language.clone(),
                progress.file_path.clone(),
                progress.downloaded_bytes,
                progress.total_bytes,
            )
        };

        // Check if file exists and has expected size for resume
        let actual_file_size = tokio::fs::metadata(&file_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);

        // Only resume if file exists and has the expected bytes
        let resume_offset = if actual_file_size > 0 && actual_file_size == resume_from {
            resume_from
        } else {
            0 // Start fresh if file doesn't match
        };

        // Make HTTP request with appropriate timeouts for large files
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            // No read timeout - large files can take a long time to download
            // Progress tracking handles stalls via cancellation
            .build()
            .context("Failed to create HTTP client")?;

        let referrer = source_referrer.as_deref().unwrap_or("https://allmanga.to");
        if Self::is_hls_url(&url) {
            return Self::perform_hls_download(
                download_id,
                downloads,
                db_pool,
                app_handle,
                client,
                url,
                referrer.to_string(),
                file_path,
                subtitle_url,
                subtitle_label,
                subtitle_language,
            )
            .await;
        }

        let mut request = client
            .get(&url)
            .header("User-Agent", "Mozilla/5.0")
            .header("Referer", referrer)
            .header("Origin", crate::video_server::origin_from_referrer(referrer));

        // Add Range header for resume
        if resume_offset > 0 {
            request = request.header("Range", format!("bytes={}-", resume_offset));
            log::debug!("Resuming download from byte {}", resume_offset);
        }

        let response = request
            .send()
            .await
            .context("Failed to initiate download")?;

        // Check response status - 206 Partial Content for resume, 200 for fresh start
        let is_resume = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;

        // Get total bytes from Content-Length or Content-Range
        let total_bytes = if is_resume {
            // For resumed downloads, try to get total from Content-Range header
            // Format: "bytes start-end/total"
            response
                .headers()
                .get("content-range")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.split('/').last())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(existing_total)
        } else {
            response.content_length().unwrap_or(0)
        };

        // Update total bytes
        {
            let mut downloads_map = downloads.write().await;
            if let Some(progress) = downloads_map.get_mut(&download_id) {
                if total_bytes > 0 {
                    progress.total_bytes = total_bytes;
                }
            }
        }

        // Open file - append if resuming, create if fresh
        let mut file = if is_resume && resume_offset > 0 {
            tokio::fs::OpenOptions::new()
                .append(true)
                .open(&file_path)
                .await
                .context("Failed to open file for resume")?
        } else {
            // Fresh start - reset downloaded bytes
            {
                let mut downloads_map = downloads.write().await;
                if let Some(progress) = downloads_map.get_mut(&download_id) {
                    progress.downloaded_bytes = 0;
                }
            }
            File::create(&file_path)
                .await
                .context("Failed to create file")?
        };

        // Determine if this file should be XOR-obfuscated (based on .otaku extension)
        let is_obfuscated = file_path.ends_with(".otaku");

        // Download in chunks
        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = if is_resume { resume_offset } else { 0 };
        let start_time = std::time::Instant::now();
        let session_downloaded: u64 = 0; // Track bytes downloaded this session for speed calc
        let mut last_db_save: u64 = downloaded;
        let mut last_event_time = std::time::Instant::now();
        const DB_SAVE_INTERVAL: u64 = 5 * 1024 * 1024; // Save to DB every 5MB
        const EVENT_THROTTLE_MS: u128 = 500; // Emit events at most every 500ms

        use futures_util::StreamExt;

        while let Some(chunk) = stream.next().await {
            // Check if cancelled or paused
            {
                let downloads_map = downloads.read().await;
                if let Some(progress) = downloads_map.get(&download_id) {
                    if progress.status == DownloadStatus::Cancelled {
                        // Delete partial file
                        tokio::fs::remove_file(&file_path).await.ok();
                        return Err(anyhow::anyhow!("Download cancelled"));
                    }
                    if progress.status == DownloadStatus::Paused {
                        // Flush and return - don't delete file, keep progress
                        file.flush().await.ok();
                        log::debug!("Download paused at {} bytes", downloaded);
                        return Err(anyhow::anyhow!("Download paused"));
                    }
                }
            }

            let chunk = chunk.context("Failed to read chunk")?;

            // XOR-obfuscate the chunk before writing to disk
            if is_obfuscated {
                let mut chunk_data = chunk.to_vec();
                obfuscation::xor_transform(&mut chunk_data, downloaded);
                file.write_all(&chunk_data).await.context("Failed to write chunk")?;
            } else {
                file.write_all(&chunk).await.context("Failed to write chunk")?;
            }
            downloaded += chunk.len() as u64;

            // Calculate speed based on this session's download
            let elapsed = start_time.elapsed().as_secs();
            let session_bytes = downloaded - (if is_resume { resume_offset } else { 0 });
            let speed = if elapsed > 0 {
                session_bytes / elapsed
            } else {
                session_downloaded
            };

            // Update progress
            let should_save_db = downloaded - last_db_save >= DB_SAVE_INTERVAL;
            let should_emit_event = last_event_time.elapsed().as_millis() >= EVENT_THROTTLE_MS;
            {
                let mut downloads_map = downloads.write().await;
                if let Some(progress) = downloads_map.get_mut(&download_id) {
                    progress.downloaded_bytes = downloaded;
                    progress.speed = speed;
                    if total_bytes > 0 {
                        progress.percentage = (downloaded as f32 / total_bytes as f32) * 100.0;
                    }

                    // Emit progress event (throttled)
                    if should_emit_event {
                        if let Some(ref handle) = app_handle {
                            let _ = handle.emit(DOWNLOAD_PROGRESS_EVENT, progress.clone());
                        }
                        last_event_time = std::time::Instant::now();
                    }

                    // Periodically save to database
                    if should_save_db {
                        if let Some(pool) = &db_pool {
                            Self::save_progress_to_db(pool, progress).await.ok();
                            last_db_save = downloaded;
                        }
                    }
                }
            }
        }

        file.flush().await.context("Failed to flush file")?;
        Self::download_subtitle_sidecar(
            &client,
            subtitle_url.as_deref(),
            subtitle_label.as_deref(),
            subtitle_language.as_deref(),
            referrer,
            &file_path,
        )
        .await?;

        Ok(())
    }

    /// Get progress for a specific download
    pub async fn get_progress(&self, download_id: &str) -> Option<DownloadProgress> {
        let downloads = self.downloads.read().await;
        downloads.get(download_id).cloned()
    }

    /// Get all downloads
    pub async fn list_downloads(&self) -> Vec<DownloadProgress> {
        let downloads = self.downloads.read().await;
        downloads.values().cloned().collect()
    }

    /// Cancel a download
    pub async fn cancel_download(&self, download_id: &str) -> Result<()> {
        {
            let mut downloads = self.downloads.write().await;
            if let Some(progress) = downloads.get_mut(download_id) {
                progress.status = DownloadStatus::Cancelled;
                log::debug!("Cancelled download: {}", download_id);

                // Emit event
                self.emit_progress(progress);

                // Save to database
                self.save_to_database(progress).await.ok();
            }
        }

        // Update tray count after cancellation
        if let (Some(ref handle), Some(ref pool)) = (&self.app_handle, &self.db_pool) {
            let active = total_active_downloads(&self.downloads, pool.as_ref()).await;
            crate::tray::update_downloads_count(handle, active);
        }

        Ok(())
    }

    /// Pause a download
    pub async fn pause_download(&self, download_id: &str) -> Result<()> {
        {
            let mut downloads = self.downloads.write().await;
            if let Some(progress) = downloads.get_mut(download_id) {
                // Only pause if currently downloading or queued
                if progress.status == DownloadStatus::Downloading || progress.status == DownloadStatus::Queued {
                    progress.status = DownloadStatus::Paused;
                    progress.speed = 0; // Reset speed since we're paused
                    log::debug!("Paused download: {} at {} bytes", download_id, progress.downloaded_bytes);

                    // Emit event
                    self.emit_progress(progress);

                    // Save to database
                    self.save_to_database(progress).await.ok();
                }
            }
        }

        // Update tray count after pause (Downloading → Paused decreases active count)
        if let (Some(ref handle), Some(ref pool)) = (&self.app_handle, &self.db_pool) {
            let active = total_active_downloads(&self.downloads, pool.as_ref()).await;
            crate::tray::update_downloads_count(handle, active);
        }

        Ok(())
    }

    /// Resume a paused download
    pub async fn resume_download(&self, download_id: &str) -> Result<()> {
        // Get the download info
        let download_info = {
            let downloads = self.downloads.read().await;
            downloads.get(download_id).cloned()
        };

        if let Some(progress) = download_info {
            // Only resume if paused or failed
            if progress.status == DownloadStatus::Paused || progress.status == DownloadStatus::Failed {
                // Update status to queued
                {
                    let mut downloads = self.downloads.write().await;
                    if let Some(p) = downloads.get_mut(download_id) {
                        p.status = DownloadStatus::Queued;
                        p.error_message = None; // Clear any previous error
                        self.emit_progress(p);
                        self.save_to_database(p).await.ok();
                    }
                }

                log::debug!("Resuming download: {} from {} bytes", download_id, progress.downloaded_bytes);

                // Start the download task (it will resume from downloaded_bytes)
                self.start_download_task(download_id.to_string()).await?;
            }
        }
        Ok(())
    }

    /// Reset a download so it restarts from scratch (status queued, bytes 0, no error).
    fn reset_for_retry(p: &mut DownloadProgress) {
        p.status = DownloadStatus::Queued;
        p.downloaded_bytes = 0;
        p.total_bytes = 0;
        p.percentage = 0.0;
        p.speed = 0;
        p.error_message = None;
    }

    /// Retry a failed/cancelled download from zero: drop partial files, reset, re-queue.
    /// URL (incl. any `#otaku-audio=` fragment) and file path are kept untouched.
    pub async fn retry_download(&self, download_id: &str) -> Result<()> {
        let path = {
            let downloads = self.downloads.read().await;
            match downloads.get(download_id) {
                Some(d) if matches!(d.status, DownloadStatus::Failed | DownloadStatus::Cancelled) => d.file_path.clone(),
                Some(_) => return Ok(()),
                None => anyhow::bail!("Download not found: {}", download_id),
            }
        };
        tokio::fs::remove_file(&path).await.ok();
        Self::remove_hls_segments(&path).await;
        {
            let mut downloads = self.downloads.write().await;
            if let Some(p) = downloads.get_mut(download_id) {
                Self::reset_for_retry(p);
                self.emit_progress(p);
                self.save_to_database(p).await.ok();
            }
        }
        self.start_download_task(download_id.to_string()).await
    }

    /// Free bytes on the filesystem holding the downloads directory.
    #[cfg(unix)]
    pub fn free_space(&self) -> u64 {
        use std::os::unix::ffi::OsStrExt;
        let Ok(c) = std::ffi::CString::new(self.download_dir.as_os_str().as_bytes()) else { return 0 };
        let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
            return 0;
        }
        (st.f_bavail as u64).saturating_mul(st.f_frsize as u64)
    }

    #[cfg(not(unix))]
    pub fn free_space(&self) -> u64 {
        0
    }

    /// Remove completed/failed download from list
    pub async fn remove_download(&self, download_id: &str) -> Result<()> {
        // Delete from database
        self.delete_from_database(download_id).await?;

        let mut downloads = self.downloads.write().await;
        downloads.remove(download_id);
        log::debug!("Removed download from list: {}", download_id);
        Ok(())
    }

    /// Check if an episode is downloaded and completed
    pub async fn is_episode_downloaded(&self, media_id: &str, episode_number: i32) -> bool {
        let downloads = self.downloads.read().await;

        // Check all downloads for matching media_id and episode_number
        downloads.values().any(|d| {
            d.media_id == media_id
                && d.episode_number == episode_number
                && d.status == DownloadStatus::Completed
        })
    }

    /// Get the file path for a downloaded episode
    pub async fn get_episode_file_path(&self, media_id: &str, episode_number: i32) -> Option<String> {
        let downloads = self.downloads.read().await;

        downloads.values()
            .find(|d| {
                d.media_id == media_id
                    && d.episode_number == episode_number
                    && d.status == DownloadStatus::Completed
            })
            .map(|d| d.file_path.clone())
    }

    /// Get total storage used by downloads in bytes
    pub async fn get_total_storage_used(&self) -> u64 {
        let downloads = self.downloads.read().await;

        downloads.values()
            .filter(|d| d.status == DownloadStatus::Completed)
            .map(|d| d.total_bytes)
            .sum()
    }

    /// Remove every download with `status` from memory AND the database.
    /// The DB is filtered by status directly so rows missing from the
    /// in-memory map (or failing individually) cannot survive a clear.
    async fn clear_by_status(&self, status: DownloadStatus, db_status: &str) -> Result<()> {
        if let Some(pool) = &self.db_pool {
            sqlx::query("DELETE FROM downloads WHERE status = ?")
                .bind(db_status)
                .execute(pool.as_ref())
                .await
                .context("Failed to clear downloads from database")?;
        }
        let mut downloads = self.downloads.write().await;
        downloads.retain(|_, d| d.status != status);
        Ok(())
    }

    /// Clear completed downloads from list (doesn't delete files)
    pub async fn clear_completed(&self) -> Result<()> {
        self.clear_by_status(DownloadStatus::Completed, "completed").await
    }

    /// Clear failed downloads from list
    pub async fn clear_failed(&self) -> Result<()> {
        self.clear_by_status(DownloadStatus::Failed, "failed").await
    }

    /// Clear cancelled downloads from list
    pub async fn clear_cancelled(&self) -> Result<()> {
        self.clear_by_status(DownloadStatus::Cancelled, "cancelled").await
    }

    /// Delete a downloaded file and remove from list
    pub async fn delete_download(&self, download_id: &str) -> Result<()> {
        let file_path = {
            let downloads = self.downloads.read().await;
            downloads.get(download_id)
                .map(|d| d.file_path.clone())
        };

        if let Some(path) = file_path {
            match tokio::fs::remove_file(&path).await {
                Ok(()) => {
                    log::debug!("Deleted file: {}", path);
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    log::debug!("Download file already missing: {}", path);
                }
                Err(e) => {
                    // Never let an undeletable/odd path (directory, perms) strand the row.
                    log::warn!("Could not delete download file {}: {}", path, e);
                }
            }
            Self::remove_subtitle_sidecars(&path).await;
            Self::remove_hls_segments(&path).await;
        }

        // Remove from list and database
        self.remove_download(download_id).await?;

        Ok(())
    }

    /// Delete a downloaded episode by media ID and episode number
    pub async fn delete_episode_download(&self, media_id: &str, episode_number: i32) -> Result<()> {
        // Find the download ID for this episode (any status, not just completed)
        let download_id = {
            let downloads = self.downloads.read().await;
            downloads
                .iter()
                .find(|(_, d)| {
                    d.media_id == media_id
                        && d.episode_number == episode_number
                })
                .map(|(id, _)| id.clone())
        };

        if let Some(id) = download_id {
            self.delete_download(&id).await?;
            log::debug!("Deleted episode download: {} episode {}", media_id, episode_number);
            return Ok(());
        }

        // Fallback: check the database directly (in-memory map may be out of sync)
        if let Some(pool) = &self.db_pool {
            let row = sqlx::query(
                "SELECT id, file_path FROM downloads WHERE media_id = ? AND episode_number = ? LIMIT 1"
            )
            .bind(media_id)
            .bind(episode_number)
            .fetch_optional(pool.as_ref())
            .await?;

            if let Some(row) = row {
                let id: String = row.try_get("id")?;
                let file_path: String = row.try_get("file_path")?;

                // Delete the file if it exists
                if tokio::fs::metadata(&file_path).await.is_ok() {
                    tokio::fs::remove_file(&file_path).await.ok();
                    log::debug!("Deleted file: {}", file_path);
                }
                Self::remove_subtitle_sidecars(&file_path).await;
                Self::remove_hls_segments(&file_path).await;

                // Remove from database
                sqlx::query("DELETE FROM downloads WHERE id = ?")
                    .bind(&id)
                    .execute(pool.as_ref())
                    .await?;

                // Remove from in-memory map
                self.downloads.write().await.remove(&id);

                log::debug!("Deleted episode download from DB fallback: {} episode {}", media_id, episode_number);
                return Ok(());
            }
        }

        anyhow::bail!("Episode download not found")
    }

    /// Get the downloads directory path
    pub fn get_downloads_directory(&self) -> String {
        self.download_dir.to_string_lossy().to_string()
    }

    /// Compute the combined active download count (episodes + chapters) and call
    /// `tray::update_downloads_count`.  Used by the chapter-download module so
    /// that a chapter status transition updates the tray correctly even when
    /// there are concurrent episode downloads (and vice-versa).
    pub(crate) async fn refresh_tray_downloads_count(&self, chapter_pool: &SqlitePool) {
        if let Some(ref handle) = self.app_handle {
            let active = total_active_downloads(&self.downloads, chapter_pool).await;
            crate::tray::update_downloads_count(handle, active);
        }
    }
}

/// Compute the combined active download count across both the episode manager
/// (in-memory map) and the chapter-downloads SQLite table.
///
/// This is the single source of truth used to update the tray badge so that
/// the count is always correct regardless of which side has a status transition.
///
/// `episode_map` is the episode manager's in-memory `downloads` field.
/// `chapter_pool` is the shared SQLite pool; the query is cheap (index on `status`).
pub(crate) async fn total_active_downloads(
    episode_map: &Arc<RwLock<HashMap<String, DownloadProgress>>>,
    chapter_pool: &SqlitePool,
) -> usize {
    let episode_active = {
        let map = episode_map.read().await;
        map.values().filter(|d| d.status == DownloadStatus::Downloading).count()
    };

    let chapter_active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM chapter_downloads WHERE status = 'downloading'"
    )
    .fetch_one(chapter_pool)
    .await
    .unwrap_or(0);

    episode_active + (chapter_active.max(0) as usize)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    fn download_with_path(id: &str, file_path: PathBuf, status: DownloadStatus) -> DownloadProgress {
        DownloadProgress {
            id: id.to_string(),
            media_id: "media-1".to_string(),
            episode_id: "episode-1".to_string(),
            episode_number: 1,
            filename: "Episode_1.otaku".to_string(),
            url: "https://example.test/video.mp4".to_string(),
            file_path: file_path.to_string_lossy().to_string(),
            total_bytes: 100,
            downloaded_bytes: 50,
            percentage: 50.0,
            speed: 0,
            status,
            error_message: None,
            source_referrer: None,
            subtitle_url: None,
            subtitle_label: None,
            subtitle_language: None,
        }
    }

    #[test]
    fn reset_for_retry_clears_progress_and_error_but_keeps_url() {
        let mut p = download_with_path("d", PathBuf::from("/x/a.mp4"), DownloadStatus::Failed);
        p.url = "https://h/a.m3u8#otaku-audio=https://h/a.m4a".into();
        p.downloaded_bytes = 5;
        p.total_bytes = 10;
        p.error_message = Some("boom".into());
        DownloadManager::reset_for_retry(&mut p);
        assert_eq!(p.status, DownloadStatus::Queued);
        assert_eq!((p.downloaded_bytes, p.total_bytes), (0, 0));
        assert!(p.error_message.is_none());
        assert!(p.url.contains("#otaku-audio="));
    }

    #[tokio::test]
    async fn delete_download_removes_record_when_file_is_already_missing() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let missing_file = temp_dir.path().join("missing.otaku");
        let manager = DownloadManager::new(temp_dir.path().to_path_buf());

        manager.downloads.write().await.insert(
            "download-1".to_string(),
            download_with_path("download-1", missing_file, DownloadStatus::Failed),
        );

        let result = manager.delete_download("download-1").await;

        assert!(result.is_ok(), "delete should ignore absent files: {result:?}");
        assert!(manager.get_progress("download-1").await.is_none());
    }

    async fn setup_downloads_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");

        sqlx::query(
            r#"
            CREATE TABLE downloads (
                id TEXT PRIMARY KEY,
                media_id TEXT NOT NULL,
                episode_id TEXT NOT NULL,
                episode_number INTEGER NOT NULL DEFAULT 0,
                filename TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                source_referrer TEXT,
                file_path TEXT NOT NULL,
                total_bytes INTEGER NOT NULL DEFAULT 0,
                downloaded_bytes INTEGER NOT NULL DEFAULT 0,
                percentage REAL NOT NULL DEFAULT 0,
                speed INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'queued',
                error_message TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(media_id, episode_id)
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create downloads");

        pool
    }

    #[tokio::test]
    async fn remove_and_clear_delete_db_rows_even_when_file_missing_or_not_in_memory() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let missing = temp_dir.path().join("gone.otaku").to_string_lossy().to_string();
        let pool = setup_downloads_pool().await;
        for (id, ep, status) in [("d1", "e1", "failed"), ("d2", "e2", "failed")] {
            sqlx::query("INSERT INTO downloads (id, media_id, episode_id, file_path, status) VALUES (?, 'm', ?, ?, ?)")
                .bind(id).bind(ep).bind(&missing).bind(status)
                .execute(&pool).await.expect("insert");
        }
        let manager = DownloadManager::new(temp_dir.path().to_path_buf())
            .with_database(Arc::new(pool.clone()));
        manager.load_from_database().await.expect("load");

        manager.delete_download("d1").await.expect("delete with missing file");
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM downloads WHERE id = 'd1'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(left, 0);

        // d2 dropped from memory only: clear_failed must still purge the DB row.
        manager.downloads.write().await.remove("d2");
        manager.clear_failed().await.expect("clear failed");
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM downloads")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn load_from_database_persists_missing_completed_file_as_failed() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let missing_file = temp_dir.path().join("missing-completed.otaku");
        let pool = setup_downloads_pool().await;

        sqlx::query(
            r#"
            INSERT INTO downloads (
                id, media_id, episode_id, episode_number, filename, url, file_path,
                total_bytes, downloaded_bytes, percentage, speed, status
            )
            VALUES ('download-1', 'media-1', 'episode-1', 1, 'Episode_1.otaku',
                'https://example.test/video.mp4', ?, 100, 100, 100.0, 0, 'completed')
            "#,
        )
        .bind(missing_file.to_string_lossy().to_string())
        .execute(&pool)
        .await
        .expect("insert completed download");

        let manager = DownloadManager::new(temp_dir.path().to_path_buf())
            .with_database(Arc::new(pool.clone()));

        manager.load_from_database().await.expect("load downloads");

        let progress = manager.get_progress("download-1").await.expect("download loaded");
        let persisted_status: String = sqlx::query_scalar(
            "SELECT status FROM downloads WHERE id = 'download-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("persisted status");

        assert_eq!(progress.status, DownloadStatus::Failed);
        assert_eq!(persisted_status, "failed");
    }

    #[tokio::test]
    async fn load_from_database_rebases_paths_from_an_old_app_container() {
        // iOS: the container UUID changes on reinstall; files move with it.
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let downloads_dir = temp_dir.path().join("new-container").join("downloads");
        tokio::fs::create_dir_all(downloads_dir.join("EP1_segments")).await.unwrap();
        tokio::fs::write(downloads_dir.join("EP1.m3u8"), b"#EXTM3U").await.unwrap();
        let old_path = temp_dir.path().join("old-container").join("downloads").join("EP1.m3u8");

        let pool = setup_downloads_pool().await;
        sqlx::query(
            r#"
            INSERT INTO downloads (
                id, media_id, episode_id, episode_number, filename, url, file_path,
                total_bytes, downloaded_bytes, percentage, speed, status, error_message
            )
            VALUES ('d1', 'm', 'e', 1, 'EP1.m3u8', 'https://x.test/m.m3u8', ?, 7, 7, 100.0, 0,
                'failed', 'File not found. Please re-download.')
            "#,
        )
        .bind(old_path.to_string_lossy().to_string())
        .execute(&pool)
        .await
        .unwrap();

        let manager = DownloadManager::new(downloads_dir.clone()).with_database(Arc::new(pool.clone()));
        manager.load_from_database().await.expect("load");

        let p = manager.get_progress("d1").await.expect("loaded");
        let want = downloads_dir.join("EP1.m3u8").to_string_lossy().to_string();
        assert_eq!(p.status, DownloadStatus::Completed);
        assert_eq!(p.file_path, want);
        let (status, path): (String, String) =
            sqlx::query_as("SELECT status, file_path FROM downloads WHERE id = 'd1'")
                .fetch_one(&pool).await.unwrap();
        assert_eq!(status, "completed");
        assert_eq!(path, want);
    }

    #[tokio::test]
    async fn load_from_database_counts_hls_segment_files_for_completed_size() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let playlist = temp_dir.path().join("episode-7.m3u8");
        tokio::fs::write(&playlist, b"playlist").await.expect("playlist");

        let segment_dir = DownloadManager::hls_segment_dir(&playlist.to_string_lossy())
            .expect("segment dir");
        tokio::fs::create_dir_all(&segment_dir).await.expect("segment dir");
        tokio::fs::write(segment_dir.join("segment_00000.ts"), vec![1_u8; 300])
            .await
            .expect("segment 1");
        tokio::fs::write(segment_dir.join("segment_00001.ts"), vec![2_u8; 700])
            .await
            .expect("segment 2");

        let pool = setup_downloads_pool().await;
        sqlx::query(
            r#"
            INSERT INTO downloads (
                id, media_id, episode_id, episode_number, filename, url, file_path,
                total_bytes, downloaded_bytes, percentage, speed, status
            )
            VALUES ('download-1', 'media-1', 'episode-7', 7, 'Episode_7.m3u8',
                'https://example.test/master.m3u8', ?, 8, 8, 100.0, 0, 'completed')
            "#,
        )
        .bind(playlist.to_string_lossy().to_string())
        .execute(&pool)
        .await
        .expect("insert completed hls download");

        let manager = DownloadManager::new(temp_dir.path().to_path_buf())
            .with_database(Arc::new(pool.clone()));

        manager.load_from_database().await.expect("load downloads");

        let progress = manager.get_progress("download-1").await.expect("download loaded");
        let persisted_total: i64 = sqlx::query_scalar(
            "SELECT total_bytes FROM downloads WHERE id = 'download-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("persisted total");

        assert_eq!(progress.total_bytes, 1008);
        assert_eq!(progress.downloaded_bytes, 1008);
        assert_eq!(persisted_total, 1008);
    }

    #[tokio::test]
    async fn hls_resume_state_counts_existing_segments_until_first_gap() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let segment_dir = temp_dir.path();
        let segments = vec![
            HlsSegment { url: "https://example.test/init.mp4".to_string(), duration: None, is_map: true },
            HlsSegment { url: "https://example.test/one.ts".to_string(), duration: Some(6.0), is_map: false },
            HlsSegment { url: "https://example.test/two.ts".to_string(), duration: Some(6.0), is_map: false },
            HlsSegment { url: "https://example.test/three.ts".to_string(), duration: Some(6.0), is_map: false },
        ];
        let names = segments
            .iter()
            .enumerate()
            .map(|(index, segment)| DownloadManager::local_segment_name(index, segment.is_map, &segment.url))
            .collect::<Vec<_>>();

        tokio::fs::write(segment_dir.join(&names[0]), vec![0_u8; 8]).await.expect("init");
        tokio::fs::write(segment_dir.join(&names[1]), vec![1_u8; 300]).await.expect("segment one");
        tokio::fs::write(segment_dir.join(&names[3]), vec![3_u8; 900]).await.expect("later gap segment");

        let state = DownloadManager::hls_resume_state(segment_dir, &names, &segments)
            .await
            .expect("resume state");

        assert_eq!(
            state,
            HlsResumeState {
                downloaded: 308,
                map_bytes: 8,
                media_bytes: 300,
                completed_media_segments: 1,
                next_index: 2,
            }
        );
    }

    #[test]
    fn hls_total_requires_every_segment_length() {
        assert_eq!(
            DownloadManager::sum_hls_content_lengths([Some(300), Some(700), Some(8)]),
            Some(1008)
        );
        assert_eq!(
            DownloadManager::sum_hls_content_lengths([Some(300), None, Some(8)]),
            None
        );
    }

    #[test]
    fn hls_progress_total_estimate_is_pinned_from_downloaded_segments() {
        assert_eq!(
            DownloadManager::infer_hls_total_bytes(117, 23, 100),
            Some(509)
        );
        assert_eq!(DownloadManager::infer_hls_total_bytes(0, 1, 100), None);
        assert_eq!(DownloadManager::infer_hls_total_bytes(117, 0, 100), None);
    }

    #[test]
    fn hls_audio_rendition_is_found_and_scheme_relative_uris_resolve() {
        let master = r#"#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="x",DEFAULT=YES,URI="//cdn.test/a/audio.m3u8"
#EXT-X-STREAM-INF:RESOLUTION=1280x720,AUDIO="a"
v/720.m3u8
"#;
        assert_eq!(
            DownloadManager::parse_hls_audio_uri(master, "https://hls.test/m/master.m3u8").as_deref(),
            Some("https://cdn.test/a/audio.m3u8")
        );
        assert_eq!(DownloadManager::parse_hls_audio_uri("#EXTM3U
", "https://x.test/a.m3u8"), None);
    }

    /// Real KAA episode: master -> video + audio segments, first of each fetchable.
    /// Run: cargo test --lib kaa_network -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn kaa_network_download_resolves_audio() {
        let client = reqwest::Client::new();
        let get = |u: &str| client.get(u.to_string()).header("Referer", "https://kaa.lt/").header("User-Agent", "Mozilla/5.0");
        let eps: serde_json::Value = get("https://kaa.lt/api/show/sousou-no-frieren-2d15/episodes?lang=ja-JP&ep=1")
            .send().await.unwrap().json().await.unwrap();
        let e = &eps["result"][0];
        let ep = format!("ep-{}-{}", e["episode_string"].as_str().unwrap(), e["slug"].as_str().unwrap());
        let data: serde_json::Value = get(&format!("https://kaa.lt/api/show/sousou-no-frieren-2d15/episode/{}", ep))
            .send().await.unwrap().json().await.unwrap();
        let src = data["servers"][0]["src"].as_str().unwrap().to_string();
        let html = get(&src).send().await.unwrap().text().await.unwrap().replace("&quot;", "\"").replace("&amp;", "&");
        let start = html.find(r#""manifest":[0,""#).unwrap() + 15;
        let mut manifest = html[start..start + html[start..].find('"').unwrap()].to_string();
        if manifest.starts_with("//") { manifest = format!("https:{}", manifest); }
        println!("manifest {}", manifest);

        let (video, audio) = DownloadManager::resolve_hls_segments(&client, &manifest, "https://krussdomi.com/").await.unwrap();
        println!("video segs {} audio segs {}", video.len(), audio.len());
        assert!(!video.is_empty());
        assert!(!audio.is_empty(), "audio rendition dropped");
        // Full real path (same client setup as perform_download), first segments only.
        let dir = std::env::temp_dir().join("otaku-kaa-dl-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("t.otaku").to_string_lossy().to_string();
        let downloads = Arc::new(RwLock::new(HashMap::new()));
        let dl_client = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(30)).build().unwrap();
        let res = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            DownloadManager::perform_hls_download(
                "t".into(), downloads, None, None, dl_client, manifest.clone(),
                "https://krussdomi.com/".into(), file, None, None, None,
            ),
        )
        .await;
        match res {
            Err(_) => println!("full path: still downloading after 20s (ok)"),
            Ok(r) => println!("full path result: {:?}", r),
        }
        for seg in [&video[0], &audio[0]] {
            let r = client.get(&seg.url).header("Referer", "https://krussdomi.com/").header("Origin", "https://krussdomi.com").header("User-Agent", "Mozilla/5.0").send().await.unwrap();
            assert!(r.status().is_success(), "{} -> {}", seg.url, r.status());
            let b = DownloadManager::normalize_hls_segment(r.bytes().await.unwrap().to_vec());
            assert_eq!(b[0], 0x47, "not TS");
        }
    }
}
