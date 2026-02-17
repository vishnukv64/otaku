use super::client::JIKAN;
use super::types::*;
use crate::extensions::types::{
    AiredStart, Episode, MediaDetails, SearchResult, SearchResults, Season, Tag, TagsResult,
};

// --- Mapping helpers ---

fn map_anime_status(status: Option<&str>) -> Option<String> {
    status.map(|s| match s {
        "Currently Airing" => "Releasing".to_string(),
        "Finished Airing" => "Completed".to_string(),
        "Not yet aired" => "Not Yet Released".to_string(),
        other => other.to_string(),
    })
}

pub fn extract_image_url(images: &JikanImages) -> Option<String> {
    images
        .webp
        .as_ref()
        .and_then(|webp| webp.large_image_url.clone().or(webp.image_url.clone()))
        .or_else(|| {
            images
                .jpg
                .as_ref()
                .and_then(|jpg| jpg.large_image_url.clone().or(jpg.image_url.clone()))
        })
}

pub fn extract_genre_names(genres: &Option<Vec<JikanMalEntry>>) -> Vec<String> {
    genres
        .as_ref()
        .map(|g| g.iter().map(|e| e.name.clone()).collect())
        .unwrap_or_default()
}

fn build_trailer_url(trailer: &Option<JikanTrailer>) -> Option<String> {
    let t = trailer.as_ref()?;
    // Prefer embed_url (iframe-ready), fall back to constructing from youtube_id.
    // Strip enablejsapi=1 — it causes YouTube to validate the page origin,
    // which fails in Tauri production builds (tauri:// is not a valid HTTP origin).
    if let Some(embed) = &t.embed_url {
        if !embed.is_empty() {
            let cleaned = embed
                .replace("enablejsapi=1&", "")
                .replace("&enablejsapi=1", "")
                .replace("?enablejsapi=1", "?");
            // Clean up trailing '?' if enablejsapi was the only param
            let cleaned = cleaned.trim_end_matches('?').to_string();
            return Some(cleaned);
        }
    }
    if let Some(id) = &t.youtube_id {
        if !id.is_empty() {
            return Some(format!(
                "https://www.youtube-nocookie.com/embed/{}?autoplay=1&mute=1",
                id
            ));
        }
    }
    None
}

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
        rank: anime.rank,
        popularity: anime.popularity,
        studios: anime.studios.as_ref().map(|s| s.iter().map(|e| e.name.clone()).collect()),
    }
}

/// Only populate broadcast fields for currently airing TV anime with known broadcast schedule.
fn is_airing_tv_with_broadcast(anime: &JikanAnime) -> bool {
    let is_tv = anime
        .anime_type
        .as_deref()
        .map(|t| t == "TV")
        .unwrap_or(false);
    let is_airing = anime.airing.unwrap_or(false);
    let has_broadcast = anime.broadcast.as_ref().and_then(|b| b.day.as_ref()).is_some();
    is_tv && is_airing && has_broadcast
}

fn compute_last_update_end(anime: &JikanAnime, last_aired: &Option<String>) -> Option<String> {
    if !is_airing_tv_with_broadcast(anime) {
        return None;
    }
    let aired = last_aired.as_ref()?;

    // Combine the last aired date with the broadcast time+timezone for accuracy.
    // Jikan episodes only give a date; the anime object has the actual broadcast time.
    let broadcast = anime.broadcast.as_ref()?;
    let time_str = broadcast.time.as_deref().unwrap_or("00:00");
    let tz_str = broadcast.timezone.as_deref().unwrap_or("Asia/Tokyo");

    // Map IANA timezone to UTC offset (anime broadcasts are almost always JST)
    let utc_offset = match tz_str {
        "Asia/Tokyo" => "+09:00",
        _ => "+09:00", // safe default for anime
    };

    // Parse just the date portion from the aired string (e.g. "2026-02-14T00:00:00+00:00")
    let date_part = if aired.len() >= 10 { &aired[..10] } else { aired.as_str() };

    Some(format!("{}T{}:00{}", date_part, time_str, utc_offset))
}

fn compute_broadcast_interval(anime: &JikanAnime, last_aired: &Option<String>) -> Option<u64> {
    if !is_airing_tv_with_broadcast(anime) || last_aired.is_none() {
        return None;
    }
    Some(604_800_000) // 7 days in milliseconds (weekly schedule)
}

/// Collect all title synonyms from a Jikan anime entry.
/// Gathers from title_synonyms, title_japanese, and titles[] (skipping Default/English
/// which are already passed as title/english_name).
fn collect_anime_synonyms(anime: &JikanAnime) -> Option<Vec<String>> {
    let mut synonyms = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // 1. Add title_synonyms array entries
    if let Some(ref syns) = anime.title_synonyms {
        for s in syns {
            if !s.is_empty() && seen.insert(s.to_lowercase()) {
                synonyms.push(s.clone());
            }
        }
    }

    // 2. Add title_japanese (if not empty and not already in synonyms)
    if let Some(ref jp) = anime.title_japanese {
        if !jp.is_empty() && seen.insert(jp.to_lowercase()) {
            synonyms.push(jp.clone());
        }
    }

    // 3. Add titles[] entries where type != "Default" and type != "English"
    if let Some(ref titles) = anime.titles {
        for t in titles {
            if t.title_type != "Default" && t.title_type != "English" && !t.title.is_empty() {
                if seen.insert(t.title.to_lowercase()) {
                    synonyms.push(t.title.clone());
                }
            }
        }
    }

    if synonyms.is_empty() { None } else { Some(synonyms) }
}

fn jikan_anime_to_media_details(anime: &JikanAnime, episodes: Vec<Episode>, last_aired: Option<String>) -> MediaDetails {
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
        title_synonyms: collect_anime_synonyms(anime),
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
        episode_duration: None,
        episode_count: anime.episodes.map(|e| e as u32),
        aired_start,
        last_update_end: compute_last_update_end(anime, &last_aired),
        broadcast_interval: compute_broadcast_interval(anime, &last_aired),
    }
}

fn jikan_episode_to_episode(anime_mal_id: i64, ep: &JikanEpisode) -> Episode {
    Episode {
        id: format!("{}-{}", anime_mal_id, ep.mal_id),
        number: ep.mal_id as f32,
        title: ep.title.clone(),
        thumbnail: None,
    }
}

// --- Public API functions ---

pub fn search_anime(query: &str, page: i32, sfw: bool) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params = vec![("q", query), ("page", &page_str), ("limit", "25")];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query("/anime", &params)?;

    Ok(SearchResults {
        results: response
            .data
            .iter()
            .map(jikan_anime_to_search_result)
            .collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn top_anime(
    page: i32,
    type_filter: Option<&str>,
    filter: Option<&str>,
    sfw: bool,
) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params = vec![("page", page_str.as_str()), ("limit", "25")];
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
        results: response
            .data
            .iter()
            .map(jikan_anime_to_search_result)
            .collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn season_now(page: i32, sfw: bool) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params = vec![("page", page_str.as_str()), ("limit", "25")];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query("/seasons/now", &params)?;

    Ok(SearchResults {
        results: response
            .data
            .iter()
            .map(jikan_anime_to_search_result)
            .collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn season(
    year: i32,
    season_name: &str,
    page: i32,
    sfw: bool,
) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let path = format!("/seasons/{}/{}", year, season_name);
    let mut params = vec![("page", page_str.as_str()), ("limit", "25")];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query(&path, &params)?;

    Ok(SearchResults {
        results: response
            .data
            .iter()
            .map(jikan_anime_to_search_result)
            .collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn season_upcoming(page: i32, sfw: bool) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params = vec![("page", page_str.as_str()), ("limit", "25")];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query("/seasons/upcoming", &params)?;

    Ok(SearchResults {
        results: response
            .data
            .iter()
            .map(jikan_anime_to_search_result)
            .collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn watch_episodes_popular() -> Result<SearchResults, String> {
    let response: JikanPaginatedResponse<JikanWatchEpisodeEntry> =
        JIKAN.get_parsed("/watch/episodes/popular")?;

    // Deduplicate by mal_id (same anime may appear multiple times with different popular episodes)
    let mut seen = std::collections::HashSet::new();
    let results: Vec<SearchResult> = response
        .data
        .iter()
        .filter(|entry| !entry.region_locked.unwrap_or(false))
        .filter(|entry| seen.insert(entry.entry.mal_id))
        .map(|entry| jikan_anime_to_search_result(&entry.entry))
        .collect();

    Ok(SearchResults {
        results,
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn anime_details(mal_id: i64) -> Result<MediaDetails, String> {
    let path = format!("/anime/{}/full", mal_id);
    let response: JikanResponse<JikanAnime> = JIKAN.get_parsed(&path)?;

    // Don't fail the entire request if episodes can't be fetched (rate limiting)
    let (episodes, last_aired) = match fetch_all_episodes(mal_id) {
        Ok((eps, aired)) => (eps, aired),
        Err(e) => {
            log::warn!("Failed to fetch episodes for {}: {}, generating synthetic episodes", mal_id, e);
            // Generate synthetic episodes from episode_count so the watch page still works
            let eps = if let Some(count) = response.data.episodes {
                (1..=count)
                    .map(|n| Episode {
                        id: format!("{}-{}", mal_id, n),
                        number: n as f32,
                        title: Some(format!("Episode {}", n)),
                        thumbnail: None,
                    })
                    .collect()
            } else {
                Vec::new()
            };
            (eps, None)
        }
    };

    Ok(jikan_anime_to_media_details(&response.data, episodes, last_aired))
}

/// Returns (episodes, last_aired_date) where last_aired_date is the aired timestamp
/// of the most recent episode (used for next-episode countdown).
fn fetch_all_episodes(mal_id: i64) -> Result<(Vec<Episode>, Option<String>), String> {
    let mut all_episodes = Vec::new();
    let mut last_aired: Option<String> = None;
    let mut page = 1;

    loop {
        let page_str = page.to_string();
        let path = format!("/anime/{}/episodes", mal_id);
        let response: JikanPaginatedResponse<JikanEpisode> =
            JIKAN.get_parsed_with_query(&path, &[("page", &page_str)])?;

        for ep in &response.data {
            if let Some(ref aired) = ep.aired {
                last_aired = Some(aired.clone());
            }
        }

        all_episodes.extend(response.data.iter().map(|ep| jikan_episode_to_episode(mal_id, ep)));

        if !response.pagination.has_next_page {
            break;
        }
        page += 1;

        if page > 30 {
            break;
        }
    }

    Ok((all_episodes, last_aired))
}

pub fn anime_episodes(mal_id: i64, page: i32) -> Result<(Vec<Episode>, bool), String> {
    let page_str = page.to_string();
    let path = format!("/anime/{}/episodes", mal_id);
    let response: JikanPaginatedResponse<JikanEpisode> =
        JIKAN.get_parsed_with_query(&path, &[("page", &page_str)])?;

    let episodes = response.data.iter().map(|ep| jikan_episode_to_episode(mal_id, ep)).collect();
    Ok((episodes, response.pagination.has_next_page))
}

pub fn anime_recommendations(mal_id: i64) -> Result<SearchResults, String> {
    let path = format!("/anime/{}/recommendations", mal_id);
    let response: JikanPaginatedResponse<JikanRecommendationEntry> =
        JIKAN.get_parsed(&path)?;

    let results: Vec<SearchResult> = response
        .data
        .iter()
        .map(|rec| {
            let entry = &rec.entry;
            SearchResult {
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
                rank: None,
                popularity: None,
                studios: None,
            }
        })
        .collect();

    Ok(SearchResults {
        has_next_page: false,
        results,
    })
}

pub fn genres_anime() -> Result<TagsResult, String> {
    let response: JikanPaginatedResponse<JikanGenre> = JIKAN.get_parsed("/genres/anime")?;

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

pub fn schedules(day: Option<&str>, page: i32, sfw: bool) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let path = match day {
        Some(d) => format!("/schedules?filter={}", d),
        None => "/schedules".to_string(),
    };
    let mut params = vec![("page", page_str.as_str()), ("limit", "30")];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanAnime> =
        JIKAN.get_parsed_with_query(&path, &params)?;

    Ok(SearchResults {
        results: response
            .data
            .iter()
            .map(jikan_anime_to_search_result)
            .collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn random_anime() -> Result<SearchResult, String> {
    let response: JikanResponse<JikanAnime> = JIKAN.get_parsed("/random/anime")?;
    Ok(jikan_anime_to_search_result(&response.data))
}
