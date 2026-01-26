// Tauri Commands - IPC interface for frontend
//
// Exposes backend functionality to the frontend via Tauri's command system.
// All commands are async and return Results for error handling.
//
// NOTE: For MVP, we create runtimes on-demand rather than storing them globally
// due to QuickJS's thread-safety limitations. In production, we'd use a thread-local
// runtime pool.

use crate::extensions::{Extension, ExtensionMetadata, ExtensionRuntime, MediaDetails, SearchResults, VideoSources};
use crate::database::Database;
use crate::downloads::{DownloadManager, DownloadProgress};
use std::sync::{Arc, Mutex};
use tauri::State;
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

    log::info!("Loaded extension: {} v{}", metadata.name, metadata.version);

    Ok(metadata)
}

/// Search for anime using a specific extension
#[tauri::command]
pub async fn search_anime(
    state: State<'_, AppState>,
    extension_id: String,
    query: String,
    page: u32,
) -> Result<SearchResults, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    // Release lock before creating runtime
    drop(extensions);

    // Create runtime on-demand (not ideal for performance, but works for MVP)
    let runtime = ExtensionRuntime::new(extension)
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
) -> Result<SearchResults, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::new(extension)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.discover(page, sort_type, genres)
        .map_err(|e| format!("Discover failed: {}", e))
}

/// Get anime recommendations (trending/latest)
#[tauri::command]
pub async fn get_recommendations(
    state: State<'_, AppState>,
    extension_id: String,
) -> Result<SearchResults, String> {
    let extensions = state.extensions.lock()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension = extensions.iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("Extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::new(extension)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    runtime.get_recommendations()
        .map_err(|e| format!("Get recommendations failed: {}", e))
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

/// Proxy video request to avoid CORS issues
/// Returns the response body as bytes
#[tauri::command]
pub async fn proxy_video_request(
    url: String,
    range: Option<String>,
) -> Result<Vec<u8>, String> {
    log::info!("Proxying video request: {} (range: {:?})", &url[..url.len().min(100)], range);

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
            let mut bytes = Vec::new();
            response.into_reader()
                .take(100_000_000) // 100MB limit
                .read_to_end(&mut bytes)
                .map_err(|e| format!("Failed to read response: {}", e))?;

            log::info!("Proxy success: {} bytes", bytes.len());
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
    log::info!("Proxying HLS playlist: {}", &url[..url.len().min(100)]);

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
            log::info!("Playlist response status: {}, Content-Type: {}", status, content_type);

            // Try to read as bytes first
            let mut bytes = Vec::new();
            response.into_reader()
                .take(10_000_000) // 10MB limit
                .read_to_end(&mut bytes)
                .map_err(|e| format!("Failed to read response: {}", e))?;

            log::info!("Response size: {} bytes", bytes.len());

            // Try to parse as UTF-8 text (m3u8 playlist)
            match String::from_utf8(bytes) {
                Ok(playlist) => {
                    log::info!("Successfully parsed as UTF-8 playlist, first 200 chars: {}",
                        &playlist[..playlist.len().min(200)]);

                    // Check if it looks like an m3u8 playlist
                    if playlist.contains("#EXTM3U") || playlist.contains("#EXT-X-") {
                        // Rewrite relative URLs in the playlist to absolute URLs
                        let base_url = extract_base_url(&url);
                        let rewritten = rewrite_playlist_urls(&playlist, &base_url);
                        log::info!("Playlist proxy success: {} chars", rewritten.len());
                        Ok(rewritten)
                    } else {
                        // It's text but not an m3u8 playlist
                        log::warn!("Response is text but not an m3u8 playlist");
                        Ok(playlist)
                    }
                }
                Err(_) => {
                    // Not UTF-8 - this is likely a binary video file
                    log::error!("Response is not UTF-8 text - likely a binary video file, not an HLS playlist");
                    Err(format!("URL does not point to an HLS playlist (got binary data). Content-Type: {}. This URL might be a direct video file.", content_type))
                }
            }
        }
        Err(e) => {
            log::error!("Playlist proxy error for URL {}: {:?}", &url[..url.len().min(100)], e);
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

    log::info!("Starting download: {} ({})", filename, download_id);

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

    log::info!("Cleared all watch history");
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

    log::info!("Cleared all library entries");
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

    log::info!("Cleared all data");
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
