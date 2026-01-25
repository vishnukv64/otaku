// Tauri Commands - IPC interface for frontend
//
// Exposes backend functionality to the frontend via Tauri's command system.
// All commands are async and return Results for error handling.
//
// NOTE: For MVP, we create runtimes on-demand rather than storing them globally
// due to QuickJS's thread-safety limitations. In production, we'd use a thread-local
// runtime pool.

use crate::extensions::{Extension, ExtensionMetadata, ExtensionRuntime, MediaDetails, SearchResults, VideoSources};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::{State, AppHandle};

/// Download progress information
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub id: String,
    pub filename: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub percentage: f32,
    pub status: DownloadStatus,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

/// Download manager state
pub struct DownloadManager {
    pub downloads: Arc<Mutex<HashMap<String, DownloadProgress>>>,
}

/// Global state for loaded extensions (stores just the code, not runtimes)
pub struct AppState {
    pub extensions: Mutex<Vec<Extension>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            extensions: Mutex::new(Vec::new()),
        }
    }
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            downloads: Arc::new(Mutex::new(HashMap::new())),
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
    _app_handle: AppHandle,
    url: String,
    filename: String,
    anime_title: String,
    episode_number: f32,
) -> Result<String, String> {
    let download_id = format!("{}_{}", anime_title.replace(' ', "_"), episode_number);

    log::info!("Starting download: {} ({})", filename, download_id);

    // Initialize download progress
    {
        let mut downloads = download_manager.downloads.lock()
            .map_err(|e| format!("Failed to lock downloads: {}", e))?;

        downloads.insert(download_id.clone(), DownloadProgress {
            id: download_id.clone(),
            filename: filename.clone(),
            total_bytes: 0,
            downloaded_bytes: 0,
            percentage: 0.0,
            status: DownloadStatus::Queued,
        });
    }

    // Spawn download task
    let download_id_clone = download_id.clone();
    let downloads_arc = download_manager.downloads.clone();

    tauri::async_runtime::spawn(async move {
        // Update status to downloading
        {
            if let Ok(mut downloads) = downloads_arc.lock() {
                if let Some(progress) = downloads.get_mut(&download_id_clone) {
                    progress.status = DownloadStatus::Downloading;
                }
            }
        }

        // Perform download
        match perform_download(&url, &filename, &download_id_clone, downloads_arc.clone()).await {
            Ok(_) => {
                log::info!("Download completed: {}", download_id_clone);
                if let Ok(mut downloads) = downloads_arc.lock() {
                    if let Some(progress) = downloads.get_mut(&download_id_clone) {
                        progress.status = DownloadStatus::Completed;
                        progress.percentage = 100.0;
                    }
                }
            }
            Err(e) => {
                log::error!("Download failed: {} - {}", download_id_clone, e);
                if let Ok(mut downloads) = downloads_arc.lock() {
                    if let Some(progress) = downloads.get_mut(&download_id_clone) {
                        progress.status = DownloadStatus::Failed;
                    }
                }
            }
        }
    });

    Ok(download_id)
}

/// Get download progress
#[tauri::command]
pub async fn get_download_progress(
    download_manager: State<'_, DownloadManager>,
    download_id: String,
) -> Result<DownloadProgress, String> {
    let downloads = download_manager.downloads.lock()
        .map_err(|e| format!("Failed to lock downloads: {}", e))?;

    downloads.get(&download_id)
        .cloned()
        .ok_or_else(|| format!("Download not found: {}", download_id))
}

/// List all downloads
#[tauri::command]
pub async fn list_downloads(
    download_manager: State<'_, DownloadManager>,
) -> Result<Vec<DownloadProgress>, String> {
    let downloads = download_manager.downloads.lock()
        .map_err(|e| format!("Failed to lock downloads: {}", e))?;

    Ok(downloads.values().cloned().collect())
}

/// Cancel a download
#[tauri::command]
pub async fn cancel_download(
    download_manager: State<'_, DownloadManager>,
    download_id: String,
) -> Result<(), String> {
    let mut downloads = download_manager.downloads.lock()
        .map_err(|e| format!("Failed to lock downloads: {}", e))?;

    if let Some(progress) = downloads.get_mut(&download_id) {
        if progress.status == DownloadStatus::Downloading || progress.status == DownloadStatus::Queued {
            progress.status = DownloadStatus::Cancelled;
        }
    }

    Ok(())
}

/// Perform the actual download
async fn perform_download(
    url: &str,
    filename: &str,
    download_id: &str,
    downloads: Arc<Mutex<HashMap<String, DownloadProgress>>>,
) -> Result<(), String> {
    use std::io::Read;
    use std::fs::File;
    use std::io::Write;

    // Get downloads directory
    let downloads_dir = dirs::download_dir()
        .ok_or_else(|| "Could not find downloads directory".to_string())?;

    let otaku_dir = downloads_dir.join("Otaku");
    std::fs::create_dir_all(&otaku_dir)
        .map_err(|e| format!("Failed to create Otaku directory: {}", e))?;

    let file_path = otaku_dir.join(filename);

    log::info!("Downloading to: {:?}", file_path);

    // Make HTTP request
    let response = ureq::get(url)
        .set("Referer", "https://allmanga.to")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0")
        .call()
        .map_err(|e| format!("Request failed: {}", e))?;

    let total_bytes = response.header("Content-Length")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    // Update total bytes
    {
        if let Ok(mut downloads_lock) = downloads.lock() {
            if let Some(progress) = downloads_lock.get_mut(download_id) {
                progress.total_bytes = total_bytes;
            }
        }
    }

    // Create file
    let mut file = File::create(&file_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    // Download in chunks
    let mut reader = response.into_reader();
    let mut buffer = vec![0; 8192]; // 8KB chunks
    let mut downloaded = 0u64;

    loop {
        // Check if download was cancelled
        {
            if let Ok(downloads_lock) = downloads.lock() {
                if let Some(progress) = downloads_lock.get(download_id) {
                    if progress.status == DownloadStatus::Cancelled {
                        log::info!("Download cancelled: {}", download_id);
                        std::fs::remove_file(&file_path).ok();
                        return Err("Download cancelled".to_string());
                    }
                }
            }
        }

        let bytes_read = reader.read(&mut buffer)
            .map_err(|e| format!("Failed to read chunk: {}", e))?;

        if bytes_read == 0 {
            break; // EOF
        }

        file.write_all(&buffer[..bytes_read])
            .map_err(|e| format!("Failed to write to file: {}", e))?;

        downloaded += bytes_read as u64;

        // Update progress
        {
            if let Ok(mut downloads_lock) = downloads.lock() {
                if let Some(progress) = downloads_lock.get_mut(download_id) {
                    progress.downloaded_bytes = downloaded;
                    if total_bytes > 0 {
                        progress.percentage = (downloaded as f32 / total_bytes as f32) * 100.0;
                    }
                }
            }
        }
    }

    file.flush().map_err(|e| format!("Failed to flush file: {}", e))?;

    log::info!("Download completed: {} ({} bytes)", filename, downloaded);
    Ok(())
}
