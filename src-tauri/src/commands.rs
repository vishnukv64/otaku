// Tauri Commands - IPC interface for frontend
//
// Exposes backend functionality to the frontend via Tauri's command system.
// All commands are async and return Results for error handling.
//
// NOTE: For MVP, we create runtimes on-demand rather than storing them globally
// due to QuickJS's thread-safety limitations. In production, we'd use a thread-local
// runtime pool.

use crate::extensions::{ChapterImages, Extension, ExtensionMetadata, ExtensionRuntime, MangaDetails, MediaDetails, SearchResults, TagsResult, VideoSources};
use crate::database::Database;
use crate::downloads::{DownloadManager, DownloadProgress, chapter_downloads};
use crate::VideoServerInfo;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use sqlx;

/// Global state for loaded extensions (stores just the code, not runtimes)
pub struct AppState {
    pub extensions: Mutex<Vec<Extension>>,
    pub database: Arc<Database>,
}

impl AppState {
    pub fn new(database: Database) -> Self {
        Self {
            extensions: Mutex::new(Vec::new()),
            database: Arc::new(database),
        }
    }
}

/// Load an extension from JavaScript code
/// If an extension with the same ID exists, it will be replaced
#[tauri::command]
pub async fn load_extension(
    state: State<'_, AppState>,
    code: String,
) -> Result<ExtensionMetadata, String> {
    let extension = Extension::from_code(&code)
        .map_err(|e| format!("Failed to parse extension: {}", e))?;

    let metadata = extension.metadata.clone();

    let mut extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    // Remove any existing extension with the same ID
    extensions.retain(|ext| ext.metadata.id != metadata.id);

    // Add the new extension
    extensions.push(extension);

    log::debug!("Loaded extension: {}", metadata.name);

    Ok(metadata)
}

/// Search for anime using a specific extension
#[tauri::command]
pub async fn search_anime(
    state: State<'_, AppState>,
    extension_id: String,
    query: String,
    page: u32,
    allow_adult: Option<bool>,
) -> Result<SearchResults, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    // Release lock before creating runtime
    drop(extensions);

    // Create runtime on-demand with NSFW setting
    let runtime = ExtensionRuntime::with_options(extension, allow_adult.unwrap_or(false))
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.search(&query, page)
        .map_err(|e| format!("Search failed: {}", e))
}

/// Get detailed information about an anime
#[tauri::command]
pub async fn get_anime_details(
    state: State<'_, AppState>,
    extension_id: String,
    anime_id: String,
) -> Result<MediaDetails, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::new(extension)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.get_details(&anime_id)
        .map_err(|e| format!("Failed to get details: {}", e))
}

/// Get video sources for an episode
#[tauri::command]
pub async fn get_video_sources(
    state: State<'_, AppState>,
    extension_id: String,
    episode_id: String,
) -> Result<VideoSources, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::new(extension)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.get_sources(&episode_id)
        .map_err(|e| format!("Failed to get sources: {}", e))
}

/// Discover anime with filters (trending, top-rated, by genre, etc.)
#[tauri::command]
pub async fn discover_anime(
    state: State<'_, AppState>,
    extension_id: String,
    page: u32,
    sort_type: Option<String>,
    genres: Vec<String>,
    allow_adult: Option<bool>,
) -> Result<SearchResults, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::with_options(extension, allow_adult.unwrap_or(false))
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.discover(page, sort_type, genres)
        .map_err(|e| format!("Discover failed: {}", e))
}

/// Get anime recommendations (trending/latest)
#[tauri::command]
pub async fn get_recommendations(
    state: State<'_, AppState>,
    extension_id: String,
    allow_adult: Option<bool>,
) -> Result<SearchResults, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::with_options(extension, allow_adult.unwrap_or(false))
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.get_recommendations()
        .map_err(|e| format!("Get recommendations failed: {}", e))
}

/// Get available tags (genres and studios)
#[tauri::command]
pub async fn get_tags(
    state: State<'_, AppState>,
    extension_id: String,
    page: u32,
) -> Result<TagsResult, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::new(extension)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.get_tags(page)
        .map_err(|e| format!("Get tags failed: {}", e))
}

/// List all loaded extensions
#[tauri::command]
pub async fn list_extensions(
    state: State<'_, AppState>,
) -> Result<Vec<ExtensionMetadata>, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let metadata: Vec<ExtensionMetadata> = extensions.iter()
        .map(|ext| ext.metadata.clone())
        .collect();

    Ok(metadata)
}

// ==================== Manga Commands ====================

/// Search for manga using a specific extension
#[tauri::command]
pub async fn search_manga(
    state: State<'_, AppState>,
    extension_id: String,
    query: String,
    page: u32,
    allow_adult: Option<bool>,
) -> Result<SearchResults, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::with_options(extension, allow_adult.unwrap_or(false))
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.search(&query, page)
        .map_err(|e| format!("Manga search failed: {}", e))
}

/// Get detailed information about a manga
#[tauri::command]
pub async fn get_manga_details(
    state: State<'_, AppState>,
    extension_id: String,
    manga_id: String,
    allow_adult: Option<bool>,
) -> Result<MangaDetails, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::with_options(extension, allow_adult.unwrap_or(false))
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.get_manga_details(&manga_id)
        .map_err(|e| format!("Failed to get manga details: {}", e))
}

/// Get chapter images for reading
#[tauri::command]
pub async fn get_chapter_images(
    state: State<'_, AppState>,
    extension_id: String,
    chapter_id: String,
) -> Result<ChapterImages, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::new(extension)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.get_chapter_images(&chapter_id)
        .map_err(|e| format!("Failed to get chapter images: {}", e))
}

/// Discover manga with filters (trending, top-rated, by genre)
#[tauri::command]
pub async fn discover_manga(
    state: State<'_, AppState>,
    extension_id: String,
    page: u32,
    sort_type: Option<String>,
    genres: Vec<String>,
    allow_adult: Option<bool>,
) -> Result<SearchResults, String> {
    log::debug!("[Manga] discover_manga called with genres: {:?}", genres);

    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::with_options(extension, allow_adult.unwrap_or(false))
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    let result = runtime.discover(page, sort_type, genres.clone())
        .map_err(|e| format!("Manga discover failed: {}", e))?;

    log::debug!("[Manga] discover_manga returned {} results for genres {:?}", result.results.len(), genres);

    Ok(result)
}

/// Get available manga tags (genres)
#[tauri::command]
pub async fn get_manga_tags(
    state: State<'_, AppState>,
    extension_id: String,
    page: u32,
) -> Result<TagsResult, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::new(extension)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.get_tags(page)
        .map_err(|e| format!("Get manga tags failed: {}", e))
}

/// Proxy image request to avoid CORS issues (for manga pages)
#[tauri::command]
pub async fn proxy_image_request(
    url: String,
) -> Result<Vec<u8>, String> {
    log::debug!("Proxying image request");

    use std::io::Read;

    let request = ureq::get(&url)
        .set("Referer", "https://allmanga.to")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0")
        .set("Origin", "https://allmanga.to");

    match request.call() {
        Ok(response) => {
            let content_length = response.header("Content-Length")
                .and_then(|v| v.parse::<usize>().ok());

            // Pre-allocate based on content length, cap at 50MB for images
            let initial_capacity = content_length
                .map(|l| l.min(50 * 1024 * 1024))
                .unwrap_or(1024 * 1024);

            let mut bytes = Vec::with_capacity(initial_capacity);

            response.into_reader()
                .read_to_end(&mut bytes)
                .map_err(|e| format!("Failed to read image: {}", e))?;

            Ok(bytes)
        }
        Err(e) => {
            log::error!("Image proxy error: {:?}", e);
            Err(format!("Image proxy request failed: {}", e))
        }
    }
}

/// Proxy video request to avoid CORS issues
/// Returns the response body as bytes
#[tauri::command]
pub async fn proxy_video_request(
    url: String,
    range: Option<String>,
) -> Result<Vec<u8>, String> {
    log::debug!("Proxying video request");

    use std::io::Read;

    let mut request = ureq::get(&url)
        .set("Referer", "https://allmanga.to")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0")
        .set("Origin", "https://allmanga.to");

    // Add range header if provided (for seeking support)
    if let Some(range_value) = range {
        request = request.set("Range", &range_value);
    }

    match request.call() {
        Ok(response) => {
            // Get content length hint for pre-allocation
            let content_length = response.header("Content-Length")
                .and_then(|v| v.parse::<usize>().ok());

            // Pre-allocate vector based on content length, cap at 100MB for initial allocation
            let initial_capacity = content_length
                .map(|l| l.min(100 * 1024 * 1024))
                .unwrap_or(1024 * 1024); // Default 1MB if unknown

            let mut bytes = Vec::with_capacity(initial_capacity);

            // Read entire response - HLS segments are typically a few MB
            // No artificial limit - trust the server's response size
            response.into_reader()
                .read_to_end(&mut bytes)
                .map_err(|e| format!("Failed to read response: {}", e))?;

            Ok(bytes)
        }
        Err(e) => {
            log::error!("Proxy error: {:?}", e);
            Err(format!("Proxy request failed: {}", e))
        }
    }
}

/// Proxy HLS playlist (m3u8) and rewrite URLs to go through proxy
#[tauri::command]
pub async fn proxy_hls_playlist(
    url: String,
) -> Result<String, String> {
    log::debug!("Proxying HLS playlist");

    use std::io::Read;

    let request = ureq::get(&url)
        .set("Referer", "https://allmanga.to")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0")
        .set("Origin", "https://allmanga.to");

    match request.call() {
        Ok(response) => {
            let status = response.status();
            // Clone content_type before moving response
            let content_type = response.header("Content-Type")
                .map(|s| s.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let _ = status; // silence unused warning

            // Try to read as bytes first
            let mut bytes = Vec::new();
            response.into_reader()
                .take(10_000_000) // 10MB limit
                .read_to_end(&mut bytes)
                .map_err(|e| format!("Failed to read response: {}", e))?;

            // Try to parse as UTF-8 text (m3u8 playlist)
            match String::from_utf8(bytes) {
                Ok(playlist) => {
                    // Check if it looks like an m3u8 playlist
                    if playlist.contains("#EXTM3U") || playlist.contains("#EXT-X-") {
                        // Rewrite relative URLs in the playlist to absolute URLs
                        let base_url = extract_base_url(&url);
                        let rewritten = rewrite_playlist_urls(&playlist, &base_url);
                        Ok(rewritten)
                    } else {
                        Ok(playlist)
                    }
                }
                Err(_) => {
                    Err(format!("URL does not point to an HLS playlist (got binary data). Content-Type: {}.", content_type))
                }
            }
        }
        Err(e) => {
            log::error!("Playlist proxy error: {:?}", e);
            Err(format!("Failed to fetch playlist: {}", e))
        }
    }
}

/// Extract base URL from a full URL
fn extract_base_url(url: &str) -> String {
    if let Some(last_slash) = url.rfind('/') {
        url[..last_slash].to_string()
    } else {
        url.to_string()
    }
}

/// Rewrite relative URLs in HLS playlist to absolute URLs
fn rewrite_playlist_urls(playlist: &str, base_url: &str) -> String {
    let mut result = String::new();

    for line in playlist.lines() {
        let trimmed = line.trim();

        // Skip comments and empty lines
        if trimmed.starts_with('#') || trimmed.is_empty() {
            result.push_str(line);
            result.push('\n');
            continue;
        }

        // Check if this is a URL line (not a tag)
        if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
            // Relative URL - make it absolute
            let absolute_url = if trimmed.starts_with('/') {
                // Absolute path - extract protocol and domain from base_url
                if let Some(domain_end) = base_url.find("://").and_then(|i| base_url[i+3..].find('/').map(|j| i+3+j)) {
                    format!("{}{}", &base_url[..domain_end], trimmed)
                } else {
                    format!("{}{}", base_url, trimmed)
                }
            } else {
                // Relative path
                format!("{}/{}", base_url, trimmed)
            };
            result.push_str(&absolute_url);
        } else {
            // Already absolute URL
            result.push_str(trimmed);
        }

        result.push('\n');
    }

    result
}

/// Start downloading a video
#[tauri::command]
pub async fn start_download(
    download_manager: State<'_, DownloadManager>,
    media_id: String,
    episode_id: String,
    episode_number: i32,
    url: String,
    filename: String,
) -> Result<String, String> {
    let download_id = format!("{}_{}", media_id, episode_number);

    log::debug!("Starting download: {}", download_id);

    download_manager
        .queue_download(
            download_id.clone(),
            media_id,
            episode_id,
            episode_number,
            url,
            filename,
        )
        .await
        .map_err(|e| format!("Failed to queue download: {}", e))?;

    Ok(download_id)
}

/// Get download progress
#[tauri::command]
pub async fn get_download_progress(
    download_manager: State<'_, DownloadManager>,
    download_id: String,
) -> Result<DownloadProgress, String> {
    download_manager
        .get_progress(&download_id)
        .await
        .ok_or_else(|| format!("Download not found: {}", download_id))
}

/// List all downloads
#[tauri::command]
pub async fn list_downloads(
    download_manager: State<'_, DownloadManager>,
) -> Result<Vec<DownloadProgress>, String> {
    Ok(download_manager.list_downloads().await)
}

/// Cancel a download
#[tauri::command]
pub async fn cancel_download(
    download_manager: State<'_, DownloadManager>,
    download_id: String,
) -> Result<(), String> {
    download_manager
        .cancel_download(&download_id)
        .await
        .map_err(|e| format!("Failed to cancel download: {}", e))
}

/// Check if an episode is downloaded
#[tauri::command]
pub async fn is_episode_downloaded(
    download_manager: State<'_, DownloadManager>,
    media_id: String,
    episode_number: i32,
) -> Result<bool, String> {
    Ok(download_manager.is_episode_downloaded(&media_id, episode_number).await)
}

/// Get the file path for a downloaded episode
#[tauri::command]
pub async fn get_episode_file_path(
    download_manager: State<'_, DownloadManager>,
    media_id: String,
    episode_number: i32,
) -> Result<Option<String>, String> {
    Ok(download_manager.get_episode_file_path(&media_id, episode_number).await)
}

/// Get total storage used by downloads
#[tauri::command]
pub async fn get_total_storage_used(
    download_manager: State<'_, DownloadManager>,
) -> Result<u64, String> {
    Ok(download_manager.get_total_storage_used().await)
}

/// Get the downloads directory path
#[tauri::command]
pub async fn get_downloads_directory(
    download_manager: State<'_, DownloadManager>,
) -> Result<String, String> {
    Ok(download_manager.get_downloads_directory())
}

/// Open the downloads directory in file explorer
#[tauri::command]
pub async fn open_downloads_folder(
    download_manager: State<'_, DownloadManager>,
) -> Result<(), String> {
    let path = download_manager.get_downloads_directory();

    // Ensure the directory exists
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    // Open the directory based on the platform
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

/// Remove a download from the list
#[tauri::command]
pub async fn remove_download(
    download_manager: State<'_, DownloadManager>,
    download_id: String,
) -> Result<(), String> {
    download_manager
        .remove_download(&download_id)
        .await
        .map_err(|e| format!("Failed to remove download: {}", e))
}

/// Delete a downloaded file
#[tauri::command]
pub async fn delete_download(
    download_manager: State<'_, DownloadManager>,
    download_id: String,
) -> Result<(), String> {
    download_manager
        .delete_download(&download_id)
        .await
        .map_err(|e| format!("Failed to delete download: {}", e))
}

/// Delete a downloaded episode by media ID and episode number
#[tauri::command]
pub async fn delete_episode_download(
    download_manager: State<'_, DownloadManager>,
    media_id: String,
    episode_number: i32,
) -> Result<(), String> {
    download_manager
        .delete_episode_download(&media_id, episode_number)
        .await
        .map_err(|e| format!("Failed to delete episode download: {}", e))
}

/// Clear completed downloads from list
#[tauri::command]
pub async fn clear_completed_downloads(
    download_manager: State<'_, DownloadManager>,
) -> Result<(), String> {
    download_manager
        .clear_completed()
        .await
        .map_err(|e| format!("Failed to clear completed downloads: {}", e))
}

/// Clear failed downloads from list
#[tauri::command]
pub async fn clear_failed_downloads(
    download_manager: State<'_, DownloadManager>,
) -> Result<(), String> {
    download_manager
        .clear_failed()
        .await
        .map_err(|e| format!("Failed to clear failed downloads: {}", e))
}


// ==================== Watch History Commands ====================

/// Save or update watch progress for an episode
#[tauri::command]
pub async fn save_watch_progress(
    state: State<'_, AppState>,
    media_id: String,
    episode_id: String,
    episode_number: i32,
    progress_seconds: f64,
    duration: Option<f64>,
    completed: bool,
) -> Result<(), String> {
    use crate::database::watch_history::{save_watch_progress as save_progress, WatchProgress};

    let progress = WatchProgress {
        media_id,
        episode_id,
        episode_number,
        progress_seconds,
        duration,
        completed,
    };

    save_progress(state.database.pool(), &progress)
        .await
        .map_err(|e| format!("Failed to save watch progress: {}", e))
}

/// Get watch progress for a specific episode
#[tauri::command]
pub async fn get_watch_progress(
    state: State<'_, AppState>,
    episode_id: String,
) -> Result<Option<crate::database::watch_history::WatchHistory>, String> {
    use crate::database::watch_history::get_watch_progress as get_progress;

    get_progress(state.database.pool(), &episode_id)
        .await
        .map_err(|e| format!("Failed to get watch progress: {}", e))
}

/// Get the most recent watch progress for a media (for Resume Watching feature)
#[tauri::command]
pub async fn get_latest_watch_progress_for_media(
    state: State<'_, AppState>,
    media_id: String,
) -> Result<Option<crate::database::watch_history::WatchHistory>, String> {
    use crate::database::watch_history::get_latest_watch_progress_for_media as get_latest;

    get_latest(state.database.pool(), &media_id)
        .await
        .map_err(|e| format!("Failed to get latest watch progress: {}", e))
}

/// Get continue watching list (recently watched episodes that aren't completed)
#[tauri::command]
pub async fn get_continue_watching(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<crate::database::watch_history::WatchHistory>, String> {
    use crate::database::watch_history::get_continue_watching as get_continue;

    get_continue(state.database.pool(), limit)
        .await
        .map_err(|e| format!("Failed to get continue watching: {}", e))
}

/// Remove media from continue watching (deletes all watch history for that media)
#[tauri::command]
pub async fn remove_from_continue_watching(
    state: State<'_, AppState>,
    media_id: String,
) -> Result<(), String> {
    use crate::database::watch_history::delete_media_watch_history;

    delete_media_watch_history(state.database.pool(), &media_id)
        .await
        .map_err(|e| format!("Failed to remove from continue watching: {}", e))?;

    log::debug!("Removed media {} from continue watching", media_id);
    Ok(())
}

// ==================== Reading History Commands ====================

/// Save or update reading progress for a chapter
#[tauri::command]
pub async fn save_reading_progress(
    state: State<'_, AppState>,
    media_id: String,
    chapter_id: String,
    chapter_number: f64,
    current_page: i32,
    total_pages: Option<i32>,
    completed: bool,
) -> Result<(), String> {
    use crate::database::reading_history::{save_reading_progress as save_progress, ReadingProgress};

    let progress = ReadingProgress {
        media_id,
        chapter_id,
        chapter_number,
        current_page,
        total_pages,
        completed,
    };

    save_progress(state.database.pool(), &progress)
        .await
        .map_err(|e| format!("Failed to save reading progress: {}", e))
}

/// Get reading progress for a specific chapter
#[tauri::command]
pub async fn get_reading_progress(
    state: State<'_, AppState>,
    chapter_id: String,
) -> Result<Option<crate::database::reading_history::ReadingHistory>, String> {
    use crate::database::reading_history::get_reading_progress as get_progress;

    get_progress(state.database.pool(), &chapter_id)
        .await
        .map_err(|e| format!("Failed to get reading progress: {}", e))
}

/// Get the most recent reading progress for a manga (for Resume Reading feature)
#[tauri::command]
pub async fn get_latest_reading_progress_for_media(
    state: State<'_, AppState>,
    media_id: String,
) -> Result<Option<crate::database::reading_history::ReadingHistory>, String> {
    use crate::database::reading_history::get_latest_reading_progress_for_media as get_latest;

    get_latest(state.database.pool(), &media_id)
        .await
        .map_err(|e| format!("Failed to get latest reading progress: {}", e))
}

/// Get continue reading list (recently read chapters that aren't completed)
#[tauri::command]
pub async fn get_continue_reading(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<crate::database::reading_history::ReadingHistory>, String> {
    use crate::database::reading_history::get_continue_reading as get_continue;

    get_continue(state.database.pool(), limit)
        .await
        .map_err(|e| format!("Failed to get continue reading: {}", e))
}

/// Remove manga from continue reading (deletes all reading history for that manga)
#[tauri::command]
pub async fn remove_from_continue_reading_manga(
    state: State<'_, AppState>,
    media_id: String,
) -> Result<(), String> {
    use crate::database::reading_history::delete_manga_reading_history;

    delete_manga_reading_history(state.database.pool(), &media_id)
        .await
        .map_err(|e| format!("Failed to remove from continue reading: {}", e))?;

    log::debug!("Removed manga {} from continue reading", media_id);
    Ok(())
}

// ==================== Library Commands ====================

/// Add media to library
#[tauri::command]
pub async fn add_to_library(
    state: State<'_, AppState>,
    media_id: String,
    status: String,
) -> Result<crate::database::library::LibraryEntry, String> {
    use crate::database::library::{add_to_library as add_media, LibraryStatus};

    let status = LibraryStatus::from_str(&status)
        .ok_or_else(|| format!("Invalid library status: {}", status))?;

    add_media(state.database.pool(), &media_id, status)
        .await
        .map_err(|e| format!("Failed to add to library: {}", e))
}

/// Remove media from library
#[tauri::command]
pub async fn remove_from_library(
    state: State<'_, AppState>,
    media_id: String,
) -> Result<(), String> {
    use crate::database::library::remove_from_library as remove_media;

    remove_media(state.database.pool(), &media_id)
        .await
        .map_err(|e| format!("Failed to remove from library: {}", e))
}

/// Get library entry for a specific media
#[tauri::command]
pub async fn get_library_entry(
    state: State<'_, AppState>,
    media_id: String,
) -> Result<Option<crate::database::library::LibraryEntry>, String> {
    use crate::database::library::get_library_entry as get_entry;

    get_entry(state.database.pool(), &media_id)
        .await
        .map_err(|e| format!("Failed to get library entry: {}", e))
}

/// Get all library entries by status
#[tauri::command]
pub async fn get_library_by_status(
    state: State<'_, AppState>,
    status: Option<String>,
) -> Result<Vec<crate::database::library::LibraryEntry>, String> {
    use crate::database::library::{get_library_by_status as get_by_status, LibraryStatus};

    let status = match status {
        Some(s) => Some(
            LibraryStatus::from_str(&s)
                .ok_or_else(|| format!("Invalid library status: {}", s))?
        ),
        None => None,
    };

    get_by_status(state.database.pool(), status)
        .await
        .map_err(|e| format!("Failed to get library: {}", e))
}

/// Get library entries with full media details by status
#[tauri::command]
pub async fn get_library_with_media(
    state: State<'_, AppState>,
    status: Option<String>,
) -> Result<Vec<crate::database::library::LibraryEntryWithMedia>, String> {
    use crate::database::library::{get_library_with_media_by_status, LibraryStatus};

    let status = match status {
        Some(s) => Some(
            LibraryStatus::from_str(&s)
                .ok_or_else(|| format!("Invalid library status: {}", s))?
        ),
        None => None,
    };

    get_library_with_media_by_status(state.database.pool(), status)
        .await
        .map_err(|e| format!("Failed to get library with media: {}", e))
}

/// Toggle favorite status
#[tauri::command]
pub async fn toggle_favorite(
    state: State<'_, AppState>,
    media_id: String,
) -> Result<bool, String> {
    use crate::database::library::toggle_favorite as toggle;

    toggle(state.database.pool(), &media_id)
        .await
        .map_err(|e| format!("Failed to toggle favorite: {}", e))
}

/// Check if media is in library
#[tauri::command]
pub async fn is_in_library(
    state: State<'_, AppState>,
    media_id: String,
) -> Result<bool, String> {
    use crate::database::library::is_in_library as check_library;

    check_library(state.database.pool(), &media_id)
        .await
        .map_err(|e| format!("Failed to check library: {}", e))
}

// ==================== Media Commands ====================

/// Save media details to database
#[tauri::command]
pub async fn save_media_details(
    state: State<'_, AppState>,
    media: crate::database::media::MediaEntry,
) -> Result<(), String> {
    use crate::database::media::save_media;

    save_media(state.database.pool(), &media)
        .await
        .map_err(|e| format!("Failed to save media: {}", e))
}

/// Get continue watching with full media details
#[tauri::command]
pub async fn get_continue_watching_with_details(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<crate::database::media::ContinueWatchingEntry>, String> {
    use crate::database::media::get_continue_watching_with_media;

    get_continue_watching_with_media(state.database.pool(), limit)
        .await
        .map_err(|e| format!("Failed to get continue watching: {}", e))
}

/// Get continue reading with full media details
#[tauri::command]
pub async fn get_continue_reading_with_details(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<crate::database::media::ContinueReadingEntry>, String> {
    use crate::database::media::get_continue_reading_with_media;

    get_continue_reading_with_media(state.database.pool(), limit)
        .await
        .map_err(|e| format!("Failed to get continue reading: {}", e))
}

/// Get downloads with full media details
#[tauri::command]
pub async fn get_downloads_with_media(
    state: State<'_, AppState>,
) -> Result<Vec<crate::database::media::DownloadWithMedia>, String> {
    use crate::database::media::get_downloads_with_media as get_downloads;

    get_downloads(state.database.pool())
        .await
        .map_err(|e| format!("Failed to get downloads with media: {}", e))
}

// ==================== Data Management Commands ====================

/// Clear all watch history
#[tauri::command]
pub async fn clear_all_watch_history(
    state: State<'_, AppState>,
) -> Result<(), String> {
    sqlx::query("DELETE FROM watch_history")
        .execute(state.database.pool())
        .await
        .map_err(|e| format!("Failed to clear watch history: {}", e))?;

    log::debug!("Cleared watch history");
    Ok(())
}

/// Clear all library entries
#[tauri::command]
pub async fn clear_library(
    state: State<'_, AppState>,
) -> Result<(), String> {
    sqlx::query("DELETE FROM library")
        .execute(state.database.pool())
        .await
        .map_err(|e| format!("Failed to clear library: {}", e))?;

    log::debug!("Cleared library");
    Ok(())
}

/// Clear all data (watch history, library, media cache)
#[tauri::command]
pub async fn clear_all_data(
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Clear all tables
    let tables = vec!["watch_history", "library", "media"];

    for table in tables {
        sqlx::query(&format!("DELETE FROM {}", table))
            .execute(state.database.pool())
            .await
            .map_err(|e| format!("Failed to clear {}: {}", table, e))?;
    }

    // Optimize database after clearing
    state.database.optimize()
        .await
        .map_err(|e| format!("Failed to optimize database: {}", e))?;

    log::debug!("Cleared all data");
    Ok(())
}

#[derive(serde::Serialize)]
pub struct StorageUsage {
    database_size: u64,
    downloads_size: u64,
    total_size: u64,
}

/// Get storage usage information
#[tauri::command]
pub async fn get_storage_usage(
    state: State<'_, AppState>,
    download_manager: State<'_, DownloadManager>,
) -> Result<StorageUsage, String> {
    let database_size = state.database.get_database_size()
        .await
        .map_err(|e| format!("Failed to get database size: {}", e))?;

    let downloads_size = download_manager.get_total_storage_used().await;

    Ok(StorageUsage {
        database_size,
        downloads_size,
        total_size: database_size + downloads_size,
    })
}

// ==================== Video Server Commands ====================

#[derive(serde::Serialize)]
pub struct VideoServerUrls {
    pub local_base_url: String,
    pub proxy_base_url: String,
    pub token: String,
    pub port: u16,
}

/// Get video server info for streaming
#[tauri::command]
pub async fn get_video_server_info(
    video_server: State<'_, VideoServerInfo>,
) -> Result<VideoServerUrls, String> {
    Ok(VideoServerUrls {
        local_base_url: format!("http://127.0.0.1:{}/local", video_server.port),
        proxy_base_url: format!("http://127.0.0.1:{}/proxy", video_server.port),
        token: video_server.access_token.clone(),
        port: video_server.port,
    })
}

/// Get streaming URL for a local downloaded file
#[tauri::command]
pub async fn get_local_video_url(
    video_server: State<'_, VideoServerInfo>,
    filename: String,
) -> Result<String, String> {
    Ok(video_server.local_url(&filename))
}

/// Get proxy URL for a remote video
#[tauri::command]
pub async fn get_proxy_video_url(
    video_server: State<'_, VideoServerInfo>,
    url: String,
) -> Result<String, String> {
    Ok(video_server.proxy_url(&url))
}

// ==================== System Stats Commands ====================

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

/// Event names for streaming
pub const SYSTEM_STATS_EVENT: &str = "system-stats";
pub const APP_LOGS_EVENT: &str = "app-logs";

/// Global flags for streaming control
static STATS_STREAMING: AtomicBool = AtomicBool::new(false);
static LOGS_STREAMING: AtomicBool = AtomicBool::new(false);

/// System statistics for developer debugging
#[derive(serde::Serialize, Clone)]
pub struct SystemStats {
    // Memory (in bytes)
    pub memory_used: u64,
    pub memory_total: u64,
    pub memory_percent: f32,

    // CPU (percentage)
    pub cpu_usage: f32,
    pub cpu_count: usize,

    // Process-specific
    pub process_memory: u64,
    pub process_cpu: f32,
    pub thread_count: usize,

    // Storage
    pub disk_used: u64,
    pub disk_total: u64,
    pub disk_percent: f32,
}

/// Get real-time system statistics for developer debugging
#[tauri::command]
pub async fn get_system_stats() -> Result<SystemStats, String> {
    use sysinfo::{System, Pid, Disks};

    // Create system info instance and refresh relevant data
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All);

    // Get CPU usage (average across all cores)
    // Note: First call returns 0, subsequent calls show actual usage
    let cpu_usage = sys.cpus().iter()
        .map(|cpu| cpu.cpu_usage())
        .sum::<f32>() / sys.cpus().len().max(1) as f32;

    let cpu_count = sys.cpus().len();

    // Get memory stats
    let memory_total = sys.total_memory();
    let memory_used = sys.used_memory();
    let memory_percent = if memory_total > 0 {
        (memory_used as f32 / memory_total as f32) * 100.0
    } else {
        0.0
    };

    // Get current process stats
    let current_pid = Pid::from_u32(std::process::id());
    let (process_memory, process_cpu, thread_count) = if let Some(process) = sys.process(current_pid) {
        (
            process.memory(),
            process.cpu_usage(),
            // Thread count from /proc/self/stat or platform equivalent
            std::thread::available_parallelism()
                .map(|p| p.get())
                .unwrap_or(1)
        )
    } else {
        (0, 0.0, 1)
    };

    // Get disk stats (primary disk)
    let disks = Disks::new_with_refreshed_list();
    let (disk_used, disk_total) = disks.iter()
        .find(|d| d.mount_point() == std::path::Path::new("/"))
        .or_else(|| disks.first())
        .map(|d| {
            let total = d.total_space();
            let available = d.available_space();
            let used = total.saturating_sub(available);
            (used, total)
        })
        .unwrap_or((0, 0));

    let disk_percent = if disk_total > 0 {
        (disk_used as f32 / disk_total as f32) * 100.0
    } else {
        0.0
    };

    Ok(SystemStats {
        memory_used,
        memory_total,
        memory_percent,
        cpu_usage,
        cpu_count,
        process_memory,
        process_cpu,
        thread_count,
        disk_used,
        disk_total,
        disk_percent,
    })
}

/// Start streaming system stats via events (emits every second)
#[tauri::command]
pub async fn start_stats_stream(app: tauri::AppHandle) -> Result<(), String> {
    // Check if already streaming
    if STATS_STREAMING.swap(true, Ordering::SeqCst) {
        return Ok(()); // Already streaming
    }

    tokio::spawn(async move {
        use sysinfo::{System, Pid, Disks};

        while STATS_STREAMING.load(Ordering::SeqCst) {
            // Collect stats
            let mut sys = System::new();
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            sys.refresh_processes(sysinfo::ProcessesToUpdate::All);

            let cpu_usage = sys.cpus().iter()
                .map(|cpu| cpu.cpu_usage())
                .sum::<f32>() / sys.cpus().len().max(1) as f32;

            let cpu_count = sys.cpus().len();
            let memory_total = sys.total_memory();
            let memory_used = sys.used_memory();
            let memory_percent = if memory_total > 0 {
                (memory_used as f32 / memory_total as f32) * 100.0
            } else {
                0.0
            };

            let current_pid = Pid::from_u32(std::process::id());
            let (process_memory, process_cpu, thread_count) = if let Some(process) = sys.process(current_pid) {
                (
                    process.memory(),
                    process.cpu_usage(),
                    std::thread::available_parallelism()
                        .map(|p| p.get())
                        .unwrap_or(1)
                )
            } else {
                (0, 0.0, 1)
            };

            let disks = Disks::new_with_refreshed_list();
            let (disk_used, disk_total) = disks.iter()
                .find(|d| d.mount_point() == std::path::Path::new("/"))
                .or_else(|| disks.first())
                .map(|d| {
                    let total = d.total_space();
                    let available = d.available_space();
                    let used = total.saturating_sub(available);
                    (used, total)
                })
                .unwrap_or((0, 0));

            let disk_percent = if disk_total > 0 {
                (disk_used as f32 / disk_total as f32) * 100.0
            } else {
                0.0
            };

            let stats = SystemStats {
                memory_used,
                memory_total,
                memory_percent,
                cpu_usage,
                cpu_count,
                process_memory,
                process_cpu,
                thread_count,
                disk_used,
                disk_total,
                disk_percent,
            };

            // Emit event
            if let Err(e) = app.emit(SYSTEM_STATS_EVENT, &stats) {
                log::error!("Failed to emit stats event: {}", e);
            }

            // Wait 1 second before next update
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        }
    });

    Ok(())
}

/// Stop streaming system stats
#[tauri::command]
pub async fn stop_stats_stream() -> Result<(), String> {
    STATS_STREAMING.store(false, Ordering::SeqCst);
    Ok(())
}

// ==================== Log Commands ====================

/// Log entry structure
#[derive(serde::Serialize, Clone)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

/// Get application logs for debugging
#[tauri::command]
pub async fn get_app_logs(
    app: tauri::AppHandle,
    lines: Option<usize>,
) -> Result<Vec<LogEntry>, String> {
    use std::io::{BufRead, BufReader};
    use std::fs::File;

    // Get log directory
    let log_dir = app.path().app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    let log_file = log_dir.join("otaku.log");

    if !log_file.exists() {
        return Ok(vec![]);
    }

    let file = File::open(&log_file)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    let reader = BufReader::new(file);
    let all_lines: Vec<String> = reader.lines()
        .filter_map(|l| l.ok())
        .collect();

    // Take last N lines (default 100)
    let limit = lines.unwrap_or(100);
    let start = all_lines.len().saturating_sub(limit);
    let recent_lines = &all_lines[start..];

    // Parse log entries
    let entries: Vec<LogEntry> = recent_lines.iter()
        .map(|line| {
            // Try to parse structured log format: [TIMESTAMP][LEVEL] message
            // Or just treat as message if unparseable
            if let Some(bracket_end) = line.find(']') {
                let timestamp = line[1..bracket_end].to_string();
                let rest = &line[bracket_end + 1..];

                if let Some(level_end) = rest.find(']') {
                    let level = rest[1..level_end].to_string();
                    let message = rest[level_end + 1..].trim().to_string();
                    return LogEntry { timestamp, level, message };
                }
            }

            LogEntry {
                timestamp: String::new(),
                level: "INFO".to_string(),
                message: line.clone(),
            }
        })
        .collect();

    Ok(entries)
}

/// Clear application logs
#[tauri::command]
pub async fn clear_app_logs(app: tauri::AppHandle) -> Result<(), String> {
    let log_dir = app.path().app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    let log_file = log_dir.join("otaku.log");

    if log_file.exists() {
        std::fs::write(&log_file, "")
            .map_err(|e| format!("Failed to clear log file: {}", e))?;
    }

    Ok(())
}

/// Get log file path
#[tauri::command]
pub async fn get_log_file_path(app: tauri::AppHandle) -> Result<String, String> {
    let log_dir = app.path().app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    let log_file = log_dir.join("otaku.log");
    Ok(log_file.to_string_lossy().to_string())
}

/// Start streaming logs via events (emits every 2 seconds)
#[tauri::command]
pub async fn start_logs_stream(app: tauri::AppHandle) -> Result<(), String> {
    use std::sync::atomic::AtomicUsize;

    // Check if already streaming
    if LOGS_STREAMING.swap(true, Ordering::SeqCst) {
        return Ok(()); // Already streaming
    }

    // Track last known line count to detect new logs
    static LAST_LINE_COUNT: AtomicUsize = AtomicUsize::new(0);

    tokio::spawn(async move {
        use std::io::{BufRead, BufReader};
        use std::fs::File;

        let log_dir = match app.path().app_log_dir() {
            Ok(dir) => dir,
            Err(e) => {
                log::error!("Failed to get log directory: {}", e);
                LOGS_STREAMING.store(false, Ordering::SeqCst);
                return;
            }
        };
        let log_file = log_dir.join("otaku.log");

        while LOGS_STREAMING.load(Ordering::SeqCst) {
            if log_file.exists() {
                if let Ok(file) = File::open(&log_file) {
                    let reader = BufReader::new(file);
                    let all_lines: Vec<String> = reader.lines()
                        .filter_map(|l| l.ok())
                        .collect();

                    let current_count = all_lines.len();
                    let last_count = LAST_LINE_COUNT.load(Ordering::SeqCst);

                    // Only emit if there are new logs or first run
                    if current_count != last_count || last_count == 0 {
                        LAST_LINE_COUNT.store(current_count, Ordering::SeqCst);

                        // Get last 100 lines
                        let start = current_count.saturating_sub(100);
                        let recent_lines = &all_lines[start..];

                        let entries: Vec<LogEntry> = recent_lines.iter()
                            .map(|line| {
                                if let Some(bracket_end) = line.find(']') {
                                    let timestamp = line[1..bracket_end].to_string();
                                    let rest = &line[bracket_end + 1..];

                                    if let Some(level_end) = rest.find(']') {
                                        let level = rest[1..level_end].to_string();
                                        let message = rest[level_end + 1..].trim().to_string();
                                        return LogEntry { timestamp, level, message };
                                    }
                                }
                                LogEntry {
                                    timestamp: String::new(),
                                    level: "INFO".to_string(),
                                    message: line.clone(),
                                }
                            })
                            .collect();

                        if let Err(e) = app.emit(APP_LOGS_EVENT, &entries) {
                            log::error!("Failed to emit logs event: {}", e);
                        }
                    }
                }
            }

            // Wait 2 seconds before checking again
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
    });

    Ok(())
}

/// Stop streaming logs
#[tauri::command]
pub async fn stop_logs_stream() -> Result<(), String> {
    LOGS_STREAMING.store(false, Ordering::SeqCst);
    Ok(())
}

// ==================== Chapter Download Commands ====================

/// Start downloading a manga chapter
#[tauri::command]
pub async fn start_chapter_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    download_manager: State<'_, DownloadManager>,
    media_id: String,
    media_title: String,
    chapter_id: String,
    chapter_number: f64,
    image_urls: Vec<String>,
) -> Result<String, String> {
    // Use the same downloads directory as anime downloads
    let downloads_dir = PathBuf::from(download_manager.get_downloads_directory());

    chapter_downloads::start_chapter_download(
        state.database.pool(),
        app,
        downloads_dir,
        &media_id,
        &media_title,
        &chapter_id,
        chapter_number,
        image_urls,
    )
    .await
    .map_err(|e| format!("Failed to start chapter download: {}", e))
}

/// Get chapter download progress
#[tauri::command]
pub async fn get_chapter_download_progress(
    state: State<'_, AppState>,
    download_id: String,
) -> Result<Option<chapter_downloads::ChapterDownloadProgress>, String> {
    chapter_downloads::get_chapter_download_progress(state.database.pool(), &download_id)
        .await
        .map_err(|e| format!("Failed to get chapter download progress: {}", e))
}

/// Check if a chapter is downloaded
#[tauri::command]
pub async fn is_chapter_downloaded(
    state: State<'_, AppState>,
    media_id: String,
    chapter_id: String,
) -> Result<bool, String> {
    chapter_downloads::is_chapter_downloaded(state.database.pool(), &media_id, &chapter_id)
        .await
        .map_err(|e| format!("Failed to check chapter download status: {}", e))
}

/// Get downloaded chapter images (local paths)
#[tauri::command]
pub async fn get_downloaded_chapter_images(
    state: State<'_, AppState>,
    media_id: String,
    chapter_id: String,
) -> Result<Vec<String>, String> {
    chapter_downloads::get_downloaded_chapter_images(state.database.pool(), &media_id, &chapter_id)
        .await
        .map_err(|e| format!("Failed to get downloaded chapter images: {}", e))
}

/// Delete a chapter download
#[tauri::command]
pub async fn delete_chapter_download(
    state: State<'_, AppState>,
    media_id: String,
    chapter_id: String,
) -> Result<(), String> {
    chapter_downloads::delete_chapter_download(state.database.pool(), &media_id, &chapter_id)
        .await
        .map_err(|e| format!("Failed to delete chapter download: {}", e))
}

/// List all chapter downloads for a manga
#[tauri::command]
pub async fn list_chapter_downloads(
    state: State<'_, AppState>,
    media_id: String,
) -> Result<Vec<chapter_downloads::ChapterDownloadProgress>, String> {
    chapter_downloads::list_chapter_downloads(state.database.pool(), &media_id)
        .await
        .map_err(|e| format!("Failed to list chapter downloads: {}", e))
}

/// Get all downloaded manga with chapter counts
#[tauri::command]
pub async fn get_downloaded_manga(
    state: State<'_, AppState>,
) -> Result<Vec<chapter_downloads::DownloadedManga>, String> {
    chapter_downloads::get_all_downloaded_manga(state.database.pool())
        .await
        .map_err(|e| format!("Failed to get downloaded manga: {}", e))
}

/// List ALL chapter downloads across all manga (for Download Manager)
#[tauri::command]
pub async fn list_all_chapter_downloads(
    state: State<'_, AppState>,
) -> Result<Vec<chapter_downloads::ChapterDownloadWithTitle>, String> {
    chapter_downloads::list_all_chapter_downloads(state.database.pool())
        .await
        .map_err(|e| format!("Failed to list all chapter downloads: {}", e))
}
