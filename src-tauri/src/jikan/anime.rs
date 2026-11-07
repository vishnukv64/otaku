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
        native_name: None,
        title_synonyms: None,
        rank: anime.rank,
        popularity: anime.popularity,
        views: None,
        studios: anime.studios.as_ref().map(|s| s.iter().map(|e| e.name.clone()).collect()),
        broadcast_day: anime.broadcast.as_ref().and_then(|b| b.day.clone()),
        broadcast_time: anime.broadcast.as_ref().and_then(|b| b.time.clone()),
        broadcast_timezone: anime.broadcast.as_ref().and_then(|b| b.timezone.clone()),
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
        aired: ep.aired.clone(),
        duration: None,
    }
}

// --- Public API functions ---

pub fn search_anime(query: &str, page: i32, sfw: bool) -> Result<SearchResults, String> {
    or_anilist(jikan_search_anime(query, page, sfw), "search", || {
        anilist_media_page(page, sfw, AnilistMediaQuery { search: Some(query), ..Default::default() })
    })
}

fn jikan_search_anime(query: &str, page: i32, sfw: bool) -> Result<SearchResults, String> {
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
    or_anilist(jikan_top_anime(page, type_filter, filter, sfw), "top", || {
        let (sort, status) = match filter {
            Some("airing") => ("SCORE_DESC", Some("RELEASING")),
            Some("upcoming") => ("POPULARITY_DESC", Some("NOT_YET_RELEASED")),
            Some("bypopularity") => ("POPULARITY_DESC", None),
            Some("favorite") => ("FAVOURITES_DESC", None),
            _ => ("SCORE_DESC", None),
        };
        anilist_media_page(page, sfw, AnilistMediaQuery {
            sort: Some(sort),
            status,
            formats: type_filter.and_then(anilist_formats),
            ..Default::default()
        })
    })
}

fn jikan_top_anime(
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
    or_anilist(jikan_season_now(page, sfw), "season", || {
        let (season, year) = current_anilist_season();
        anilist_media_page(page, sfw, AnilistMediaQuery {
            season: Some(season),
            season_year: Some(year),
            ..Default::default()
        })
    })
}

fn jikan_season_now(page: i32, sfw: bool) -> Result<SearchResults, String> {
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
    or_anilist(jikan_season(year, season_name, page, sfw), "season", || {
        anilist_media_page(page, sfw, AnilistMediaQuery {
            season: Some(season_name.to_ascii_uppercase()),
            season_year: Some(year),
            ..Default::default()
        })
    })
}

fn jikan_season(
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
    or_anilist(jikan_season_upcoming(page, sfw), "upcoming", || {
        anilist_media_page(page, sfw, AnilistMediaQuery { status: Some("NOT_YET_RELEASED"), ..Default::default() })
    })
}

fn jikan_season_upcoming(page: i32, sfw: bool) -> Result<SearchResults, String> {
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
    or_anilist(jikan_watch_episodes_popular(), "popular episodes", || {
        anilist_media_page(1, true, AnilistMediaQuery {
            sort: Some("TRENDING_DESC"),
            status: Some("RELEASING"),
            ..Default::default()
        })
    })
}

fn jikan_watch_episodes_popular() -> Result<SearchResults, String> {
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
    let response: JikanResponse<JikanAnime> = match JIKAN.get_parsed(&path) {
        Ok(r) => r,
        // A 404 means MAL has no such anime; anything else is Jikan being down.
        Err(e) if e.contains("Jikan API error 404") => return Err(e),
        Err(e) => {
            log::warn!("Jikan details failed for {}: {}; using AniList", mal_id, e);
            return anilist_anime_details(mal_id).map_err(|a| format!("{} (AniList fallback: {})", e, a));
        }
    };

    // Don't fail the entire request if episodes can't be fetched (rate limiting)
    let (mut episodes, mut last_aired) = match fetch_all_episodes(mal_id) {
        Ok((eps, aired)) => (eps, aired),
        Err(e) => {
            log::warn!("Failed to fetch episodes for {}: {}, generating synthetic episodes", mal_id, e);
            (Vec::new(), None)
        }
    };

    // Generate synthetic episodes when Jikan returns none but episode_count exists
    // (common for movies and specials where /episodes endpoint returns empty)
    if episodes.is_empty() {
        if let Some(count) = response.data.episodes {
            log::info!("Generating {} synthetic episodes for MAL {}", count, mal_id);
            episodes = (1..=count)
                .map(|n| Episode {
                    id: format!("{}-{}", mal_id, n),
                    number: n as f32,
                    title: Some(format!("Episode {}", n)),
                    thumbnail: None,
                    aired: None,
                    duration: None,
                })
                .collect();
        }
    }

    // For airing anime, fill in any episodes that aired but aren't indexed by Jikan yet.
    // last_aired is mutated to the most recent synthetic episode's expected date so that
    // the next-episode countdown is computed from the right baseline.
    fill_synthetic_episodes(
        &mut episodes,
        mal_id,
        &mut last_aired,
        response.data.episodes,
        &response.data,
    );

    Ok(jikan_anime_to_media_details(&response.data, episodes, last_aired))
}

/// For airing TV anime, Jikan's `/episodes` list sometimes lags behind the real broadcast
/// schedule by several days. This function generates synthetic episode entries for any
/// episodes that should have aired (based on the 7-day weekly interval) but haven't been
/// indexed yet by Jikan.
///
/// Also advances `last_aired` to the expected air date of the last synthetic episode so
/// that the next-episode countdown is computed from the correct baseline (otherwise the
/// countdown would remain "New episode available!" even for synthetic episodes).
fn fill_synthetic_episodes(
    episodes: &mut Vec<Episode>,
    mal_id: i64,
    last_aired: &mut Option<String>,
    episode_count: Option<i32>,
    anime: &JikanAnime,
) {
    if !is_airing_tv_with_broadcast(anime) {
        return;
    }
    let last_aired_str = match last_aired {
        Some(ref s) => s.clone(),
        None => return,
    };
    let Ok(last_dt) = chrono::DateTime::parse_from_rfc3339(&last_aired_str) else {
        return;
    };
    let now = chrono::Utc::now();
    let days_since = (now - last_dt.with_timezone(&chrono::Utc)).num_days();
    if days_since < 7 {
        return; // no new episode due yet
    }
    let expected_new = (days_since / 7) as usize;
    let current_count = episodes.len();
    let max = episode_count.unwrap_or(i32::MAX) as usize;
    let target = (current_count + expected_new).min(max);
    for n in (current_count + 1)..=target {
        let weeks_offset = (n - current_count) as i64;
        let ep_date = last_dt + chrono::Duration::weeks(weeks_offset);
        // Advance last_aired so the countdown baseline reflects this synthetic episode's date
        *last_aired = Some(ep_date.to_rfc3339());
        log::info!(
            "Synthetic episode {} generated for MAL {} (expected: {})",
            n,
            mal_id,
            ep_date.to_rfc3339()
        );
        episodes.push(Episode {
            id: format!("{}-{}", mal_id, n),
            number: n as f32,
            title: Some(format!("Episode {}", n)),
            thumbnail: None,
            aired: Some(ep_date.to_rfc3339()),
            duration: None,
        });
    }
}

/// Returns (episodes, last_aired_date) where last_aired_date is the aired timestamp
/// of the most recent episode (used for next-episode countdown).
fn fetch_all_episodes(mal_id: i64) -> Result<(Vec<Episode>, Option<String>), String> {
    let mut all_episodes = Vec::new();
    let mut last_aired: Option<String> = None;
    let mut page = 1;

    loop {
        let path = format!("/anime/{}/episodes", mal_id);
        let response: JikanPaginatedResponse<JikanEpisode> = if page == 1 {
            // Don't pass page=1 explicitly — Jikan returns fewer results with
            // an explicit page param than when the param is omitted entirely.
            JIKAN.get_parsed(&path)?
        } else {
            let page_str = page.to_string();
            JIKAN.get_parsed_with_query(&path, &[("page", &page_str)])?
        };

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
    let path = format!("/anime/{}/episodes", mal_id);
    let response: JikanPaginatedResponse<JikanEpisode> = if page == 1 {
        JIKAN.get_parsed(&path)?
    } else {
        let page_str = page.to_string();
        JIKAN.get_parsed_with_query(&path, &[("page", &page_str)])?
    };

    let episodes = response.data.iter().map(|ep| jikan_episode_to_episode(mal_id, ep)).collect();
    Ok((episodes, response.pagination.has_next_page))
}

pub fn anime_episode_detail(mal_id: i64, episode: i64) -> Result<JikanEpisodeDetail, String> {
    let path = format!("/anime/{}/episodes/{}", mal_id, episode);
    let response: JikanResponse<JikanEpisodeDetail> = JIKAN.get_parsed(&path)?;
    Ok(response.data)
}

pub fn anime_recommendations(mal_id: i64) -> Result<SearchResults, String> {
    let path = format!("/anime/{}/recommendations", mal_id);
    let response: JikanResponse<Vec<JikanRecommendationEntry>> =
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
                native_name: None,
                title_synonyms: None,
                rank: None,
                popularity: None,
                views: None,
                studios: None,
                broadcast_day: None,
                broadcast_time: None,
                broadcast_timezone: None,
            }
        })
        .collect();

    Ok(SearchResults {
        has_next_page: false,
        results,
    })
}

pub fn genres_anime() -> Result<TagsResult, String> {
    or_anilist(jikan_genres_anime(), "genres", || {
        Ok(TagsResult {
            genres: MAL_ANILIST_GENRES
                .iter()
                .map(|(id, name)| Tag {
                    id: Some(*id),
                    name: name.to_string(),
                    slug: name.to_lowercase().replace(' ', "-"),
                    count: 0,
                    thumbnail: None,
                })
                .collect(),
            studios: vec![],
            has_next_page: false,
        })
    })
}

fn jikan_genres_anime() -> Result<TagsResult, String> {
    let response: JikanResponse<Vec<JikanGenre>> = JIKAN.get_parsed("/genres/anime")?;

    let genres = response
        .data
        .iter()
        .map(|g| Tag {
            id: Some(g.mal_id),
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

// Schedules come from AniList's airing schedule instead of Jikan's /schedules:
// Jikan goes down for long stretches, and AniList has exact air times plus
// the MAL id that the rest of the app keys on.
const ANILIST_URL: &str = "https://graphql.anilist.co";
const ANILIST_SCHEDULE_QUERY: &str = r#"query ($page: Int, $from: Int, $to: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      airingAt
      episode
      media {
        idMal
        title { romaji english }
        coverImage { large }
        description(asHtml: false)
        seasonYear
        status
        averageScore
        episodes
        format
        genres
        isAdult
        popularity
        studios(isMain: true) { nodes { name } }
      }
    }
  }
}"#;

const JST_OFFSET_SECS: i32 = 9 * 3600;
const WEEKDAYS: [&str; 7] = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

/// Unix-seconds window for `day` in JST: the next occurrence of that weekday
/// (today counts), or the coming seven days when no day is given.
fn schedule_window(day: Option<&str>, now: chrono::DateTime<chrono::Utc>) -> Result<(i64, i64), String> {
    use chrono::{Datelike, FixedOffset};
    let jst = FixedOffset::east_opt(JST_OFFSET_SECS).expect("valid offset");
    let today = now.with_timezone(&jst).date_naive();
    let today_start = today
        .and_hms_opt(0, 0, 0)
        .expect("midnight exists")
        .and_local_timezone(jst)
        .unwrap()
        .timestamp();
    match day {
        None => Ok((today_start, today_start + 7 * 86400)),
        Some(d) => {
            let target = WEEKDAYS
                .iter()
                .position(|w| w.eq_ignore_ascii_case(d))
                .ok_or_else(|| format!("Unknown schedule day: {}", d))? as i64;
            let current = today.weekday().num_days_from_monday() as i64;
            let start = today_start + ((target - current).rem_euclid(7)) * 86400;
            Ok((start, start + 86400))
        }
    }
}

fn anilist_format(format: Option<&str>) -> Option<String> {
    format.map(|f| match f {
        "TV" | "TV_SHORT" => "TV".to_string(),
        "MOVIE" => "Movie".to_string(),
        "SPECIAL" => "Special".to_string(),
        "MUSIC" => "Music".to_string(),
        // Manga formats, worded like Jikan's manga types.
        "MANGA" => "Manga".to_string(),
        "NOVEL" => "Light Novel".to_string(),
        "ONE_SHOT" => "One-shot".to_string(),
        other => other.to_string(), // OVA, ONA
    })
}

fn anilist_status(status: Option<&str>) -> Option<String> {
    status.map(|s| match s {
        "RELEASING" => "Releasing".to_string(),
        "FINISHED" => "Completed".to_string(),
        "NOT_YET_RELEASED" => "Not Yet Released".to_string(),
        "HIATUS" => "On Hiatus".to_string(),
        "CANCELLED" => "Discontinued".to_string(),
        other => other.to_string(),
    })
}

pub(crate) fn strip_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

/// Map AniList Media to a SearchResult. Entries without a MAL id are
/// dropped: library, details and playback all key on it.
pub(crate) fn anilist_media_to_search_result(media: &serde_json::Value, sfw: bool) -> Option<SearchResult> {
    let mal_id = media.get("idMal")?.as_i64()?;
    if sfw && media.get("isAdult").and_then(|v| v.as_bool()).unwrap_or(false) {
        return None;
    }
    let str_at = |v: &serde_json::Value, key: &str| v.get(key).and_then(|x| x.as_str()).map(str::to_string);
    let title = media.get("title")?;
    let english = str_at(title, "english");
    let romaji = str_at(title, "romaji");

    Some(SearchResult {
        id: mal_id.to_string(),
        title: romaji.clone().or_else(|| english.clone())?,
        cover_url: media.get("coverImage").and_then(|c| str_at(c, "large")),
        trailer_url: None,
        description: str_at(media, "description").map(|d| strip_html(&d)),
        // Manga have no season: fall back to the start year.
        year: media
            .get("seasonYear")
            .and_then(|v| v.as_u64())
            .or_else(|| media.pointer("/startDate/year").and_then(|v| v.as_u64()))
            .map(|y| y as u32),
        status: anilist_status(media.get("status").and_then(|v| v.as_str())),
        rating: media.get("averageScore").and_then(|v| v.as_f64()).map(|s| (s / 10.0) as f32),
        latest_episode: None,
        latest_episode_date: None,
        // Episodes for anime, chapters for manga (the field the app shows as "eps"/"chs").
        available_episodes: media
            .get("episodes")
            .and_then(|v| v.as_u64())
            .or_else(|| media.get("chapters").and_then(|v| v.as_u64()))
            .map(|e| e as u32),
        media_type: anilist_format(media.get("format").and_then(|v| v.as_str())),
        genres: media.get("genres").and_then(|g| serde_json::from_value(g.clone()).ok()),
        native_name: None,
        title_synonyms: english.filter(|e| Some(e) != romaji.as_ref()).map(|e| vec![e]),
        rank: None,
        popularity: media.get("popularity").and_then(|v| v.as_i64()).map(|p| p as i32),
        views: None,
        studios: media
            .pointer("/studios/nodes")
            .and_then(|n| n.as_array())
            .map(|nodes| nodes.iter().filter_map(|n| str_at(n, "name")).collect()),
        broadcast_day: None,
        broadcast_time: None,
        broadcast_timezone: None,
    })
}

fn anilist_airing_to_search_result(entry: &serde_json::Value, sfw: bool) -> Option<SearchResult> {
    use chrono::{FixedOffset, TimeZone};
    let mut result = anilist_media_to_search_result(entry.get("media")?, sfw)?;
    let jst = FixedOffset::east_opt(JST_OFFSET_SECS).expect("valid offset");
    let airs = jst.timestamp_opt(entry.get("airingAt")?.as_i64()?, 0).single()?;
    result.latest_episode = entry.get("episode").and_then(|v| v.as_u64()).map(|e| e as u32);
    // Same shape Jikan used: plural weekday + HH:MM in JST.
    result.broadcast_day = Some(format!("{}s", airs.format("%A")));
    result.broadcast_time = Some(airs.format("%H:%M").to_string());
    result.broadcast_timezone = Some("Asia/Tokyo".to_string());
    Some(result)
}

/// POST a GraphQL body to AniList. AniList rate-limits per minute (30/min
/// while degraded), so a 429 waits out its Retry-After (capped) and retries.
pub(crate) fn anilist_post(body: serde_json::Value) -> Result<serde_json::Value, String> {
    const MAX_ATTEMPTS: u32 = 3;
    const MAX_WAIT_SECS: u64 = 15;
    for attempt in 1..=MAX_ATTEMPTS {
        match ureq::post(ANILIST_URL)
            .timeout(std::time::Duration::from_secs(20))
            .set("Accept", "application/json")
            .send_json(body.clone())
        {
            Ok(response) => {
                return response
                    .into_json()
                    .map_err(|e| format!("AniList response was not JSON: {}", e))
            }
            Err(ureq::Error::Status(429, response)) if attempt < MAX_ATTEMPTS => {
                let wait = response
                    .header("Retry-After")
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(5)
                    .min(MAX_WAIT_SECS);
                log::warn!("AniList rate limited; retrying in {}s", wait);
                std::thread::sleep(std::time::Duration::from_secs(wait));
            }
            Err(e) => return Err(format!("AniList request failed: {}", e)),
        }
    }
    unreachable!("the last attempt always returns")
}

const ANILIST_DETAILS_QUERY: &str = r#"query ($idMal: Int) {
  Media(idMal: $idMal, type: ANIME) {
    title { romaji english native }
    synonyms
    coverImage { extraLarge large }
    trailer { id site }
    description(asHtml: false)
    genres
    status
    seasonYear
    season
    averageScore
    format
    duration
    episodes
    startDate { year month day }
    nextAiringEpisode { episode airingAt }
  }
}"#;

const WEEK_SECS: i64 = 7 * 86400;

/// Map AniList's Media to the MediaDetails shape Jikan produced. Episode ids
/// keep the "{malId}-{n}" form so watch history and downloads still match.
fn anilist_media_to_details(mal_id: i64, media: &serde_json::Value) -> Option<MediaDetails> {
    use chrono::TimeZone;
    let str_at = |v: &serde_json::Value, key: &str| v.get(key).and_then(|x| x.as_str()).map(str::to_string);
    let title = media.get("title")?;
    let romaji = str_at(title, "romaji");
    let english = str_at(title, "english");
    let total = media.get("episodes").and_then(|v| v.as_u64()).map(|e| e as u32);

    // Airing shows: everything before the next episode has aired.
    let next = media.get("nextAiringEpisode").filter(|n| !n.is_null());
    let next_ep = next.and_then(|n| n.get("episode")).and_then(|v| v.as_u64()).map(|e| e as u32);
    let next_at = next.and_then(|n| n.get("airingAt")).and_then(|v| v.as_i64());
    let aired_count = match next_ep {
        Some(n) => n.saturating_sub(1),
        None if str_at(media, "status").as_deref() == Some("NOT_YET_RELEASED") => 0,
        None => total.unwrap_or(1),
    };
    let episodes = (1..=aired_count)
        .map(|n| Episode {
            id: format!("{}-{}", mal_id, n),
            number: n as f32,
            title: Some(format!("Episode {}", n)),
            thumbnail: None,
            aired: None,
            duration: None,
        })
        .collect();

    // Last episode aired one week before the next one (weekly shows), which is
    // what the next-episode countdown expects.
    let last_update_end = next_at
        .filter(|_| aired_count > 0)
        .and_then(|at| chrono::Utc.timestamp_opt(at - WEEK_SECS, 0).single())
        .map(|t| t.to_rfc3339());

    let trailer_url = media.get("trailer").filter(|t| str_at(t, "site").as_deref() == Some("youtube"))
        .and_then(|t| str_at(t, "id"))
        .map(|id| format!("https://www.youtube.com/embed/{}", id));
    let start = media.get("startDate");
    let year = media.get("seasonYear").and_then(|v| v.as_u64()).map(|y| y as u32);

    Some(MediaDetails {
        id: mal_id.to_string(),
        title: romaji.clone().or_else(|| english.clone())?,
        english_name: english,
        native_name: str_at(title, "native"),
        title_synonyms: media.get("synonyms").and_then(|v| serde_json::from_value(v.clone()).ok()),
        cover_url: media.get("coverImage").and_then(|c| str_at(c, "extraLarge").or_else(|| str_at(c, "large"))),
        trailer_url,
        description: str_at(media, "description").map(|d| strip_html(&d)),
        genres: media.get("genres").and_then(|g| serde_json::from_value(g.clone()).ok()).unwrap_or_default(),
        status: anilist_status(media.get("status").and_then(|v| v.as_str())),
        year,
        rating: media.get("averageScore").and_then(|v| v.as_f64()).map(|s| (s / 10.0) as f32),
        episodes,
        media_type: anilist_format(media.get("format").and_then(|v| v.as_str())),
        season: str_at(media, "season").map(|q| Season {
            quarter: Some(q.to_lowercase()),
            year,
        }),
        episode_duration: media.get("duration").and_then(|v| v.as_u64()).map(|m| m * 60_000),
        episode_count: total,
        aired_start: start.and_then(|d| {
            Some(AiredStart {
                year: d.get("year")?.as_u64()? as u32,
                month: d.get("month").and_then(|v| v.as_u64()).map(|v| v as u32),
                date: d.get("day").and_then(|v| v.as_u64()).map(|v| v as u32),
            })
        }),
        broadcast_interval: last_update_end.as_ref().map(|_| (WEEK_SECS * 1000) as u64),
        last_update_end,
    })
}

fn anilist_anime_details(mal_id: i64) -> Result<MediaDetails, String> {
    let response = anilist_post(serde_json::json!({
        "query": ANILIST_DETAILS_QUERY,
        "variables": { "idMal": mal_id },
    }))?;
    response
        .pointer("/data/Media")
        .filter(|m| !m.is_null())
        .and_then(|m| anilist_media_to_details(mal_id, m))
        .ok_or_else(|| format!("AniList has no anime with MAL id {}", mal_id))
}

const ANILIST_MEDIA_FIELDS: &str = "idMal title { romaji english } coverImage { large } description(asHtml: false) seasonYear startDate { year } status averageScore episodes chapters format genres isAdult popularity studios(isMain: true) { nodes { name } }";

/// Filters for AniList's Page.media, mirroring what the Jikan list endpoints
/// accept. Unset fields are sent as null, which AniList treats as "no filter".
#[derive(Default)]
pub(crate) struct AnilistMediaQuery<'a> {
    /// Read manga instead of anime.
    pub manga: bool,
    pub search: Option<&'a str>,
    pub sort: Option<&'a str>,
    pub status: Option<&'a str>,
    pub formats: Option<Vec<&'a str>>,
    pub genres: Option<Vec<&'a str>>,
    pub season: Option<String>,
    pub season_year: Option<i32>,
    pub min_score: Option<i64>,
    pub max_score: Option<i64>,
    pub adult: Option<bool>,
}

pub(crate) fn anilist_media_page(page: i32, sfw: bool, q: AnilistMediaQuery) -> Result<SearchResults, String> {
    let query = format!(
        "query ($page: Int, $search: String, $sort: [MediaSort], $status: MediaStatus, $formats: [MediaFormat], $genres: [String], $season: MediaSeason, $seasonYear: Int, $minScore: Int, $maxScore: Int, $adult: Boolean) {{ Page(page: $page, perPage: 25) {{ pageInfo {{ hasNextPage }} media(type: {}, search: $search, sort: $sort, status: $status, format_in: $formats, genre_in: $genres, season: $season, seasonYear: $seasonYear, averageScore_greater: $minScore, averageScore_lesser: $maxScore, isAdult: $adult) {{ {} }} }} }}",
        if q.manga { "MANGA" } else { "ANIME" },
        ANILIST_MEDIA_FIELDS
    );
    // Unset filters must be left out of the variables entirely: AniList treats
    // an explicit null as a filter value (empty results, 400s or 500s).
    let mut vars = serde_json::Map::new();
    let mut set = |key: &str, value: serde_json::Value| {
        if !value.is_null() {
            vars.insert(key.to_string(), value);
        }
    };
    let search = q.search.filter(|s| !s.trim().is_empty());
    set("page", page.max(1).into());
    set("sort", serde_json::json!([q.sort.unwrap_or(if search.is_some() { "SEARCH_MATCH" } else { "POPULARITY_DESC" })]));
    set("search", serde_json::json!(search));
    set("status", serde_json::json!(q.status));
    set("formats", serde_json::json!(q.formats));
    set("genres", serde_json::json!(q.genres));
    set("season", serde_json::json!(q.season));
    set("seasonYear", serde_json::json!(q.season_year));
    set("minScore", serde_json::json!(q.min_score));
    set("maxScore", serde_json::json!(q.max_score));
    set("adult", serde_json::json!(if sfw { Some(false) } else { q.adult }));
    let response = anilist_post(serde_json::json!({ "query": query, "variables": vars }))?;
    let page_data = response
        .pointer("/data/Page")
        .ok_or_else(|| format!("AniList error: {}", response.get("errors").unwrap_or(&response)))?;
    Ok(SearchResults {
        results: page_data
            .get("media")
            .and_then(|v| v.as_array())
            .map(|m| m.iter().filter_map(|x| anilist_media_to_search_result(x, sfw)).collect())
            .unwrap_or_default(),
        has_next_page: page_data
            .pointer("/pageInfo/hasNextPage")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

/// Use Jikan's answer, or AniList's when Jikan fails for any reason but a 404.
pub(crate) fn or_anilist<T>(jikan: Result<T, String>, what: &str, anilist: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    match jikan {
        Err(e) if !e.contains("Jikan API error 404") => {
            log::warn!("Jikan {} failed: {}; using AniList", what, e);
            anilist().map_err(|a| format!("{} (AniList fallback: {})", e, a))
        }
        other => other,
    }
}

fn anilist_status_filter(jikan_status: &str) -> Option<&'static str> {
    match jikan_status {
        "airing" => Some("RELEASING"),
        "complete" => Some("FINISHED"),
        "upcoming" => Some("NOT_YET_RELEASED"),
        _ => None,
    }
}

fn anilist_formats(jikan_type: &str) -> Option<Vec<&'static str>> {
    Some(match jikan_type.to_ascii_lowercase().as_str() {
        "tv" => vec!["TV", "TV_SHORT"],
        "movie" => vec!["MOVIE"],
        "ova" => vec!["OVA"],
        "ona" => vec!["ONA"],
        "special" | "tv_special" => vec!["SPECIAL"],
        "music" => vec!["MUSIC"],
        _ => return None,
    })
}

/// Jikan order_by + sort to an AniList MediaSort. Jikan's popularity and rank
/// are positions (1 = best), so their ascending order is AniList's descending.
pub(crate) fn anilist_sort(order_by: Option<&str>, sort: Option<&str>) -> &'static str {
    let asc = sort == Some("asc");
    match order_by.unwrap_or("popularity") {
        "popularity" | "members" => if asc { "POPULARITY_DESC" } else { "POPULARITY" },
        "rank" => if asc { "SCORE_DESC" } else { "SCORE" },
        "score" => if asc { "SCORE" } else { "SCORE_DESC" },
        "start_date" => if asc { "START_DATE" } else { "START_DATE_DESC" },
        "title" => if asc { "TITLE_ROMAJI" } else { "TITLE_ROMAJI_DESC" },
        "episodes" => if asc { "EPISODES" } else { "EPISODES_DESC" },
        "chapters" => if asc { "CHAPTERS" } else { "CHAPTERS_DESC" },
        "favorites" => if asc { "FAVOURITES" } else { "FAVOURITES_DESC" },
        _ => "POPULARITY_DESC",
    }
}

/// MAL genre ids (what the genre picker sends) and their AniList names.
/// AniList has only these genres; MAL themes/demographics have no equivalent.
pub(crate) const MAL_ANILIST_GENRES: &[(i64, &str)] = &[
    (1, "Action"), (2, "Adventure"), (4, "Comedy"), (8, "Drama"), (9, "Ecchi"),
    (10, "Fantasy"), (12, "Hentai"), (14, "Horror"), (7, "Mystery"), (18, "Mecha"),
    (19, "Music"), (22, "Romance"), (24, "Sci-Fi"), (30, "Sports"), (36, "Slice of Life"),
    (37, "Supernatural"), (40, "Psychological"), (41, "Thriller"), (66, "Mahou Shoujo"),
];

pub(crate) fn anilist_genre(mal_id: &str) -> Option<&'static str> {
    let id: i64 = mal_id.trim().parse().ok()?;
    MAL_ANILIST_GENRES.iter().find(|(m, _)| *m == id).map(|(_, name)| *name)
}

fn current_anilist_season() -> (String, i32) {
    use chrono::Datelike;
    let now = chrono::Utc::now();
    let season = match now.month() {
        1..=3 => "WINTER",
        4..=6 => "SPRING",
        7..=9 => "SUMMER",
        _ => "FALL",
    };
    (season.to_string(), now.year())
}

pub fn schedules(day: Option<&str>, page: i32, sfw: bool) -> Result<SearchResults, String> {
    let (from, to) = schedule_window(day, chrono::Utc::now())?;
    let body = serde_json::json!({
        "query": ANILIST_SCHEDULE_QUERY,
        "variables": { "page": page.max(1), "from": from - 1, "to": to },
    });
    let response = anilist_post(body)?;
    let page_data = response
        .pointer("/data/Page")
        .ok_or_else(|| format!("AniList schedule error: {}", response.get("errors").unwrap_or(&response)))?;
    let entries = page_data
        .get("airingSchedules")
        .and_then(|v| v.as_array())
        .map(Vec::as_slice)
        .unwrap_or_default();

    // A show can air twice in one window (double episodes); keep its first slot.
    let mut seen = std::collections::HashSet::new();
    let results = entries
        .iter()
        .filter_map(|e| anilist_airing_to_search_result(e, sfw))
        .filter(|r| seen.insert(r.id.clone()))
        .collect();

    Ok(SearchResults {
        results,
        has_next_page: page_data
            .pointer("/pageInfo/hasNextPage")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

pub fn random_anime() -> Result<SearchResult, String> {
    let response: JikanResponse<JikanAnime> = JIKAN.get_parsed("/random/anime")?;
    Ok(jikan_anime_to_search_result(&response.data))
}

// --- Enrichment functions ---

pub fn anime_characters(mal_id: i64) -> Result<Vec<JikanCharacterEntry>, String> {
    let path = format!("/anime/{}/characters", mal_id);
    let response: JikanResponse<Vec<JikanCharacterEntry>> = JIKAN.get_parsed(&path)?;
    Ok(response.data)
}

pub fn anime_staff(mal_id: i64) -> Result<Vec<JikanStaffEntry>, String> {
    let path = format!("/anime/{}/staff", mal_id);
    let response: JikanResponse<Vec<JikanStaffEntry>> = JIKAN.get_parsed(&path)?;
    Ok(response.data)
}

pub fn anime_statistics(mal_id: i64) -> Result<JikanStatistics, String> {
    let path = format!("/anime/{}/statistics", mal_id);
    let response: JikanResponse<JikanStatistics> = JIKAN.get_parsed(&path)?;
    Ok(response.data)
}

pub fn anime_reviews(mal_id: i64, page: i32) -> Result<Vec<JikanReview>, String> {
    let page_str = page.to_string();
    let path = format!("/anime/{}/reviews", mal_id);
    let response: JikanPaginatedResponse<JikanReview> =
        JIKAN.get_parsed_with_query(&path, &[("page", &page_str)])?;
    Ok(response.data)
}

pub fn anime_pictures(mal_id: i64) -> Result<Vec<JikanPicture>, String> {
    let path = format!("/anime/{}/pictures", mal_id);
    let response: JikanResponse<Vec<JikanPicture>> = JIKAN.get_parsed(&path)?;
    Ok(response.data)
}

pub fn anime_news(mal_id: i64) -> Result<Vec<JikanNews>, String> {
    let path = format!("/anime/{}/news", mal_id);
    let response: JikanPaginatedResponse<JikanNews> = JIKAN.get_parsed(&path)?;
    Ok(response.data)
}

// --- Filtered search ---

#[allow(clippy::too_many_arguments)]
pub fn search_anime_filtered(
    query: Option<&str>,
    page: i32,
    sfw: bool,
    genres: Option<&str>,
    order_by: Option<&str>,
    sort: Option<&str>,
    status: Option<&str>,
    anime_type: Option<&str>,
    min_score: Option<&str>,
    max_score: Option<&str>,
    rating: Option<&str>,
) -> Result<SearchResults, String> {
    let jikan = jikan_search_anime_filtered(
        query, page, sfw, genres, order_by, sort, status, anime_type, min_score, max_score, rating,
    );
    or_anilist(jikan, "filtered search", || {
        let genre_names = match genres.filter(|g| !g.trim().is_empty()) {
            Some(g) => Some(
                g.split(',')
                    .map(|id| anilist_genre(id).ok_or_else(|| format!("genre {} has no AniList equivalent", id)))
                    .collect::<Result<Vec<_>, _>>()?,
            ),
            None => None,
        };
        let score = |v: Option<&str>| v.and_then(|s| s.parse::<f64>().ok()).map(|s| (s * 10.0).round() as i64);
        anilist_media_page(page, sfw, AnilistMediaQuery {
            search: query,
            sort: Some(anilist_sort(order_by, sort)),
            status: status.and_then(anilist_status_filter),
            formats: anime_type.and_then(anilist_formats),
            genres: genre_names,
            // AniList's bounds are exclusive.
            min_score: score(min_score).map(|s| s - 1),
            max_score: score(max_score).map(|s| s + 1),
            adult: rating.map(|r| r == "rx"),
            ..Default::default()
        })
    })
}

#[allow(clippy::too_many_arguments)]
fn jikan_search_anime_filtered(
    query: Option<&str>,
    page: i32,
    sfw: bool,
    genres: Option<&str>,
    order_by: Option<&str>,
    sort: Option<&str>,
    status: Option<&str>,
    anime_type: Option<&str>,
    min_score: Option<&str>,
    max_score: Option<&str>,
    rating: Option<&str>,
) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params: Vec<(&str, &str)> = vec![("page", &page_str), ("limit", "25")];

    if let Some(q) = query {
        if !q.is_empty() {
            params.push(("q", q));
        }
    }
    if sfw {
        params.push(("sfw", "true"));
    }
    if let Some(g) = genres {
        if !g.is_empty() {
            params.push(("genres", g));
        }
    }
    if let Some(o) = order_by {
        params.push(("order_by", o));
    }
    if let Some(s) = sort {
        params.push(("sort", s));
    }
    if let Some(st) = status {
        params.push(("status", st));
    }
    if let Some(t) = anime_type {
        params.push(("type", t));
    }
    if let Some(ms) = min_score {
        params.push(("min_score", ms));
    }
    if let Some(mx) = max_score {
        params.push(("max_score", mx));
    }
    if let Some(r) = rating {
        params.push(("rating", r));
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

#[cfg(test)]
mod schedule_tests {
    use super::*;
    use chrono::TimeZone;

    // 2026-11-07 is a Saturday. 20:00 UTC Friday 11-06 is already 05:00 Saturday in JST.
    fn fri_evening_utc() -> chrono::DateTime<chrono::Utc> {
        chrono::Utc.with_ymd_and_hms(2026, 11, 6, 20, 0, 0).unwrap()
    }
    const SAT_JST_MIDNIGHT: i64 = 1_793_977_200; // 2026-11-07T00:00+09:00

    #[test]
    fn window_uses_the_jst_day() {
        assert_eq!(
            schedule_window(Some("saturday"), fri_evening_utc()).unwrap(),
            (SAT_JST_MIDNIGHT, SAT_JST_MIDNIGHT + 86400)
        );
    }

    #[test]
    fn window_rolls_past_days_to_next_week() {
        let (from, to) = schedule_window(Some("Friday"), fri_evening_utc()).unwrap();
        assert_eq!(from, SAT_JST_MIDNIGHT + 6 * 86400);
        assert_eq!(to - from, 86400);
    }

    #[test]
    fn window_without_day_covers_a_week_and_rejects_unknown_days() {
        assert_eq!(
            schedule_window(None, fri_evening_utc()).unwrap(),
            (SAT_JST_MIDNIGHT, SAT_JST_MIDNIGHT + 7 * 86400)
        );
        assert!(schedule_window(Some("someday"), fri_evening_utc()).is_err());
    }

    #[test]
    fn maps_airing_entry_to_jikan_shaped_result() {
        let entry = serde_json::json!({
            "airingAt": SAT_JST_MIDNIGHT + 23 * 3600 + 30 * 60,
            "episode": 5,
            "media": {
                "idMal": 52991,
                "title": { "romaji": "Sousou no Frieren", "english": "Frieren" },
                "coverImage": { "large": "https://img/x.jpg" },
                "description": "An elf<br><i>mage</i>.",
                "seasonYear": 2023, "status": "RELEASING", "averageScore": 91,
                "episodes": 28, "format": "TV", "genres": ["Fantasy"], "isAdult": false,
                "popularity": 100, "studios": { "nodes": [{ "name": "Madhouse" }] }
            }
        });
        let r = anilist_airing_to_search_result(&entry, true).unwrap();
        assert_eq!(r.id, "52991");
        assert_eq!(r.broadcast_day.as_deref(), Some("Saturdays"));
        assert_eq!(r.broadcast_time.as_deref(), Some("23:30"));
        assert_eq!(r.description.as_deref(), Some("An elfmage."));
        assert_eq!(r.rating, Some(9.1));
        assert_eq!(r.media_type.as_deref(), Some("TV"));
        assert_eq!(r.status.as_deref(), Some("Releasing"));
        assert_eq!(r.title_synonyms, Some(vec!["Frieren".to_string()]));
        assert_eq!(r.studios, Some(vec!["Madhouse".to_string()]));
    }

    #[test]
    fn drops_entries_without_mal_id_and_adult_entries_in_sfw() {
        let no_mal = serde_json::json!({ "airingAt": 0, "media": { "idMal": null, "title": { "romaji": "X" } } });
        assert!(anilist_airing_to_search_result(&no_mal, false).is_none());
        let adult = serde_json::json!({ "airingAt": 0, "media": { "idMal": 1, "isAdult": true, "title": { "romaji": "X" } } });
        assert!(anilist_airing_to_search_result(&adult, true).is_none());
        assert!(anilist_airing_to_search_result(&adult, false).is_some());
    }

    #[test]
    fn maps_airing_media_to_details() {
        let media = serde_json::json!({
            "title": { "romaji": "One Piece", "english": "ONE PIECE", "native": "ワンピース" },
            "synonyms": ["OP"],
            "coverImage": { "extraLarge": "https://img/xl.jpg", "large": "https://img/l.jpg" },
            "trailer": { "id": "abc", "site": "youtube" },
            "description": "Pirates<br>.", "genres": ["Action"], "status": "RELEASING",
            "seasonYear": 1999, "season": "FALL", "averageScore": 87, "format": "TV",
            "duration": 24, "episodes": null,
            "startDate": { "year": 1999, "month": 10, "day": 20 },
            "nextAiringEpisode": { "episode": 1150, "airingAt": SAT_JST_MIDNIGHT }
        });
        let d = anilist_media_to_details(21, &media).unwrap();
        assert_eq!(d.id, "21");
        assert_eq!(d.episodes.len(), 1149);
        assert_eq!(d.episodes.last().unwrap().id, "21-1149");
        assert_eq!(d.cover_url.as_deref(), Some("https://img/xl.jpg"));
        assert_eq!(d.trailer_url.as_deref(), Some("https://www.youtube.com/embed/abc"));
        assert_eq!(d.season.as_ref().unwrap().quarter.as_deref(), Some("fall"));
        assert_eq!(d.episode_duration, Some(24 * 60_000));
        assert_eq!(d.status.as_deref(), Some("Releasing"));
        let last = chrono::DateTime::parse_from_rfc3339(d.last_update_end.as_deref().unwrap()).unwrap();
        assert_eq!(last.timestamp(), SAT_JST_MIDNIGHT - WEEK_SECS);
        assert_eq!(d.broadcast_interval, Some(604_800_000));
    }

    #[test]
    fn finished_and_upcoming_media_episode_counts() {
        let finished = serde_json::json!({ "title": { "romaji": "X" }, "status": "FINISHED", "episodes": 12 });
        let d = anilist_media_to_details(1, &finished).unwrap();
        assert_eq!(d.episodes.len(), 12);
        assert!(d.last_update_end.is_none());
        let upcoming = serde_json::json!({ "title": { "romaji": "X" }, "status": "NOT_YET_RELEASED", "episodes": 12 });
        assert!(anilist_media_to_details(1, &upcoming).unwrap().episodes.is_empty());
    }

    #[test]
    #[ignore = "hits api.jikan.moe and graphql.anilist.co"]
    fn live_details() {
        for id in [52991, 59193] {
            let started = std::time::Instant::now();
            let d = anime_details(id).unwrap();
            println!("live details: {} eps={} in {:?}", d.title, d.episodes.len(), started.elapsed());
            assert!(!d.episodes.is_empty());
        }
    }

    #[test]
    fn maps_jikan_list_filters_to_anilist() {
        assert_eq!(anilist_sort(Some("popularity"), Some("asc")), "POPULARITY_DESC");
        assert_eq!(anilist_sort(Some("score"), Some("desc")), "SCORE_DESC");
        assert_eq!(anilist_sort(Some("title"), Some("asc")), "TITLE_ROMAJI");
        assert_eq!(anilist_formats("tv"), Some(vec!["TV", "TV_SHORT"]));
        assert_eq!(anilist_status_filter("complete"), Some("FINISHED"));
        assert_eq!(anilist_genre("1"), Some("Action"));
        assert_eq!(anilist_genre("27"), None); // Shounen is a MAL demographic
    }

    #[test]
    #[ignore = "hits api.jikan.moe and graphql.anilist.co"]
    fn live_list_fallbacks() {
        let show = |label: &str, r: Result<SearchResults, String>| {
            let r = r.unwrap();
            println!("live {}: {} results, next={}, first={:?}", label, r.results.len(), r.has_next_page,
                r.results.first().map(|x| (&x.id, &x.title)));
            assert!(!r.results.is_empty(), "{} empty", label);
        };
        show("search juju", search_anime("juju", 1, true));
        show("filtered action+score>=8", search_anime_filtered(
            None, 1, true, Some("1"), Some("popularity"), Some("asc"), None, Some("tv"), Some("8"), None, None));
        show("filtered query", search_anime_filtered(
            Some("jujutsu"), 1, true, None, Some("popularity"), Some("asc"), None, None, None, None, None));
        show("top airing", top_anime(1, None, Some("airing"), true));
        show("season now", season_now(1, true));
        show("season fall 2025", season(2025, "fall", 1, true));
        show("upcoming", season_upcoming(1, true));
        show("popular episodes", watch_episodes_popular());
        assert_eq!(genres_anime().unwrap().genres.len(), MAL_ANILIST_GENRES.len());
    }

    #[test]
    #[ignore = "hits graphql.anilist.co"]
    fn live_schedule() {
        let r = schedules(Some("saturday"), 1, true).unwrap();
        println!("live: {} results, next={}, first={:?}", r.results.len(), r.has_next_page,
            r.results.first().map(|x| (&x.title, &x.broadcast_day, &x.broadcast_time)));
        assert!(!r.results.is_empty());
    }
}
