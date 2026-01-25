// Tauri Commands - IPC interface for frontend
//
// Exposes backend functionality to the frontend via Tauri's command system.
// All commands are async and return Results for error handling.
//
// NOTE: For MVP, we create runtimes on-demand rather than storing them globally
// due to QuickJS's thread-safety limitations. In production, we'd use a thread-local
// runtime pool.

use crate::extensions::{Extension, ExtensionMetadata, ExtensionRuntime, MediaDetails, SearchResults, VideoSources};
use std::sync::Mutex;
use tauri::State;

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

/// Load an extension from JavaScript code
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

    extensions.push(extension);

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
