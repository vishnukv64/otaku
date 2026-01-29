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

use std::path::PathBuf;
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
    pub file_path: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub percentage: f32,
    pub speed: u64, // bytes per second
    pub status: DownloadStatus,
    pub error_message: Option<String>,
}

/// Event name for download progress updates
pub const DOWNLOAD_PROGRESS_EVENT: &str = "download-progress";

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

    /// Load downloads from database on startup
    pub async fn load_from_database(&self) -> Result<()> {
        if let Some(pool) = &self.db_pool {
            let rows = sqlx::query(
                r#"
                SELECT id, media_id, episode_id, episode_number, filename, url, file_path,
                       total_bytes, downloaded_bytes, percentage, speed, status, error_message
                FROM downloads
                "#
            )
            .fetch_all(pool.as_ref())
            .await?;

            let mut downloads = self.downloads.write().await;
            for row in rows {
                // Check if file still exists and get its size
                let file_path: String = row.try_get("file_path")?;
                let file_metadata = tokio::fs::metadata(&file_path).await;
                let file_exists = file_metadata.is_ok();

                let mut status_str: String = row.try_get("status")?;
                // If completed but file missing, mark as failed
                if status_str == "completed" && !file_exists {
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

                // Get total_bytes from database, but update with actual file size if it's 0
                let mut total_bytes = row.try_get::<i64, _>("total_bytes")? as u64;
                let mut downloaded_bytes = row.try_get::<i64, _>("downloaded_bytes")? as u64;

                // Fix total_bytes for completed downloads where it's 0 (Content-Length was missing)
                if status == DownloadStatus::Completed && total_bytes == 0 && file_exists {
                    if let Ok(metadata) = file_metadata {
                        let file_size = metadata.len();
                        total_bytes = file_size;
                        downloaded_bytes = file_size;
                        log::debug!("Fixed total_bytes for download");

                        // Update database with correct size
                        let updated_progress = DownloadProgress {
                            id: row.try_get("id")?,
                            media_id: row.try_get("media_id")?,
                            episode_id: row.try_get("episode_id")?,
                            episode_number: row.try_get("episode_number")?,
                            filename: row.try_get("filename")?,
                            url: row.try_get("url")?,
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

                let progress = DownloadProgress {
                    id: row.try_get("id")?,
                    media_id: row.try_get("media_id")?,
                    episode_id: row.try_get("episode_id")?,
                    episode_number: row.try_get("episode_number")?,
                    filename: row.try_get("filename")?,
                    url: row.try_get("url")?,
                    file_path,
                    total_bytes,
                    downloaded_bytes,
                    percentage: row.try_get::<f32, _>("percentage")?,
                    speed: row.try_get::<i64, _>("speed")? as u64,
                    status,
                    error_message: if !file_exists && status_str == "completed" {
                        Some("File not found. Please re-download.".to_string())
                    } else {
                        row.try_get("error_message")?
                    },
                };

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
                    id, media_id, episode_id, episode_number, filename, url, file_path,
                    total_bytes, downloaded_bytes, percentage, speed, status, error_message,
                    created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
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
            .bind(&download.file_path)
            .bind(download.total_bytes as i64)
            .bind(download.downloaded_bytes as i64)
            .bind(download.percentage)
            .bind(download.speed as i64)
            .bind(&status_str)
            .bind(&download.error_message)
            // For UPDATE
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
    ) -> Result<()> {
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

                            // Set total_bytes to actual file size if it wasn't set (Content-Length missing)
                            if progress.total_bytes == 0 || progress.total_bytes < progress.downloaded_bytes {
                                // Get actual file size from disk
                                if let Ok(metadata) = tokio::fs::metadata(&progress.file_path).await {
                                    let file_size = metadata.len();
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
        });

        Ok(())
    }

    /// Helper to save progress to database (for use in spawned tasks)
    async fn save_progress_to_db(pool: &Arc<SqlitePool>, progress: &DownloadProgress) -> Result<()> {
        let status_str = format!("{:?}", progress.status).to_lowercase();
        sqlx::query(
            r#"
            INSERT INTO downloads (
                id, media_id, episode_id, episode_number, filename, url, file_path,
                total_bytes, downloaded_bytes, percentage, speed, status, error_message,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
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
        .bind(&progress.file_path)
        .bind(progress.total_bytes as i64)
        .bind(progress.downloaded_bytes as i64)
        .bind(progress.percentage)
        .bind(progress.speed as i64)
        .bind(&status_str)
        .bind(&progress.error_message)
        // For UPDATE
        .bind(progress.downloaded_bytes as i64)
        .bind(progress.percentage)
        .bind(progress.speed as i64)
        .bind(&status_str)
        .bind(&progress.error_message)
        .execute(pool.as_ref())
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
        let (url, file_path, resume_from, existing_total) = {
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

        let mut request = client
            .get(&url)
            .header("User-Agent", "Mozilla/5.0")
            .header("Referer", "https://allmanga.to");

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
            file.write_all(&chunk).await.context("Failed to write chunk")?;
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
        let mut downloads = self.downloads.write().await;
        if let Some(progress) = downloads.get_mut(download_id) {
            progress.status = DownloadStatus::Cancelled;
            log::debug!("Cancelled download: {}", download_id);

            // Emit event
            self.emit_progress(progress);

            // Save to database
            self.save_to_database(progress).await.ok();
        }
        Ok(())
    }

    /// Pause a download
    pub async fn pause_download(&self, download_id: &str) -> Result<()> {
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

    /// Remove completed/failed download from list
    pub async fn remove_download(&self, download_id: &str) -> Result<()> {
        // Delete from database
        self.delete_from_database(download_id).await.ok();

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

    /// Clear completed downloads from list (doesn't delete files)
    pub async fn clear_completed(&self) -> Result<()> {
        // Get IDs of completed downloads
        let completed_ids: Vec<String> = {
            let downloads = self.downloads.read().await;
            downloads
                .iter()
                .filter(|(_, d)| d.status == DownloadStatus::Completed)
                .map(|(id, _)| id.clone())
                .collect()
        };

        // Delete from database
        if let Some(pool) = &self.db_pool {
            for id in &completed_ids {
                sqlx::query("DELETE FROM downloads WHERE id = ?")
                    .bind(id)
                    .execute(pool.as_ref())
                    .await
                    .ok();
            }
        }

        // Remove from memory
        let mut downloads = self.downloads.write().await;
        downloads.retain(|_, d| d.status != DownloadStatus::Completed);
        log::debug!("Cleared {} completed downloads from list", completed_ids.len());
        Ok(())
    }

    /// Clear failed downloads from list
    pub async fn clear_failed(&self) -> Result<()> {
        // Get IDs of failed downloads
        let failed_ids: Vec<String> = {
            let downloads = self.downloads.read().await;
            downloads
                .iter()
                .filter(|(_, d)| d.status == DownloadStatus::Failed)
                .map(|(id, _)| id.clone())
                .collect()
        };

        // Delete from database
        if let Some(pool) = &self.db_pool {
            for id in &failed_ids {
                sqlx::query("DELETE FROM downloads WHERE id = ?")
                    .bind(id)
                    .execute(pool.as_ref())
                    .await
                    .ok();
            }
        }

        // Remove from memory
        let mut downloads = self.downloads.write().await;
        downloads.retain(|_, d| d.status != DownloadStatus::Failed);
        log::debug!("Cleared {} failed downloads from list", failed_ids.len());
        Ok(())
    }

    /// Clear cancelled downloads from list
    pub async fn clear_cancelled(&self) -> Result<()> {
        // Get IDs of cancelled downloads
        let cancelled_ids: Vec<String> = {
            let downloads = self.downloads.read().await;
            downloads
                .iter()
                .filter(|(_, d)| d.status == DownloadStatus::Cancelled)
                .map(|(id, _)| id.clone())
                .collect()
        };

        // Delete from database
        if let Some(pool) = &self.db_pool {
            for id in &cancelled_ids {
                sqlx::query("DELETE FROM downloads WHERE id = ?")
                    .bind(id)
                    .execute(pool.as_ref())
                    .await
                    .ok();
            }
        }

        // Remove from memory
        let mut downloads = self.downloads.write().await;
        downloads.retain(|_, d| d.status != DownloadStatus::Cancelled);
        log::debug!("Cleared {} cancelled downloads from list", cancelled_ids.len());
        Ok(())
    }

    /// Delete a downloaded file and remove from list
    pub async fn delete_download(&self, download_id: &str) -> Result<()> {
        let file_path = {
            let downloads = self.downloads.read().await;
            downloads.get(download_id)
                .map(|d| d.file_path.clone())
        };

        if let Some(path) = file_path {
            // Delete the file
            tokio::fs::remove_file(&path)
                .await
                .context("Failed to delete file")?;

            log::debug!("Deleted file: {}", path);
        }

        // Remove from list and database
        self.remove_download(download_id).await?;

        Ok(())
    }

    /// Delete a downloaded episode by media ID and episode number
    pub async fn delete_episode_download(&self, media_id: &str, episode_number: i32) -> Result<()> {
        // Find the download ID for this episode
        let download_id = {
            let downloads = self.downloads.read().await;
            downloads
                .iter()
                .find(|(_, d)| {
                    d.media_id == media_id
                        && d.episode_number == episode_number
                        && d.status == DownloadStatus::Completed
                })
                .map(|(id, _)| id.clone())
        };

        if let Some(id) = download_id {
            self.delete_download(&id).await?;
            log::debug!("Deleted episode download: {} episode {}", media_id, episode_number);
            Ok(())
        } else {
            anyhow::bail!("Episode download not found")
        }
    }

    /// Get the downloads directory path
    pub fn get_downloads_directory(&self) -> String {
        self.download_dir.to_string_lossy().to_string()
    }
}
