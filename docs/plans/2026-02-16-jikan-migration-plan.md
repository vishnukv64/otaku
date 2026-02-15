# Jikan API Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace AllAnime as primary metadata source with Jikan (MyAnimeList) REST API, keeping AllAnime for video/manga streaming only.

**Architecture:** New `src-tauri/src/jikan/` Rust module with direct HTTP client, rate limiter, and serde-based response parsing. Maps Jikan responses to existing app types (`SearchResult`, `MediaDetails`, etc.). AllAnime retained for `getSources`/`getChapterImages` via a search-based ID bridge.

**Tech Stack:** Rust (ureq, serde, tokio), TypeScript/React, SQLite (sqlx), Tauri 2 IPC

**Design Doc:** `docs/plans/2026-02-16-jikan-migration-design.md`

---

## Phase 1: Rust Backend — Jikan Client

### Task 1: Create Jikan Types Module

**Files:**
- Create: `src-tauri/src/jikan/mod.rs`
- Create: `src-tauri/src/jikan/types.rs`

**Context:** These serde structs parse Jikan API JSON responses. They are intermediate types — we map them to the existing app types (`SearchResult`, `MediaDetails`, etc.) in later tasks. Jikan uses `snake_case` in JSON but some fields need `#[serde(rename)]`.

**Step 1: Create the jikan module directory and mod.rs**

```rust
// src-tauri/src/jikan/mod.rs
pub mod types;
pub mod client;
pub mod anime;
pub mod manga;
pub mod commands;
pub mod bridge;
```

**Step 2: Create types.rs with all Jikan serde structs**

```rust
// src-tauri/src/jikan/types.rs
use serde::{Deserialize, Serialize};

/// Wraps single-item responses: { "data": T }
#[derive(Debug, Deserialize)]
pub struct JikanResponse<T> {
    pub data: T,
}

/// Wraps paginated list responses: { "data": [T], "pagination": {...} }
#[derive(Debug, Deserialize)]
pub struct JikanPaginatedResponse<T> {
    pub data: Vec<T>,
    pub pagination: JikanPagination,
}

#[derive(Debug, Deserialize)]
pub struct JikanPagination {
    pub last_visible_page: i32,
    pub has_next_page: bool,
    pub current_page: Option<i32>,
    pub items: Option<JikanPaginationItems>,
}

#[derive(Debug, Deserialize)]
pub struct JikanPaginationItems {
    pub count: i32,
    pub total: i32,
    pub per_page: i32,
}

// --- Image types ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanImages {
    pub jpg: Option<JikanImageSet>,
    pub webp: Option<JikanImageSet>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanImageSet {
    pub image_url: Option<String>,
    pub small_image_url: Option<String>,
    pub large_image_url: Option<String>,
}

// --- Trailer ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanTrailer {
    pub youtube_id: Option<String>,
    pub url: Option<String>,
    pub embed_url: Option<String>,
}

// --- Common entry reference (used in genres, studios, producers, etc.) ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanMalEntry {
    pub mal_id: i64,
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub name: String,
    pub url: Option<String>,
}

// --- Title ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanTitle {
    #[serde(rename = "type")]
    pub title_type: String,
    pub title: String,
}

// --- Aired/Published dates ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanDateRange {
    pub from: Option<String>,
    pub to: Option<String>,
    pub prop: Option<JikanDateProp>,
    pub string: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanDateProp {
    pub from: Option<JikanDateComponents>,
    pub to: Option<JikanDateComponents>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanDateComponents {
    pub day: Option<i32>,
    pub month: Option<i32>,
    pub year: Option<i32>,
}

// --- Broadcast ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanBroadcast {
    pub day: Option<String>,
    pub time: Option<String>,
    pub timezone: Option<String>,
    pub string: Option<String>,
}

// --- Relations ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanRelation {
    pub relation: String,
    pub entry: Vec<JikanMalEntry>,
}

// --- External/Streaming links ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanExternalLink {
    pub name: String,
    pub url: String,
}

// --- Anime ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanAnime {
    pub mal_id: i64,
    pub url: Option<String>,
    pub images: JikanImages,
    pub trailer: Option<JikanTrailer>,
    pub approved: Option<bool>,
    pub titles: Option<Vec<JikanTitle>>,
    pub title: String,
    pub title_english: Option<String>,
    pub title_japanese: Option<String>,
    pub title_synonyms: Option<Vec<String>>,
    #[serde(rename = "type")]
    pub anime_type: Option<String>,
    pub source: Option<String>,
    pub episodes: Option<i32>,
    pub status: Option<String>,
    pub airing: Option<bool>,
    pub aired: Option<JikanDateRange>,
    pub duration: Option<String>,
    pub rating: Option<String>,
    pub score: Option<f64>,
    pub scored_by: Option<i64>,
    pub rank: Option<i32>,
    pub popularity: Option<i32>,
    pub members: Option<i64>,
    pub favorites: Option<i64>,
    pub synopsis: Option<String>,
    pub background: Option<String>,
    pub season: Option<String>,
    pub year: Option<i32>,
    pub broadcast: Option<JikanBroadcast>,
    pub producers: Option<Vec<JikanMalEntry>>,
    pub licensors: Option<Vec<JikanMalEntry>>,
    pub studios: Option<Vec<JikanMalEntry>>,
    pub genres: Option<Vec<JikanMalEntry>>,
    pub explicit_genres: Option<Vec<JikanMalEntry>>,
    pub themes: Option<Vec<JikanMalEntry>>,
    pub demographics: Option<Vec<JikanMalEntry>>,
    // /full only
    pub relations: Option<Vec<JikanRelation>>,
    pub theme: Option<JikanAnimeTheme>,
    pub external: Option<Vec<JikanExternalLink>>,
    pub streaming: Option<Vec<JikanExternalLink>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanAnimeTheme {
    pub openings: Option<Vec<String>>,
    pub endings: Option<Vec<String>>,
}

// --- Manga ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanManga {
    pub mal_id: i64,
    pub url: Option<String>,
    pub images: JikanImages,
    pub approved: Option<bool>,
    pub titles: Option<Vec<JikanTitle>>,
    pub title: String,
    pub title_english: Option<String>,
    pub title_japanese: Option<String>,
    pub title_synonyms: Option<Vec<String>>,
    #[serde(rename = "type")]
    pub manga_type: Option<String>,
    pub chapters: Option<i32>,
    pub volumes: Option<i32>,
    pub status: Option<String>,
    pub publishing: Option<bool>,
    pub published: Option<JikanDateRange>,
    pub score: Option<f64>,
    pub scored_by: Option<i64>,
    pub rank: Option<i32>,
    pub popularity: Option<i32>,
    pub members: Option<i64>,
    pub favorites: Option<i64>,
    pub synopsis: Option<String>,
    pub background: Option<String>,
    pub authors: Option<Vec<JikanMalEntry>>,
    pub serializations: Option<Vec<JikanMalEntry>>,
    pub genres: Option<Vec<JikanMalEntry>>,
    pub explicit_genres: Option<Vec<JikanMalEntry>>,
    pub themes: Option<Vec<JikanMalEntry>>,
    pub demographics: Option<Vec<JikanMalEntry>>,
    // /full only
    pub relations: Option<Vec<JikanRelation>>,
    pub external: Option<Vec<JikanExternalLink>>,
}

// --- Episode ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanEpisode {
    pub mal_id: i64,
    pub url: Option<String>,
    pub title: Option<String>,
    pub title_japanese: Option<String>,
    pub title_romanji: Option<String>,
    pub aired: Option<String>,
    pub score: Option<f64>,
    pub filler: Option<bool>,
    pub recap: Option<bool>,
    pub forum_url: Option<String>,
}

// --- Character ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanCharacterEntry {
    pub character: JikanCharacter,
    pub role: Option<String>,
    pub voice_actors: Option<Vec<JikanVoiceActor>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanCharacter {
    pub mal_id: i64,
    pub url: Option<String>,
    pub images: Option<JikanImages>,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanVoiceActor {
    pub person: JikanPerson,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanPerson {
    pub mal_id: i64,
    pub url: Option<String>,
    pub images: Option<JikanImages>,
    pub name: String,
}

// --- Genres list ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanGenre {
    pub mal_id: i64,
    pub name: String,
    pub url: Option<String>,
    pub count: Option<i32>,
}

// --- Recommendation ---

#[derive(Debug, Clone, Deserialize)]
pub struct JikanRecommendationEntry {
    pub entry: JikanRecommendationItem,
    pub url: Option<String>,
    pub votes: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanRecommendationItem {
    pub mal_id: i64,
    pub url: Option<String>,
    pub images: Option<JikanImages>,
    pub title: Option<String>,
}
```

**Step 3: Commit**

```bash
git add src-tauri/src/jikan/
git commit -m "feat(jikan): add Jikan API response types and module structure"
```

---

### Task 2: Create Jikan HTTP Client with Rate Limiter

**Files:**
- Create: `src-tauri/src/jikan/client.rs`

**Context:** All Jikan API calls go through this client. It enforces rate limits (3 req/sec, 60 req/min) using a token-bucket approach. Uses `ureq` (already in Cargo.toml) for sync HTTP, wrapped in `tokio::task::spawn_blocking` for async compatibility.

**Step 1: Implement the rate-limited client**

```rust
// src-tauri/src/jikan/client.rs
use std::sync::Mutex;
use std::time::{Duration, Instant};
use std::collections::VecDeque;

const JIKAN_BASE_URL: &str = "https://api.jikan.moe/v4";
const MAX_PER_SECOND: usize = 3;
const MAX_PER_MINUTE: usize = 60;
const RETRY_DELAY_MS: u64 = 1000;
const MAX_RETRIES: u32 = 3;

/// Rate-limited HTTP client for Jikan API
pub struct JikanClient {
    request_times: Mutex<VecDeque<Instant>>,
}

impl JikanClient {
    pub fn new() -> Self {
        Self {
            request_times: Mutex::new(VecDeque::new()),
        }
    }

    /// Wait until we can make a request without hitting rate limits
    fn wait_for_rate_limit(&self) {
        loop {
            let mut times = self.request_times.lock().unwrap();
            let now = Instant::now();

            // Remove entries older than 60 seconds
            while times.front().map_or(false, |t| now.duration_since(*t) > Duration::from_secs(60)) {
                times.pop_front();
            }

            // Check per-minute limit
            if times.len() >= MAX_PER_MINUTE {
                let wait_until = times.front().unwrap().checked_add(Duration::from_secs(60)).unwrap();
                let wait = wait_until.saturating_duration_since(now);
                drop(times);
                std::thread::sleep(wait);
                continue;
            }

            // Check per-second limit (last 1 second)
            let one_sec_ago = now - Duration::from_secs(1);
            let recent_count = times.iter().filter(|t| **t > one_sec_ago).count();
            if recent_count >= MAX_PER_SECOND {
                drop(times);
                std::thread::sleep(Duration::from_millis(350));
                continue;
            }

            // Record this request
            times.push_back(now);
            break;
        }
    }

    /// Make a GET request to a Jikan endpoint
    /// `path` should start with `/`, e.g. `/anime/1/full`
    pub fn get(&self, path: &str) -> Result<String, String> {
        self.get_with_query(path, &[])
    }

    /// Make a GET request with query parameters
    pub fn get_with_query(&self, path: &str, params: &[(&str, &str)]) -> Result<String, String> {
        let mut url = format!("{}{}", JIKAN_BASE_URL, path);

        // Build query string
        if !params.is_empty() {
            let query: Vec<String> = params
                .iter()
                .filter(|(_, v)| !v.is_empty())
                .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
                .collect();
            if !query.is_empty() {
                url = format!("{}?{}", url, query.join("&"));
            }
        }

        let mut last_error = String::new();

        for attempt in 0..MAX_RETRIES {
            self.wait_for_rate_limit();

            log::debug!("Jikan request: {} (attempt {})", url, attempt + 1);

            match ureq::get(&url)
                .set("Accept", "application/json")
                .call()
            {
                Ok(response) => {
                    let body = response
                        .into_string()
                        .map_err(|e| format!("Failed to read response body: {}", e))?;
                    return Ok(body);
                }
                Err(ureq::Error::Status(429, _)) => {
                    log::warn!("Jikan rate limited, waiting {}ms before retry", RETRY_DELAY_MS * (attempt as u64 + 1));
                    std::thread::sleep(Duration::from_millis(RETRY_DELAY_MS * (attempt as u64 + 1)));
                    last_error = "Rate limited by Jikan API".to_string();
                }
                Err(ureq::Error::Status(code, response)) => {
                    let body = response.into_string().unwrap_or_default();
                    last_error = format!("Jikan API error {}: {}", code, body);
                    if code == 404 {
                        return Err(last_error);
                    }
                    // Retry on 5xx
                    if code >= 500 {
                        std::thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
                        continue;
                    }
                    return Err(last_error);
                }
                Err(e) => {
                    last_error = format!("Jikan request failed: {}", e);
                    std::thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
                }
            }
        }

        Err(format!("Jikan request failed after {} retries: {}", MAX_RETRIES, last_error))
    }

    /// Parse JSON response into a typed struct
    pub fn get_parsed<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let body = self.get(path)?;
        serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse Jikan response: {} (path: {})", e, path))
    }

    /// Parse JSON response with query params into a typed struct
    pub fn get_parsed_with_query<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> Result<T, String> {
        let body = self.get_with_query(path, params)?;
        serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse Jikan response: {} (path: {})", e, path))
    }
}

/// Global singleton client (lazy-initialized, thread-safe via internal Mutex)
lazy_static::lazy_static! {
    pub static ref JIKAN: JikanClient = JikanClient::new();
}
```

**Step 2: Add `lazy_static` dependency**

In `src-tauri/Cargo.toml`, add under `[dependencies]`:
```toml
lazy_static = "1.5"
```

**Step 3: Commit**

```bash
git add src-tauri/src/jikan/client.rs src-tauri/Cargo.toml
git commit -m "feat(jikan): add rate-limited HTTP client with retry logic"
```

---

### Task 3: Implement Jikan Anime API + Mapping

**Files:**
- Create: `src-tauri/src/jikan/anime.rs`

**Context:** This module calls Jikan anime endpoints and maps responses to the existing app types (`SearchResult`, `MediaDetails`, `Episode`, etc.) from `extensions/types.rs`. The mapping functions are the core of the migration — they translate Jikan's data model into what the frontend already expects.

**Step 1: Create anime.rs with all API functions and mappers**

```rust
// src-tauri/src/jikan/anime.rs
use super::client::JIKAN;
use super::types::*;
use crate::extensions::types::{
    AiredStart, Episode, MediaDetails, SearchResult, SearchResults, Season, SeasonResults, Tag, TagsResult,
};

// --- Mapping helpers ---

/// Map Jikan status string to app status string
fn map_anime_status(status: Option<&str>) -> Option<String> {
    status.map(|s| match s {
        "Currently Airing" => "Releasing".to_string(),
        "Finished Airing" => "Completed".to_string(),
        "Not yet aired" => "Not Yet Released".to_string(),
        other => other.to_string(),
    })
}

/// Extract best image URL from Jikan images
fn extract_image_url(images: &JikanImages) -> Option<String> {
    images
        .jpg
        .as_ref()
        .and_then(|jpg| jpg.large_image_url.clone().or(jpg.image_url.clone()))
        .or_else(|| {
            images
                .webp
                .as_ref()
                .and_then(|webp| webp.large_image_url.clone().or(webp.image_url.clone()))
        })
}

/// Extract genre names from Jikan genre entries
fn extract_genre_names(genres: &Option<Vec<JikanMalEntry>>) -> Vec<String> {
    genres
        .as_ref()
        .map(|g| g.iter().map(|e| e.name.clone()).collect())
        .unwrap_or_default()
}

/// Build YouTube trailer URL from youtube_id
fn build_trailer_url(trailer: &Option<JikanTrailer>) -> Option<String> {
    trailer
        .as_ref()
        .and_then(|t| t.youtube_id.as_ref())
        .map(|id| format!("https://www.youtube.com/watch?v={}", id))
}

/// Map a JikanAnime to our SearchResult
fn jikan_anime_to_search_result(anime: &JikanAnime) -> SearchResult {
    SearchResult {
        id: anime.mal_id.to_string(),
        title: anime.title.clone(),
        cover_url: extract_image_url(&anime.images),
        trailer_url: build_trailer_url(&anime.trailer),
        description: anime.synopsis.clone(),
        year: anime.year.map(|y| y as u32),
        status: map_anime_status(anime.status.as_deref()),
        rating: anime.score.map(|s| s as f32),
        latest_episode: None,
        latest_episode_date: None,
        available_episodes: anime.episodes.map(|e| e as u32),
        media_type: anime.anime_type.clone(),
        genres: Some(extract_genre_names(&anime.genres)),
    }
}

/// Map a JikanAnime (full) to our MediaDetails
fn jikan_anime_to_media_details(anime: &JikanAnime, episodes: Vec<Episode>) -> MediaDetails {
    let aired_start = anime
        .aired
        .as_ref()
        .and_then(|a| a.prop.as_ref())
        .and_then(|p| p.from.as_ref())
        .and_then(|f| {
            f.year.map(|y| AiredStart {
                year: y as u32,
                month: f.month.map(|m| m as u32),
                date: f.day.map(|d| d as u32),
            })
        });

    MediaDetails {
        id: anime.mal_id.to_string(),
        title: anime.title.clone(),
        english_name: anime.title_english.clone(),
        native_name: anime.title_japanese.clone(),
        cover_url: extract_image_url(&anime.images),
        trailer_url: build_trailer_url(&anime.trailer),
        description: anime.synopsis.clone(),
        genres: extract_genre_names(&anime.genres),
        status: map_anime_status(anime.status.as_deref()),
        year: anime.year.map(|y| y as u32),
        rating: anime.score.map(|s| s as f32),
        episodes,
        media_type: anime.anime_type.clone(),
        season: anime.season.as_ref().map(|q| Season {
            quarter: Some(q.clone()),
            year: anime.year.map(|y| y as u32),
        }),
        episode_duration: None, // Jikan returns "24 min per ep" string, not numeric
        episode_count: anime.episodes.map(|e| e as u32),
        aired_start,
        last_update_end: None,
        broadcast_interval: None,
    }
}

/// Map JikanEpisode to our Episode type
fn jikan_episode_to_episode(ep: &JikanEpisode) -> Episode {
    Episode {
        id: ep.mal_id.to_string(),
        number: ep.mal_id as f32, // Jikan episode mal_id is the episode number
        title: ep.title.clone(),
        thumbnail: None, // Jikan doesn't provide episode thumbnails
    }
}

// --- Public API functions ---

/// Search anime by query
pub fn search_anime(query: &str, page: i32, sfw: bool) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params = vec![
        ("q", query),
        ("page", &page_str),
        ("limit", "25"),
    ];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query("/anime", &params)?;

    Ok(SearchResults {
        results: response.data.iter().map(jikan_anime_to_search_result).collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

/// Get top anime (with optional filters)
pub fn top_anime(
    page: i32,
    type_filter: Option<&str>,
    filter: Option<&str>,
    sfw: bool,
) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params = vec![
        ("page", page_str.as_str()),
        ("limit", "25"),
    ];
    if let Some(t) = type_filter {
        params.push(("type", t));
    }
    if let Some(f) = filter {
        params.push(("filter", f));
    }
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query("/top/anime", &params)?;

    Ok(SearchResults {
        results: response.data.iter().map(jikan_anime_to_search_result).collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

/// Get current season anime
pub fn season_now(page: i32, sfw: bool) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params = vec![
        ("page", page_str.as_str()),
        ("limit", "25"),
    ];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query("/seasons/now", &params)?;

    Ok(SearchResults {
        results: response.data.iter().map(jikan_anime_to_search_result).collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

/// Get anime for a specific season
pub fn season(year: i32, season_name: &str, page: i32, sfw: bool) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let path = format!("/seasons/{}/{}", year, season_name);
    let mut params = vec![
        ("page", page_str.as_str()),
        ("limit", "25"),
    ];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query(&path, &params)?;

    Ok(SearchResults {
        results: response.data.iter().map(jikan_anime_to_search_result).collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

/// Get upcoming season anime
pub fn season_upcoming(page: i32, sfw: bool) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params = vec![
        ("page", page_str.as_str()),
        ("limit", "25"),
    ];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query("/seasons/upcoming", &params)?;

    Ok(SearchResults {
        results: response.data.iter().map(jikan_anime_to_search_result).collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

/// Get full anime details by MAL ID
pub fn anime_details(mal_id: i64) -> Result<MediaDetails, String> {
    let path = format!("/anime/{}/full", mal_id);
    let response: JikanResponse<JikanAnime> = JIKAN.get_parsed(&path)?;

    // Fetch episodes separately (Jikan paginates them, 100 per page)
    let episodes = fetch_all_episodes(mal_id)?;

    Ok(jikan_anime_to_media_details(&response.data, episodes))
}

/// Fetch all episodes for an anime (handles pagination)
fn fetch_all_episodes(mal_id: i64) -> Result<Vec<Episode>, String> {
    let mut all_episodes = Vec::new();
    let mut page = 1;

    loop {
        let page_str = page.to_string();
        let path = format!("/anime/{}/episodes", mal_id);
        let response: JikanPaginatedResponse<JikanEpisode> =
            JIKAN.get_parsed_with_query(&path, &[("page", &page_str)])?;

        all_episodes.extend(response.data.iter().map(jikan_episode_to_episode));

        if !response.pagination.has_next_page {
            break;
        }
        page += 1;

        // Safety: don't fetch more than 10 pages (1000 episodes)
        if page > 10 {
            break;
        }
    }

    Ok(all_episodes)
}

/// Get anime episodes (single page)
pub fn anime_episodes(mal_id: i64, page: i32) -> Result<(Vec<Episode>, bool), String> {
    let page_str = page.to_string();
    let path = format!("/anime/{}/episodes", mal_id);
    let response: JikanPaginatedResponse<JikanEpisode> =
        JIKAN.get_parsed_with_query(&path, &[("page", &page_str)])?;

    let episodes = response.data.iter().map(jikan_episode_to_episode).collect();
    Ok((episodes, response.pagination.has_next_page))
}

/// Get anime recommendations
pub fn anime_recommendations(mal_id: i64) -> Result<SearchResults, String> {
    let path = format!("/anime/{}/recommendations", mal_id);
    let response: JikanPaginatedResponse<JikanRecommendationEntry> =
        JIKAN.get_parsed(&path)?;

    let results: Vec<SearchResult> = response
        .data
        .iter()
        .filter_map(|rec| {
            let entry = &rec.entry;
            Some(SearchResult {
                id: entry.mal_id.to_string(),
                title: entry.title.clone().unwrap_or_default(),
                cover_url: entry.images.as_ref().and_then(|i| extract_image_url(i)),
                trailer_url: None,
                description: None,
                year: None,
                status: None,
                rating: None,
                latest_episode: None,
                latest_episode_date: None,
                available_episodes: None,
                media_type: None,
                genres: None,
            })
        })
        .collect();

    Ok(SearchResults {
        has_next_page: false,
        results,
    })
}

/// Get anime genres
pub fn genres_anime() -> Result<TagsResult, String> {
    let response: JikanPaginatedResponse<JikanGenre> =
        JIKAN.get_parsed("/genres/anime")?;

    let genres = response
        .data
        .iter()
        .map(|g| Tag {
            name: g.name.clone(),
            slug: g.name.to_lowercase().replace(' ', "-"),
            count: g.count.unwrap_or(0) as u32,
            thumbnail: None,
        })
        .collect();

    Ok(TagsResult {
        genres,
        studios: vec![], // Jikan genres endpoint doesn't include studios
        has_next_page: false,
    })
}

/// Get weekly schedule
pub fn schedules(day: Option<&str>, page: i32, sfw: bool) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let path = match day {
        Some(d) => format!("/schedules?filter={}", d),
        None => "/schedules".to_string(),
    };
    let mut params = vec![
        ("page", page_str.as_str()),
        ("limit", "25"),
    ];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query(&path, &params)?;

    Ok(SearchResults {
        results: response.data.iter().map(jikan_anime_to_search_result).collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

/// Get a random anime
pub fn random_anime() -> Result<SearchResult, String> {
    let response: JikanResponse<JikanAnime> = JIKAN.get_parsed("/random/anime")?;
    Ok(jikan_anime_to_search_result(&response.data))
}
```

**Step 2: Commit**

```bash
git add src-tauri/src/jikan/anime.rs
git commit -m "feat(jikan): implement anime API functions with type mapping"
```

---

### Task 4: Implement Jikan Manga API + Mapping

**Files:**
- Create: `src-tauri/src/jikan/manga.rs`

**Context:** Same pattern as anime, but maps to `MangaDetails` and `Chapter` types. Jikan doesn't have individual chapter data (only total count), so the chapter list will come from the AllAnime bridge later.

**Step 1: Create manga.rs**

```rust
// src-tauri/src/jikan/manga.rs
use super::client::JIKAN;
use super::types::*;
use crate::extensions::types::{
    Chapter, MangaDetails, SearchResult, SearchResults, Season, Tag, TagsResult,
};

use super::anime::{extract_genre_names, extract_image_url};

// --- Mapping helpers ---

fn map_manga_status(status: Option<&str>) -> Option<String> {
    status.map(|s| match s {
        "Publishing" => "Releasing".to_string(),
        "Finished" => "Completed".to_string(),
        "On Hiatus" => "On Hiatus".to_string(),
        "Discontinued" => "Discontinued".to_string(),
        other => other.to_string(),
    })
}

fn jikan_manga_to_search_result(manga: &JikanManga) -> SearchResult {
    let year = manga
        .published
        .as_ref()
        .and_then(|p| p.prop.as_ref())
        .and_then(|p| p.from.as_ref())
        .and_then(|f| f.year)
        .map(|y| y as u32);

    SearchResult {
        id: manga.mal_id.to_string(),
        title: manga.title.clone(),
        cover_url: extract_image_url(&manga.images),
        trailer_url: None,
        description: manga.synopsis.clone(),
        year,
        status: map_manga_status(manga.status.as_deref()),
        rating: manga.score.map(|s| s as f32),
        latest_episode: None,
        latest_episode_date: None,
        available_episodes: manga.chapters.map(|c| c as u32),
        media_type: manga.manga_type.clone(),
        genres: Some(extract_genre_names(&manga.genres)),
    }
}

fn jikan_manga_to_manga_details(manga: &JikanManga) -> MangaDetails {
    let year = manga
        .published
        .as_ref()
        .and_then(|p| p.prop.as_ref())
        .and_then(|p| p.from.as_ref())
        .and_then(|f| f.year)
        .map(|y| y as u32);

    // Generate chapter stubs from total count
    // Actual chapter data comes from AllAnime bridge
    let total_chapters = manga.chapters.unwrap_or(0);
    let chapters: Vec<Chapter> = (1..=total_chapters)
        .map(|n| Chapter {
            id: format!("{}-{}", manga.mal_id, n),
            number: n as f32,
            title: Some(format!("Chapter {}", n)),
            thumbnail: None,
            release_date: None,
        })
        .collect();

    MangaDetails {
        id: manga.mal_id.to_string(),
        title: manga.title.clone(),
        english_name: manga.title_english.clone(),
        native_name: manga.title_japanese.clone(),
        cover_url: extract_image_url(&manga.images),
        trailer_url: None,
        description: manga.synopsis.clone(),
        genres: extract_genre_names(&manga.genres),
        status: map_manga_status(manga.status.as_deref()),
        year,
        rating: manga.score.map(|s| s as f32),
        chapters,
        media_type: manga.manga_type.clone(),
        season: None,
        total_chapters: manga.chapters.map(|c| c as u32),
    }
}

// --- Public API functions ---

pub fn search_manga(query: &str, page: i32, sfw: bool) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params = vec![
        ("q", query),
        ("page", &page_str),
        ("limit", "25"),
    ];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanManga> =
        JIKAN.get_parsed_with_query("/manga", &params)?;

    Ok(SearchResults {
        results: response.data.iter().map(jikan_manga_to_search_result).collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn top_manga(
    page: i32,
    type_filter: Option<&str>,
    filter: Option<&str>,
    sfw: bool,
) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params = vec![
        ("page", page_str.as_str()),
        ("limit", "25"),
    ];
    if let Some(t) = type_filter {
        params.push(("type", t));
    }
    if let Some(f) = filter {
        params.push(("filter", f));
    }
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanManga> =
        JIKAN.get_parsed_with_query("/top/manga", &params)?;

    Ok(SearchResults {
        results: response.data.iter().map(jikan_manga_to_search_result).collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn manga_details(mal_id: i64) -> Result<MangaDetails, String> {
    let path = format!("/manga/{}/full", mal_id);
    let response: JikanResponse<JikanManga> = JIKAN.get_parsed(&path)?;
    Ok(jikan_manga_to_manga_details(&response.data))
}

pub fn genres_manga() -> Result<TagsResult, String> {
    let response: JikanPaginatedResponse<JikanGenre> =
        JIKAN.get_parsed("/genres/manga")?;

    let genres = response
        .data
        .iter()
        .map(|g| Tag {
            name: g.name.clone(),
            slug: g.name.to_lowercase().replace(' ', "-"),
            count: g.count.unwrap_or(0) as u32,
            thumbnail: None,
        })
        .collect();

    Ok(TagsResult {
        genres,
        studios: vec![],
        has_next_page: false,
    })
}
```

**Step 2: Make `extract_image_url` and `extract_genre_names` public in anime.rs**

Change in `src-tauri/src/jikan/anime.rs`:
```rust
pub fn extract_image_url(...) -> ...
pub fn extract_genre_names(...) -> ...
```

**Step 3: Commit**

```bash
git add src-tauri/src/jikan/manga.rs src-tauri/src/jikan/anime.rs
git commit -m "feat(jikan): implement manga API functions with type mapping"
```

---

### Task 5: Implement AllAnime Bridge

**Files:**
- Create: `src-tauri/src/jikan/bridge.rs`
- Modify: `src-tauri/src/database/` (add migration for `id_mappings` table)

**Context:** The bridge connects Jikan entries (MAL IDs) to AllAnime content IDs. When a user wants to watch/read, we search AllAnime by title, match the best result, cache the mapping, and use the AllAnime ID for source fetching.

**Step 1: Add the `id_mappings` table migration**

Add to the existing migration file or create a new one. Look at how the project handles migrations (sqlx migrate) and add:

```sql
-- In the appropriate migration file
CREATE TABLE IF NOT EXISTS id_mappings (
    mal_id TEXT PRIMARY KEY,
    allanime_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
```

**Step 2: Create bridge.rs**

```rust
// src-tauri/src/jikan/bridge.rs
use crate::commands::AppState;
use crate::extensions::runtime::ExtensionRuntime;
use sqlx::SqlitePool;

/// Check the cache for an existing mapping
pub async fn get_cached_mapping(pool: &SqlitePool, mal_id: &str) -> Result<Option<String>, String> {
    let row = sqlx::query_scalar::<_, String>(
        "SELECT allanime_id FROM id_mappings WHERE mal_id = ?",
    )
    .bind(mal_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(row)
}

/// Save a mapping to the cache
pub async fn save_mapping(
    pool: &SqlitePool,
    mal_id: &str,
    allanime_id: &str,
    media_type: &str,
    title: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR REPLACE INTO id_mappings (mal_id, allanime_id, media_type, title) VALUES (?, ?, ?, ?)",
    )
    .bind(mal_id)
    .bind(allanime_id)
    .bind(media_type)
    .bind(title)
    .execute(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

/// Simple title similarity score (case-insensitive)
fn title_similarity(a: &str, b: &str) -> f64 {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();

    if a_lower == b_lower {
        return 1.0;
    }

    // Check if one contains the other
    if a_lower.contains(&b_lower) || b_lower.contains(&a_lower) {
        return 0.8;
    }

    // Simple word overlap ratio
    let a_words: std::collections::HashSet<&str> = a_lower.split_whitespace().collect();
    let b_words: std::collections::HashSet<&str> = b_lower.split_whitespace().collect();
    let intersection = a_words.intersection(&b_words).count() as f64;
    let union = a_words.union(&b_words).count() as f64;

    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

/// Resolve a MAL title to an AllAnime ID by searching AllAnime
pub fn resolve_via_search(
    state: &AppState,
    title: &str,
    english_title: Option<&str>,
    media_type: &str,
    year: Option<i32>,
) -> Result<Option<String>, String> {
    let extensions = state
        .extensions
        .read()
        .map_err(|e| format!("Failed to lock extensions: {}", e))?;

    let extension_id = if media_type == "manga" {
        "com.allanime.manga"
    } else {
        "com.allanime.source"
    };

    let extension = extensions
        .iter()
        .find(|ext| ext.metadata.id == extension_id)
        .ok_or_else(|| format!("AllAnime extension not found: {}", extension_id))?
        .clone();

    drop(extensions);

    let runtime = ExtensionRuntime::new(extension)
        .map_err(|e| format!("Failed to create runtime: {}", e))?;

    // Try English title first (better match for AllAnime), then original title
    let search_queries: Vec<&str> = [english_title, Some(title)]
        .iter()
        .filter_map(|q| *q)
        .collect();

    let mut best_match: Option<(String, f64)> = None;

    for query in search_queries {
        let results = if media_type == "manga" {
            runtime.search(query, 1)
        } else {
            runtime.search(query, 1)
        };

        if let Ok(search_results) = results {
            for result in &search_results.results {
                let mut score = 0.0;

                // Title similarity
                let sim = title_similarity(&result.title, title);
                score += sim * 10.0;

                // Also check against english title
                if let Some(eng) = english_title {
                    let eng_sim = title_similarity(&result.title, eng);
                    score = score.max(eng_sim * 10.0);
                }

                // Year match bonus
                if let (Some(result_year), Some(search_year)) = (result.year, year) {
                    if result_year as i32 == search_year {
                        score += 3.0;
                    }
                }

                if best_match.as_ref().map_or(true, |(_, s)| score > *s) && score > 5.0 {
                    best_match = Some((result.id.clone(), score));
                }
            }
        }

        // If we found a good match, no need to try next query
        if best_match.as_ref().map_or(false, |(_, s)| *s >= 8.0) {
            break;
        }
    }

    Ok(best_match.map(|(id, _)| id))
}
```

**Step 3: Commit**

```bash
git add src-tauri/src/jikan/bridge.rs
git commit -m "feat(jikan): implement AllAnime ID bridge with fuzzy title matching"
```

---

### Task 6: Create Jikan Tauri Commands + Register Module

**Files:**
- Create: `src-tauri/src/jikan/commands.rs`
- Modify: `src-tauri/src/jikan/mod.rs` (already created in Task 1)
- Modify: `src-tauri/src/lib.rs` (add `mod jikan` and register commands)

**Context:** These are the Tauri IPC commands that the frontend calls. They wrap the API functions from anime.rs/manga.rs in `spawn_blocking` (since ureq is sync) and handle the bridge resolution.

**Step 1: Create commands.rs**

```rust
// src-tauri/src/jikan/commands.rs
use tauri::State;
use crate::commands::AppState;
use crate::extensions::types::*;
use super::{anime, manga, bridge};

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
pub async fn jikan_anime_details(mal_id: i64) -> Result<MediaDetails, String> {
    tokio::task::spawn_blocking(move || anime::anime_details(mal_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn jikan_anime_episodes(mal_id: i64, page: i32) -> Result<SearchResults, String> {
    tokio::task::spawn_blocking(move || {
        let (episodes, has_next_page) = anime::anime_episodes(mal_id, page)?;
        // Return as SearchResults for frontend compatibility
        Ok(SearchResults {
            results: episodes
                .iter()
                .map(|ep| SearchResult {
                    id: ep.id.clone(),
                    title: ep.title.clone().unwrap_or(format!("Episode {}", ep.number)),
                    cover_url: ep.thumbnail.clone(),
                    trailer_url: None,
                    description: None,
                    year: None,
                    status: None,
                    rating: None,
                    latest_episode: None,
                    latest_episode_date: None,
                    available_episodes: None,
                    media_type: None,
                    genres: None,
                })
                .collect(),
            has_next_page,
        })
    })
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

    // Resolve via AllAnime search
    let state_ref = state.inner().clone();
    let title_clone = title.clone();
    let english_clone = english_title.clone();
    let media_clone = media_type.clone();
    let mal_clone = mal_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        bridge::resolve_via_search(
            &state_ref,
            &title_clone,
            english_clone.as_deref(),
            &media_clone,
            year,
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    // Cache the result
    if let Some(ref allanime_id) = result {
        bridge::save_mapping(pool, &mal_id, allanime_id, &media_type, &title).await?;
    }

    Ok(result)
}
```

**Step 2: Register the jikan module in lib.rs**

Add `mod jikan;` to the module declarations in `src-tauri/src/lib.rs`.

Add all jikan commands to the `invoke_handler` macro:

```rust
jikan::commands::jikan_search_anime,
jikan::commands::jikan_top_anime,
jikan::commands::jikan_season_now,
jikan::commands::jikan_season,
jikan::commands::jikan_season_upcoming,
jikan::commands::jikan_anime_details,
jikan::commands::jikan_anime_episodes,
jikan::commands::jikan_anime_recommendations,
jikan::commands::jikan_genres_anime,
jikan::commands::jikan_schedules,
jikan::commands::jikan_random_anime,
jikan::commands::jikan_search_manga,
jikan::commands::jikan_top_manga,
jikan::commands::jikan_manga_details,
jikan::commands::jikan_genres_manga,
jikan::commands::resolve_allanime_id,
```

**Step 3: Add the id_mappings table creation**

Find the database initialization code (likely in `src-tauri/src/database/mod.rs` or a migrations file) and add:

```sql
CREATE TABLE IF NOT EXISTS id_mappings (
    mal_id TEXT PRIMARY KEY,
    allanime_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
```

**Step 4: Build and verify**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```

Expected: Successful compilation (warnings OK, no errors).

**Step 5: Commit**

```bash
git add src-tauri/src/jikan/ src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(jikan): add Tauri commands, bridge, and register module"
```

---

## Phase 2: Frontend — Types and Command Wrappers

### Task 7: Update TypeScript Types

**Files:**
- Modify: `src/types/extension.ts`

**Context:** Add optional fields that Jikan provides but AllAnime doesn't. These are additive — existing code won't break since all new fields are optional.

**Step 1: Add new fields to SearchResult and MediaDetails**

Add to `SearchResult` interface:
```typescript
rank?: number;
popularity?: number;
studios?: string[];
```

Add to `MediaDetails` interface:
```typescript
rank?: number;
popularity?: number;
studios?: { name: string; mal_id: number }[];
streaming_links?: { name: string; url: string }[];
relations?: { relation: string; entry: { mal_id: number; type: string; name: string }[] }[];
```

Add to `MangaDetails` (via inheritance, it already extends MediaDetails).

**Step 2: Commit**

```bash
git add src/types/extension.ts
git commit -m "feat(types): add Jikan-specific optional fields to media types"
```

---

### Task 8: Add Jikan Command Wrappers to tauri-commands.ts

**Files:**
- Modify: `src/utils/tauri-commands.ts`

**Context:** Add new TypeScript wrappers for each Jikan Tauri command. Follow the existing pattern (import `invoke`, return typed promises). These are added alongside existing AllAnime wrappers — they coexist during migration.

**Step 1: Add all Jikan command wrappers**

Add these functions to `src/utils/tauri-commands.ts`:

```typescript
// ===== Jikan API Commands =====

export async function jikanSearchAnime(
  query: string,
  page: number,
  sfw: boolean = true
): Promise<SearchResults> {
  return await invoke('jikan_search_anime', { query, page, sfw })
}

export async function jikanSearchManga(
  query: string,
  page: number,
  sfw: boolean = true
): Promise<SearchResults> {
  return await invoke('jikan_search_manga', { query, page, sfw })
}

export async function jikanTopAnime(
  page: number,
  typeFilter?: string,
  filter?: string,
  sfw: boolean = true
): Promise<SearchResults> {
  return await invoke('jikan_top_anime', { page, typeFilter, filter, sfw })
}

export async function jikanTopManga(
  page: number,
  typeFilter?: string,
  filter?: string,
  sfw: boolean = true
): Promise<SearchResults> {
  return await invoke('jikan_top_manga', { page, typeFilter, filter, sfw })
}

export async function jikanSeasonNow(
  page: number,
  sfw: boolean = true
): Promise<SearchResults> {
  return await invoke('jikan_season_now', { page, sfw })
}

export async function jikanSeason(
  year: number,
  season: string,
  page: number,
  sfw: boolean = true
): Promise<SearchResults> {
  return await invoke('jikan_season', { year, season, page, sfw })
}

export async function jikanSeasonUpcoming(
  page: number,
  sfw: boolean = true
): Promise<SearchResults> {
  return await invoke('jikan_season_upcoming', { page, sfw })
}

export async function jikanAnimeDetails(malId: number): Promise<MediaDetails> {
  return await invoke('jikan_anime_details', { malId })
}

export async function jikanAnimeEpisodes(malId: number, page: number): Promise<SearchResults> {
  return await invoke('jikan_anime_episodes', { malId, page })
}

export async function jikanAnimeRecommendations(malId: number): Promise<SearchResults> {
  return await invoke('jikan_anime_recommendations', { malId })
}

export async function jikanGenresAnime(): Promise<any> {
  return await invoke('jikan_genres_anime')
}

export async function jikanGenresManga(): Promise<any> {
  return await invoke('jikan_genres_manga')
}

export async function jikanSchedules(
  day?: string,
  page: number = 1,
  sfw: boolean = true
): Promise<SearchResults> {
  return await invoke('jikan_schedules', { day, page, sfw })
}

export async function jikanRandomAnime(): Promise<SearchResult> {
  return await invoke('jikan_random_anime')
}

export async function jikanMangaDetails(malId: number): Promise<MangaDetails> {
  return await invoke('jikan_manga_details', { malId })
}

export async function resolveAllanimeId(
  title: string,
  mediaType: string,
  malId: string,
  englishTitle?: string,
  year?: number
): Promise<string | null> {
  return await invoke('resolve_allanime_id', {
    title,
    englishTitle,
    mediaType,
    year,
    malId,
  })
}
```

**Step 2: Commit**

```bash
git add src/utils/tauri-commands.ts
git commit -m "feat(frontend): add Jikan command wrappers to tauri-commands"
```

---

## Phase 3: Frontend — Route Migration

### Task 9: Migrate Home Route (`/`)

**Files:**
- Modify: `src/routes/index.tsx`

**Context:** Replace extension loading + SSE streaming with direct Jikan calls. The home page should show: Trending (airing), This Season, Top Rated, Upcoming. Remove `loadExtension()` dependency for metadata.

**Step 1: Read the full current index.tsx to understand all logic**

Read `src/routes/index.tsx` completely before making changes.

**Step 2: Replace extension-based data fetching with Jikan calls**

Replace the `useEffect` that loads extensions and fetches data. The new pattern:

```typescript
// Remove:
import { loadExtension } from '@/utils/tauri-commands'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'

// Add:
import { jikanTopAnime, jikanSeasonNow, jikanSeasonUpcoming } from '@/utils/tauri-commands'

// Replace the extension loading + discover useEffect with:
useEffect(() => {
  const loadContent = async () => {
    try {
      setLoading(true)
      const [trending, thisSeasonData, topRated, upcoming] = await Promise.all([
        jikanTopAnime(1, undefined, 'airing', !nsfwFilter),
        jikanSeasonNow(1, !nsfwFilter),
        jikanTopAnime(1, undefined, undefined, !nsfwFilter),
        jikanSeasonUpcoming(1, !nsfwFilter),
      ])
      // Set state with results...
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content')
    } finally {
      setLoading(false)
    }
  }
  loadContent()
}, [nsfwFilter])
```

**Step 3: Remove extensionId state variable and all references**

The home page no longer needs `extensionId` in state.

**Step 4: Update navigation to pass MAL IDs instead of extension IDs**

When navigating to `/watch` or anime details, pass `malId` instead of `extensionId + animeId`.

**Step 5: Verify the app compiles and home page loads**

```bash
npm run dev
```

**Step 6: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat(home): migrate home route from AllAnime to Jikan API"
```

---

### Task 10: Migrate Anime Browser Route (`/anime`)

**Files:**
- Modify: `src/routes/anime.tsx`

**Context:** Replace extension-based search/discover with Jikan. Add new filter options (type, status, rating). Remove SSE streaming — use standard pagination instead.

**Step 1: Read the full current anime.tsx**

**Step 2: Replace imports and data fetching**

```typescript
// Replace AllAnime imports with Jikan imports
import { jikanSearchAnime, jikanTopAnime, jikanSeasonNow, jikanGenresAnime } from '@/utils/tauri-commands'
```

**Step 3: Update search function**

```typescript
const handleSearch = async (query: string, page: number) => {
  const results = await jikanSearchAnime(query, page, !nsfwFilter)
  return results
}
```

**Step 4: Update browse/discover function**

```typescript
const handleBrowse = async (page: number, filter?: string, typeFilter?: string) => {
  const results = await jikanTopAnime(page, typeFilter, filter, !nsfwFilter)
  return results
}
```

**Step 5: Remove extension loading, SSE listeners, extensionId state**

**Step 6: Commit**

```bash
git add src/routes/anime.tsx
git commit -m "feat(anime): migrate anime browser to Jikan API"
```

---

### Task 11: Migrate Manga Browser Route (`/manga`)

**Files:**
- Modify: `src/routes/manga.tsx`

**Context:** Same pattern as anime browser migration.

**Step 1: Read and update manga.tsx**

Replace AllAnime calls with `jikanSearchManga`, `jikanTopManga`. Remove extension loading.

**Step 2: Commit**

```bash
git add src/routes/manga.tsx
git commit -m "feat(manga): migrate manga browser to Jikan API"
```

---

### Task 12: Migrate Watch Route (`/watch`)

**Files:**
- Modify: `src/routes/watch.tsx`

**Context:** This is the most complex migration. Details come from Jikan, but video sources still come from AllAnime via the bridge. The URL params change from `extensionId + animeId` to `malId`.

**Step 1: Read the full current watch.tsx**

**Step 2: Update URL parameters**

Change route search params from `{ extensionId, animeId, episodeId }` to `{ malId, episodeId }`.

**Step 3: Update detail fetching**

```typescript
// Fetch details from Jikan
const details = await jikanAnimeDetails(malId)
```

**Step 4: Add bridge resolution for video sources**

```typescript
// When user clicks play on an episode:
const playEpisode = async (episodeNumber: number) => {
  // Resolve AllAnime ID via bridge
  const allanimeId = await resolveAllanimeId(
    details.title,
    'anime',
    details.id,
    details.english_name,
    details.year
  )

  if (!allanimeId) {
    setError('Could not find streaming source for this anime')
    return
  }

  // Load AllAnime extension if needed
  const metadata = await loadExtension(ALLANIME_EXTENSION)

  // Get video sources using AllAnime episode ID format
  const episodeId = `${allanimeId}-${episodeNumber}`
  const sources = await getVideoSources(metadata.id, episodeId)
  // ... play video
}
```

**Step 5: Update all navigation links pointing to /watch**

Search across `src/` for links to `/watch` and update them to use `malId` instead of `extensionId + animeId`.

**Step 6: Commit**

```bash
git add src/routes/watch.tsx
git commit -m "feat(watch): migrate watch route to Jikan + AllAnime bridge"
```

---

### Task 13: Migrate Read Route (`/read`)

**Files:**
- Modify: `src/routes/read.tsx`

**Context:** Same bridge pattern as watch. Details from Jikan, chapter images from AllAnime.

**Step 1: Read and update read.tsx**

Same pattern: `jikanMangaDetails(malId)` for metadata, `resolveAllanimeId()` + `getChapterImages()` for content.

**Step 2: Commit**

```bash
git add src/routes/read.tsx
git commit -m "feat(read): migrate read route to Jikan + AllAnime bridge"
```

---

## Phase 4: Frontend — Component Updates

### Task 14: Update MediaCard Component

**Files:**
- Modify: `src/components/media/MediaCard.tsx`

**Context:** Remove AllAnime-specific badge logic (`latest_episode`, `latest_episode_date`). Add MAL rank badge. Remove image proxying (MAL CDN doesn't need it).

**Step 1: Read MediaCard.tsx**

**Step 2: Remove `useProxiedImage` usage for cover images**

MAL CDN images don't need Referer headers. Use `cover_url` directly.

**Step 3: Replace latest episode badge with rank badge**

```typescript
// Remove:
{latest_episode && <Badge>EP {latest_episode}</Badge>}

// Add:
{rank && <Badge>#{rank}</Badge>}
```

**Step 4: Update navigation onClick to use malId**

**Step 5: Commit**

```bash
git add src/components/media/MediaCard.tsx
git commit -m "refactor(media-card): update for Jikan data model"
```

---

### Task 15: Update MediaDetailModal Component

**Files:**
- Modify: `src/components/media/MediaDetailModal.tsx`

**Context:** Update to use Jikan details. Add studios display, streaming links, and relations. Update "Watch" button to use bridge flow.

**Step 1: Read MediaDetailModal.tsx**

**Step 2: Update the detail fetching call**

Replace `getAnimeDetails(extensionId, animeId)` with `jikanAnimeDetails(parseInt(id))`.

**Step 3: Add studios and streaming links display**

```typescript
{details.studios?.length > 0 && (
  <div>Studios: {details.studios.map(s => s.name).join(', ')}</div>
)}
{details.streaming_links?.length > 0 && (
  <div>
    {details.streaming_links.map(link => (
      <a href={link.url} target="_blank">{link.name}</a>
    ))}
  </div>
)}
```

**Step 4: Update "Watch" button to navigate with malId**

**Step 5: Commit**

```bash
git add src/components/media/MediaDetailModal.tsx
git commit -m "refactor(media-detail): update for Jikan data with studios and streaming links"
```

---

## Phase 5: Cleanup and Verification

### Task 16: Update All Navigation Links

**Files:**
- Modify: Any file that navigates to `/watch` or `/read` routes

**Context:** Search the codebase for all navigation to `/watch` and `/read` routes. Update them to pass `malId` instead of `extensionId + animeId`.

**Step 1: Search for all /watch and /read navigation**

```bash
grep -rn "navigate.*watch\|navigate.*read\|/watch\?.*extensionId\|/read\?.*extensionId" src/
```

**Step 2: Update each one to use malId**

**Step 3: Commit**

```bash
git add src/
git commit -m "refactor: update all navigation to use Jikan MAL IDs"
```

---

### Task 17: Load AllAnime Extensions Lazily

**Files:**
- Modify: `src/routes/watch.tsx`
- Modify: `src/routes/read.tsx`

**Context:** AllAnime extensions should only be loaded when the user actually wants to watch/read (not on app startup). Move `loadExtension(ALLANIME_EXTENSION)` into the bridge resolution flow.

**Step 1: Ensure extension is loaded only when resolving sources**

The `playEpisode` function in Task 12 already does this. Verify that no other code loads extensions eagerly.

**Step 2: Remove any remaining eager extension loading from routes**

Search for `loadExtension(ALLANIME` in all route files and remove any that aren't inside a play/read handler.

**Step 3: Commit**

```bash
git add src/
git commit -m "refactor: lazy-load AllAnime extensions only for streaming"
```

---

### Task 18: Full Integration Test

**Context:** Verify the complete migration works end-to-end.

**Step 1: Build the full app**

```bash
cd src-tauri && cargo build
npm run build
```

**Step 2: Manual testing checklist**

- [ ] Home page loads with Jikan data (trending, top rated, this season, upcoming)
- [ ] Anime search returns results
- [ ] Anime browse/filter works (by type, popularity, etc.)
- [ ] Current season tab works
- [ ] Clicking an anime shows detail modal with Jikan data
- [ ] "Watch" button resolves AllAnime source and plays video
- [ ] Manga search returns results
- [ ] Manga detail shows chapter list
- [ ] "Read" button resolves AllAnime source and shows pages
- [ ] NSFW filter works (sfw parameter)
- [ ] Rate limiting doesn't cause errors under normal usage

**Step 3: Fix any issues found**

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Jikan API migration with AllAnime streaming bridge"
```

---

## Summary

| Phase | Tasks | Scope |
|-------|-------|-------|
| Phase 1: Rust Backend | Tasks 1-6 | Jikan types, client, anime/manga APIs, bridge, commands |
| Phase 2: Frontend Foundation | Tasks 7-8 | TypeScript types, command wrappers |
| Phase 3: Frontend Routes | Tasks 9-13 | Home, Anime, Manga, Watch, Read routes |
| Phase 4: Components | Tasks 14-15 | MediaCard, MediaDetailModal |
| Phase 5: Cleanup | Tasks 16-18 | Navigation links, lazy loading, integration test |

**Total: 18 tasks across 5 phases**

**Key files created:**
- `src-tauri/src/jikan/mod.rs`
- `src-tauri/src/jikan/types.rs`
- `src-tauri/src/jikan/client.rs`
- `src-tauri/src/jikan/anime.rs`
- `src-tauri/src/jikan/manga.rs`
- `src-tauri/src/jikan/bridge.rs`
- `src-tauri/src/jikan/commands.rs`

**Key files modified:**
- `src-tauri/Cargo.toml` (add lazy_static)
- `src-tauri/src/lib.rs` (register module + commands)
- `src/types/extension.ts` (add optional fields)
- `src/utils/tauri-commands.ts` (add Jikan wrappers)
- `src/routes/index.tsx` (home → Jikan)
- `src/routes/anime.tsx` (browse → Jikan)
- `src/routes/manga.tsx` (browse → Jikan)
- `src/routes/watch.tsx` (details → Jikan, sources → bridge)
- `src/routes/read.tsx` (details → Jikan, sources → bridge)
- `src/components/media/MediaCard.tsx` (rank badge, no proxy)
- `src/components/media/MediaDetailModal.tsx` (studios, streaming links)
