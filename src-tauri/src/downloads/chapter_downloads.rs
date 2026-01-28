// Chapter Downloads Module
//
// Handles downloading manga chapters for offline reading

use sqlx::SqlitePool;
use serde::{Deserialize, Serialize};
use anyhow::Result;
use std::path::PathBuf;
use tokio::fs;
use tauri::{AppHandle, Emitter};

/// Event name for chapter download progress updates
pub const CHAPTER_DOWNLOAD_PROGRESS_EVENT: &str = "chapter-download-progress";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterDownload {
    pub id: String,
    pub media_id: String,
    pub chapter_id: String,
    pub chapter_number: f64,
    pub folder_path: String,
    pub total_images: i32,
    pub downloaded_images: i32,
    pub status: String,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterDownloadProgress {
    pub id: String,
    pub media_id: String,
    pub chapter_id: String,
    pub chapter_number: f64,
    pub total_images: i32,
    pub downloaded_images: i32,
    pub percentage: f64,
    pub status: String,
    pub error_message: Option<String>,
}

/// Emit chapter download progress event
fn emit_chapter_progress(app_handle: &AppHandle, progress: &ChapterDownloadProgress) {
    if let Err(e) = app_handle.emit(CHAPTER_DOWNLOAD_PROGRESS_EVENT, progress) {
        log::error!("Failed to emit chapter download progress: {}", e);
    }
}

/// Start downloading a chapter
pub async fn start_chapter_download(
    pool: &SqlitePool,
    app_handle: AppHandle,
    downloads_dir: PathBuf,
    media_id: &str,
    media_title: &str,
    chapter_id: &str,
    chapter_number: f64,
    image_urls: Vec<String>,
) -> Result<String> {
    // Create folder for chapter images
    let safe_title = media_title.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let folder_name = format!("{}_Ch{}", safe_title, chapter_number);
    let folder_path = downloads_dir.join("Manga").join(&folder_name);

    fs::create_dir_all(&folder_path).await?;

    let folder_path_str = folder_path.to_string_lossy().to_string();

    // Check if a record already exists for this media_id + chapter_id
    let existing_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM chapter_downloads WHERE media_id = ? AND chapter_id = ?"
    )
    .bind(media_id)
    .bind(chapter_id)
    .fetch_optional(pool)
    .await?;

    let download_id = if let Some(id) = existing_id {
        // Update existing record
        sqlx::query(
            r#"
            UPDATE chapter_downloads SET
                status = 'downloading',
                downloaded_images = 0,
                total_images = ?,
                folder_path = ?,
                error_message = NULL
            WHERE id = ?
            "#
        )
        .bind(image_urls.len() as i32)
        .bind(&folder_path_str)
        .bind(&id)
        .execute(pool)
        .await?;
        id
    } else {
        // Insert new record
        let new_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO chapter_downloads (id, media_id, chapter_id, chapter_number, folder_path, total_images, downloaded_images, status)
            VALUES (?, ?, ?, ?, ?, ?, 0, 'downloading')
            "#
        )
        .bind(&new_id)
        .bind(media_id)
        .bind(chapter_id)
        .bind(chapter_number)
        .bind(&folder_path_str)
        .bind(image_urls.len() as i32)
        .execute(pool)
        .await?;
        new_id
    };

    // Emit initial progress event
    let initial_progress = ChapterDownloadProgress {
        id: download_id.clone(),
        media_id: media_id.to_string(),
        chapter_id: chapter_id.to_string(),
        chapter_number,
        total_images: image_urls.len() as i32,
        downloaded_images: 0,
        percentage: 0.0,
        status: "downloading".to_string(),
        error_message: None,
    };
    emit_chapter_progress(&app_handle, &initial_progress);

    // Download images in background
    let pool_clone = pool.clone();
    let download_id_clone = download_id.clone();
    let media_id_clone = media_id.to_string();
    let chapter_id_clone = chapter_id.to_string();
    let total_images = image_urls.len();

    tokio::spawn(async move {
        let mut downloaded = 0;
        let mut last_emit_time = std::time::Instant::now();

        for (index, url) in image_urls.iter().enumerate() {
            let page_num = index + 1;
            let extension = get_image_extension(url);
            let filename = format!("page_{:04}.{}", page_num, extension);
            let file_path = folder_path.join(&filename);

            // Download image
            match download_image(url, &file_path).await {
                Ok(_) => {
                    downloaded += 1;

                    // Update progress in database
                    let result = sqlx::query(
                        "UPDATE chapter_downloads SET downloaded_images = ? WHERE id = ?"
                    )
                    .bind(downloaded)
                    .bind(&download_id_clone)
                    .execute(&pool_clone)
                    .await;

                    if let Err(e) = result {
                        log::error!("Failed to update progress: {:?}", e);
                    }

                    // Emit progress event (throttled to every 200ms)
                    let now = std::time::Instant::now();
                    if now.duration_since(last_emit_time).as_millis() >= 200 || downloaded == total_images as i32 {
                        let progress = ChapterDownloadProgress {
                            id: download_id_clone.clone(),
                            media_id: media_id_clone.clone(),
                            chapter_id: chapter_id_clone.clone(),
                            chapter_number,
                            total_images: total_images as i32,
                            downloaded_images: downloaded,
                            percentage: (downloaded as f64 / total_images as f64) * 100.0,
                            status: "downloading".to_string(),
                            error_message: None,
                        };
                        emit_chapter_progress(&app_handle, &progress);
                        last_emit_time = now;
                    }
                }
                Err(e) => {
                    log::error!("Failed to download page {}: {:?}", page_num, e);
                    // Continue with other pages
                }
            }
        }

        // Mark as completed or failed
        let status = if downloaded == total_images as i32 {
            "completed"
        } else if downloaded > 0 {
            "completed" // Partial success is still completed
        } else {
            "failed"
        };

        let error_message_str = if downloaded == 0 {
            Some("Failed to download any images".to_string())
        } else {
            None
        };

        let result = sqlx::query(
            "UPDATE chapter_downloads SET status = ?, error_message = ? WHERE id = ?"
        )
        .bind(status)
        .bind(&error_message_str)
        .bind(&download_id_clone)
        .execute(&pool_clone)
        .await;

        if let Err(e) = result {
            log::error!("Failed to update final status: {:?}", e);
        }

        // Emit final progress event
        let final_progress = ChapterDownloadProgress {
            id: download_id_clone.clone(),
            media_id: media_id_clone.clone(),
            chapter_id: chapter_id_clone.clone(),
            chapter_number,
            total_images: total_images as i32,
            downloaded_images: downloaded,
            percentage: if total_images > 0 { (downloaded as f64 / total_images as f64) * 100.0 } else { 0.0 },
            status: status.to_string(),
            error_message: error_message_str,
        };
        emit_chapter_progress(&app_handle, &final_progress);

        log::info!("Chapter download completed: {}/{} images", downloaded, total_images);
    });

    Ok(download_id)
}

/// Download a single image
async fn download_image(url: &str, path: &PathBuf) -> Result<()> {
    use std::io::Read;

    let request = ureq::get(url)
        .set("Referer", "https://allmanga.to")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0");

    let response = request.call()?;

    let mut bytes = Vec::new();
    response.into_reader()
        .take(50 * 1024 * 1024) // 50MB limit per image
        .read_to_end(&mut bytes)?;

    fs::write(path, bytes).await?;

    Ok(())
}

/// Get image extension from URL
fn get_image_extension(url: &str) -> &str {
    if url.contains(".png") || url.ends_with(".png") {
        "png"
    } else if url.contains(".webp") || url.ends_with(".webp") {
        "webp"
    } else if url.contains(".gif") || url.ends_with(".gif") {
        "gif"
    } else {
        "jpg"
    }
}

/// Get chapter download progress
pub async fn get_chapter_download_progress(
    pool: &SqlitePool,
    download_id: &str,
) -> Result<Option<ChapterDownloadProgress>> {
    let download = sqlx::query_as::<_, ChapterDownload>(
        r#"
        SELECT id, media_id, chapter_id, chapter_number, folder_path, total_images, downloaded_images, status, error_message, created_at
        FROM chapter_downloads
        WHERE id = ?
        "#
    )
    .bind(download_id)
    .fetch_optional(pool)
    .await?;

    Ok(download.map(|d| ChapterDownloadProgress {
        id: d.id,
        media_id: d.media_id,
        chapter_id: d.chapter_id,
        chapter_number: d.chapter_number,
        total_images: d.total_images,
        downloaded_images: d.downloaded_images,
        percentage: if d.total_images > 0 {
            (d.downloaded_images as f64 / d.total_images as f64) * 100.0
        } else {
            0.0
        },
        status: d.status,
        error_message: d.error_message,
    }))
}

/// Check if a chapter is downloaded
pub async fn is_chapter_downloaded(
    pool: &SqlitePool,
    media_id: &str,
    chapter_id: &str,
) -> Result<bool> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM chapter_downloads WHERE media_id = ? AND chapter_id = ? AND status = 'completed'"
    )
    .bind(media_id)
    .bind(chapter_id)
    .fetch_one(pool)
    .await?;

    Ok(count > 0)
}

/// Get downloaded chapter images (local paths)
pub async fn get_downloaded_chapter_images(
    pool: &SqlitePool,
    media_id: &str,
    chapter_id: &str,
) -> Result<Vec<String>> {
    let download = sqlx::query_as::<_, ChapterDownload>(
        r#"
        SELECT id, media_id, chapter_id, chapter_number, folder_path, total_images, downloaded_images, status, error_message, created_at
        FROM chapter_downloads
        WHERE media_id = ? AND chapter_id = ? AND status = 'completed'
        "#
    )
    .bind(media_id)
    .bind(chapter_id)
    .fetch_optional(pool)
    .await?;

    if let Some(download) = download {
        let folder_path = PathBuf::from(&download.folder_path);

        if folder_path.exists() {
            let mut images = Vec::new();
            let mut read_dir = fs::read_dir(&folder_path).await?;
            let mut entries = Vec::new();

            while let Some(entry) = read_dir.next_entry().await? {
                entries.push(entry);
            }

            entries.sort_by_key(|e| e.file_name());

            for entry in entries {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    if ["jpg", "jpeg", "png", "webp", "gif"].contains(&ext.to_string_lossy().to_lowercase().as_str()) {
                        images.push(path.to_string_lossy().to_string());
                    }
                }
            }

            return Ok(images);
        }
    }

    Ok(vec![])
}

/// Delete a chapter download
pub async fn delete_chapter_download(
    pool: &SqlitePool,
    media_id: &str,
    chapter_id: &str,
) -> Result<()> {
    // Get folder path first
    let download = sqlx::query_as::<_, ChapterDownload>(
        r#"
        SELECT id, media_id, chapter_id, chapter_number, folder_path, total_images, downloaded_images, status, error_message, created_at
        FROM chapter_downloads
        WHERE media_id = ? AND chapter_id = ?
        "#
    )
    .bind(media_id)
    .bind(chapter_id)
    .fetch_optional(pool)
    .await?;

    if let Some(download) = download {
        // Delete folder
        let folder_path = PathBuf::from(&download.folder_path);
        if folder_path.exists() {
            fs::remove_dir_all(&folder_path).await?;
        }
    }

    // Delete from database
    sqlx::query("DELETE FROM chapter_downloads WHERE media_id = ? AND chapter_id = ?")
        .bind(media_id)
        .bind(chapter_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// List all chapter downloads for a manga
pub async fn list_chapter_downloads(
    pool: &SqlitePool,
    media_id: &str,
) -> Result<Vec<ChapterDownloadProgress>> {
    let downloads = sqlx::query_as::<_, ChapterDownload>(
        r#"
        SELECT id, media_id, chapter_id, chapter_number, folder_path, total_images, downloaded_images, status, error_message, created_at
        FROM chapter_downloads
        WHERE media_id = ?
        ORDER BY chapter_number ASC
        "#
    )
    .bind(media_id)
    .fetch_all(pool)
    .await?;

    Ok(downloads.into_iter().map(|d| ChapterDownloadProgress {
        id: d.id,
        media_id: d.media_id,
        chapter_id: d.chapter_id,
        chapter_number: d.chapter_number,
        total_images: d.total_images,
        downloaded_images: d.downloaded_images,
        percentage: if d.total_images > 0 {
            (d.downloaded_images as f64 / d.total_images as f64) * 100.0
        } else {
            0.0
        },
        status: d.status,
        error_message: d.error_message,
    }).collect())
}

/// Chapter download with media title for display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterDownloadWithTitle {
    pub id: String,
    pub media_id: String,
    pub media_title: String,
    pub chapter_id: String,
    pub chapter_number: f64,
    pub total_images: i32,
    pub downloaded_images: i32,
    pub percentage: f64,
    pub status: String,
    pub error_message: Option<String>,
}

/// List ALL chapter downloads across all manga (for Download Manager)
pub async fn list_all_chapter_downloads(pool: &SqlitePool) -> Result<Vec<ChapterDownloadWithTitle>> {
    let downloads = sqlx::query(
        r#"
        SELECT
            cd.id, cd.media_id, cd.chapter_id, cd.chapter_number,
            cd.total_images, cd.downloaded_images, cd.status, cd.error_message,
            m.title as media_title
        FROM chapter_downloads cd
        LEFT JOIN media m ON cd.media_id = m.id
        ORDER BY cd.created_at DESC
        "#
    )
    .fetch_all(pool)
    .await?;

    let mut results = Vec::new();
    for row in downloads {
        use sqlx::Row;

        let id: String = row.try_get("id")?;
        let media_id: String = row.try_get("media_id")?;
        let media_title: Option<String> = row.try_get("media_title").ok();
        let chapter_id: String = row.try_get("chapter_id")?;
        let chapter_number: f64 = row.try_get("chapter_number")?;
        let total_images: i32 = row.try_get("total_images")?;
        let downloaded_images: i32 = row.try_get("downloaded_images")?;
        let status: String = row.try_get("status")?;
        let error_message: Option<String> = row.try_get("error_message").ok().flatten();

        let percentage = if total_images > 0 {
            (downloaded_images as f64 / total_images as f64) * 100.0
        } else {
            0.0
        };

        results.push(ChapterDownloadWithTitle {
            id,
            media_id: media_id.clone(),
            media_title: media_title.unwrap_or_else(|| media_id.replace('_', " ")),
            chapter_id,
            chapter_number,
            total_images,
            downloaded_images,
            percentage,
            status,
            error_message,
        });
    }

    Ok(results)
}

/// Downloaded manga with aggregate info and media details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadedManga {
    pub media_id: String,
    pub title: String,
    pub cover_url: Option<String>,
    pub chapter_count: i32,
    pub total_images: i32,
    pub total_size: i64,
}

/// Get all downloaded manga with chapter counts and media details
pub async fn get_all_downloaded_manga(pool: &SqlitePool) -> Result<Vec<DownloadedManga>> {
    // Query with JOIN to get media details along with download stats
    // Use '|||' as separator since folder paths may contain commas (e.g., "No Game No Life, desu!")
    let downloads = sqlx::query(
        r#"
        SELECT
            cd.media_id,
            m.title,
            m.cover_url,
            COUNT(*) as chapter_count,
            SUM(cd.total_images) as total_images,
            GROUP_CONCAT(cd.folder_path, '|||') as folder_paths
        FROM chapter_downloads cd
        LEFT JOIN media m ON cd.media_id = m.id
        WHERE cd.status = 'completed'
        GROUP BY cd.media_id
        ORDER BY MAX(cd.created_at) DESC
        "#
    )
    .fetch_all(pool)
    .await?;

    log::debug!("[ChapterDownloads] Found {} downloaded manga groups", downloads.len());

    let mut results = Vec::new();
    for row in downloads {
        use sqlx::Row;

        let media_id: String = row.try_get("media_id")?;
        let title: Option<String> = row.try_get("title").ok();
        let cover_url: Option<String> = row.try_get("cover_url").ok().flatten();
        let chapter_count: i32 = row.try_get("chapter_count")?;
        let total_images: i32 = row.try_get::<i32, _>("total_images").unwrap_or(0);
        let folder_paths_str: Option<String> = row.try_get("folder_paths").ok();

        // Calculate total size from folder paths
        let mut total_size: i64 = 0;
        if let Some(paths) = &folder_paths_str {
            // Split by '|||' separator (not comma, since folder names may contain commas)
            for folder in paths.split("|||") {
                let folder_path = PathBuf::from(folder.trim());
                if folder_path.exists() {
                    match calculate_folder_size(&folder_path).await {
                        Ok(size) => {
                            total_size += size as i64;
                        }
                        Err(e) => {
                            log::error!("[ChapterDownloads] Failed to calculate size for {:?}: {:?}", folder_path, e);
                        }
                    }
                } else {
                    log::warn!("[ChapterDownloads] Folder does not exist: {:?}", folder_path);
                }
            }
        }

        log::debug!("[ChapterDownloads] Total size for {}: {} bytes", media_id, total_size);

        results.push(DownloadedManga {
            media_id: media_id.clone(),
            title: title.unwrap_or_else(|| media_id.replace('_', " ")),
            cover_url,
            chapter_count,
            total_images,
            total_size,
        });
    }

    Ok(results)
}

/// Calculate folder size recursively
async fn calculate_folder_size(path: &PathBuf) -> Result<u64> {
    let mut size = 0u64;
    let mut read_dir = fs::read_dir(path).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        let metadata = entry.metadata().await?;
        if metadata.is_file() {
            size += metadata.len();
        } else if metadata.is_dir() {
            size += Box::pin(calculate_folder_size(&entry.path())).await?;
        }
    }

    Ok(size)
}

impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for ChapterDownload {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;

        Ok(ChapterDownload {
            id: row.try_get("id")?,
            media_id: row.try_get("media_id")?,
            chapter_id: row.try_get("chapter_id")?,
            chapter_number: row.try_get("chapter_number")?,
            folder_path: row.try_get("folder_path")?,
            total_images: row.try_get("total_images")?,
            downloaded_images: row.try_get("downloaded_images")?,
            status: row.try_get("status")?,
            error_message: row.try_get("error_message")?,
            created_at: row.try_get("created_at")?,
        })
    }
}
