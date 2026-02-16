use crate::commands::AppState;
use crate::extensions::types::*;
use super::{anime, bridge, manga};
use tauri::State;

// --- Anime Commands ---

#[tauri::command]
pub async fn jikan_search_anime(
    query: String,
    page: i32,
    sfw: bool,
) -> Result<SearchResults, String> {
    tokio::task::spawn_blocking(move || anime::search_anime(&query, page, sfw))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_top_anime(
    page: i32,
    type_filter: Option<String>,
    filter: Option<String>,
    sfw: bool,
) -> Result<SearchResults, String> {
    tokio::task::spawn_blocking(move || {
        anime::top_anime(page, type_filter.as_deref(), filter.as_deref(), sfw)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_season_now(page: i32, sfw: bool) -> Result<SearchResults, String> {
    tokio::task::spawn_blocking(move || anime::season_now(page, sfw))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_season(
    year: i32,
    season: String,
    page: i32,
    sfw: bool,
) -> Result<SearchResults, String> {
    tokio::task::spawn_blocking(move || anime::season(year, &season, page, sfw))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_season_upcoming(page: i32, sfw: bool) -> Result<SearchResults, String> {
    tokio::task::spawn_blocking(move || anime::season_upcoming(page, sfw))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_watch_episodes_popular() -> Result<SearchResults, String> {
    tokio::task::spawn_blocking(move || anime::watch_episodes_popular())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_anime_details(mal_id: i64) -> Result<MediaDetails, String> {
    tokio::task::spawn_blocking(move || anime::anime_details(mal_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_anime_episodes(mal_id: i64, page: i32) -> Result<(Vec<Episode>, bool), String> {
    tokio::task::spawn_blocking(move || anime::anime_episodes(mal_id, page))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_anime_recommendations(mal_id: i64) -> Result<SearchResults, String> {
    tokio::task::spawn_blocking(move || anime::anime_recommendations(mal_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_genres_anime() -> Result<TagsResult, String> {
    tokio::task::spawn_blocking(anime::genres_anime)
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_schedules(
    day: Option<String>,
    page: i32,
    sfw: bool,
) -> Result<SearchResults, String> {
    tokio::task::spawn_blocking(move || anime::schedules(day.as_deref(), page, sfw))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_random_anime() -> Result<SearchResult, String> {
    tokio::task::spawn_blocking(anime::random_anime)
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

// --- Manga Commands ---

#[tauri::command]
pub async fn jikan_search_manga(
    query: String,
    page: i32,
    sfw: bool,
) -> Result<SearchResults, String> {
    tokio::task::spawn_blocking(move || manga::search_manga(&query, page, sfw))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_top_manga(
    page: i32,
    type_filter: Option<String>,
    filter: Option<String>,
    sfw: bool,
) -> Result<SearchResults, String> {
    tokio::task::spawn_blocking(move || {
        manga::top_manga(page, type_filter.as_deref(), filter.as_deref(), sfw)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_manga_details(mal_id: i64) -> Result<MangaDetails, String> {
    tokio::task::spawn_blocking(move || manga::manga_details(mal_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_genres_manga() -> Result<TagsResult, String> {
    tokio::task::spawn_blocking(manga::genres_manga)
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

// --- Bridge Command ---

#[tauri::command]
pub async fn resolve_allanime_id(
    state: State<'_, AppState>,
    title: String,
    english_title: Option<String>,
    media_type: String,
    year: Option<i32>,
    mal_id: String,
) -> Result<Option<String>, String> {
    // Check cache first
    let pool = state.database.pool();
    if let Some(cached) = bridge::get_cached_mapping(pool, &mal_id).await? {
        return Ok(Some(cached));
    }

    let title_clone = title.clone();
    let mal_clone = mal_id.clone();
    let media_for_search = media_type.clone();
    let media_for_cache = media_type.clone();

    // Search AllAnime directly using inline GraphQL (no extension needed)
    let result = tokio::task::spawn_blocking(move || {
        bridge::resolve_via_search(
            &title_clone,
            english_title.as_deref(),
            year,
            &media_for_search,
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    // Cache the result
    if let Some(ref allanime_id) = result {
        bridge::save_mapping(pool, &mal_clone, allanime_id, &media_for_cache, &title).await?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn clear_allanime_mapping(
    state: State<'_, AppState>,
    mal_id: String,
) -> Result<(), String> {
    let pool = state.database.pool();
    bridge::delete_cached_mapping(pool, &mal_id).await
}
