use super::anime::{
    anilist_genre, anilist_media_page, anilist_media_to_search_result, anilist_post, anilist_sort,
    extract_genre_names, extract_image_url, or_anilist, strip_html, AnilistMediaQuery, MAL_ANILIST_GENRES,
};
use super::client::JIKAN;
use super::types::*;
use crate::extensions::types::{
    Chapter, MangaDetails, SearchResult, SearchResults, Tag, TagsResult,
};

fn map_manga_status(status: Option<&str>) -> Option<String> {
    status.map(|s| match s {
        "Publishing" => "Releasing".to_string(),
        "Finished" => "Completed".to_string(),
        "On Hiatus" => "On Hiatus".to_string(),
        "Discontinued" => "Discontinued".to_string(),
        other => other.to_string(),
    })
}

fn extract_published_year(manga: &JikanManga) -> Option<u32> {
    manga
        .published
        .as_ref()
        .and_then(|p| p.prop.as_ref())
        .and_then(|p| p.from.as_ref())
        .and_then(|f| f.year)
        .map(|y| y as u32)
}

fn jikan_manga_to_search_result(manga: &JikanManga) -> SearchResult {
    SearchResult {
        id: manga.mal_id.to_string(),
        // English first for display; romaji stays a synonym for provider matching.
        title: manga.title_english.clone().filter(|e| !e.is_empty()).unwrap_or_else(|| manga.title.clone()),
        cover_url: extract_image_url(&manga.images),
        trailer_url: None,
        description: manga.synopsis.clone(),
        year: extract_published_year(manga),
        status: map_manga_status(manga.status.as_deref()),
        rating: manga.score.map(|s| s as f32),
        latest_episode: None,
        latest_episode_date: None,
        available_episodes: manga.chapters.map(|c| c as u32),
        media_type: manga.manga_type.clone(),
        genres: Some(extract_genre_names(&manga.genres)),
        native_name: None,
        title_synonyms: match manga.title_english.as_deref() {
            Some(e) if !e.is_empty() && e != manga.title => Some(vec![manga.title.clone()]),
            _ => None,
        },
        rank: manga.rank,
        popularity: manga.popularity,
        views: None,
        studios: None,
        broadcast_day: None,
        broadcast_time: None,
        broadcast_timezone: None,
    }
}

/// Collect all title synonyms from a Jikan manga entry.
/// Gathers from title_synonyms, title_japanese, and titles[] (skipping Default/English
/// which are already passed as title/english_name).
fn collect_manga_synonyms(manga: &JikanManga) -> Option<Vec<String>> {
    let mut synonyms = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Some(ref syns) = manga.title_synonyms {
        for s in syns {
            if !s.is_empty() && seen.insert(s.to_lowercase()) {
                synonyms.push(s.clone());
            }
        }
    }

    if let Some(ref jp) = manga.title_japanese {
        if !jp.is_empty() && seen.insert(jp.to_lowercase()) {
            synonyms.push(jp.clone());
        }
    }

    if let Some(ref titles) = manga.titles {
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

fn jikan_manga_to_manga_details(manga: &JikanManga) -> MangaDetails {
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
        title_synonyms: collect_manga_synonyms(manga),
        cover_url: extract_image_url(&manga.images),
        trailer_url: None,
        description: manga.synopsis.clone(),
        genres: extract_genre_names(&manga.genres),
        status: map_manga_status(manga.status.as_deref()),
        year: extract_published_year(manga),
        rating: manga.score.map(|s| s as f32),
        chapters,
        media_type: manga.manga_type.clone(),
        season: None,
        total_chapters: manga.chapters.map(|c| c as u32),
        volumes: manga.volumes.map(|v| v as u32),
        authors: manga.authors.as_ref().map(|a| a.iter().map(|e| e.name.clone()).collect()),
        serializations: manga.serializations.as_ref().map(|s| s.iter().map(|e| e.name.clone()).collect()),
        demographics: manga.demographics.as_ref().map(|d| d.iter().map(|e| e.name.clone()).collect()),
        themes: manga.themes.as_ref().map(|t| t.iter().map(|e| e.name.clone()).collect()),
        background: manga.background.clone(),
    }
}

// --- AniList fallback (Jikan is unreachable for long stretches) ---

/// Jikan manga status filter to AniList MediaStatus.
fn anilist_manga_status(jikan_status: &str) -> Option<&'static str> {
    match jikan_status {
        "publishing" => Some("RELEASING"),
        "complete" => Some("FINISHED"),
        "hiatus" => Some("HIATUS"),
        "discontinued" => Some("CANCELLED"),
        "upcoming" => Some("NOT_YET_RELEASED"),
        _ => None,
    }
}

/// Jikan manga type to AniList formats. AniList has no manhwa/manhua format
/// (they are MANGA from another country), so those map to MANGA.
fn anilist_manga_formats(jikan_type: &str) -> Option<Vec<&'static str>> {
    Some(match jikan_type.to_ascii_lowercase().as_str() {
        "manga" | "manhwa" | "manhua" | "doujin" => vec!["MANGA"],
        "novel" | "lightnovel" => vec!["NOVEL"],
        "oneshot" => vec!["ONE_SHOT"],
        _ => return None,
    })
}

fn anilist_manga_details(mal_id: i64) -> Result<MangaDetails, String> {
    let response = anilist_post(serde_json::json!({
        "query": "query ($idMal: Int) { Media(idMal: $idMal, type: MANGA) { idMal title { romaji english native } synonyms coverImage { extraLarge large } description(asHtml: false) genres status averageScore format chapters volumes isAdult popularity startDate { year } staff(perPage: 4, sort: RELEVANCE) { nodes { name { full } } } } }",
        "variables": { "idMal": mal_id },
    }))?;
    let media = response
        .pointer("/data/Media")
        .filter(|m| !m.is_null())
        .ok_or_else(|| format!("AniList has no manga with MAL id {}", mal_id))?;
    let base = anilist_media_to_search_result(media, false)
        .ok_or_else(|| format!("AniList manga {} is missing a title", mal_id))?;
    let str_at = |v: &serde_json::Value, key: &str| v.get(key).and_then(|x| x.as_str()).map(str::to_string);
    let total = media.get("chapters").and_then(|v| v.as_u64()).map(|c| c as u32);
    // Same as the Jikan path: chapter rows are synthesized from the count; the
    // reader gets real chapters from the manga extension.
    let chapters = (1..=total.unwrap_or(0))
        .map(|n| Chapter {
            id: format!("{}-{}", mal_id, n),
            number: n as f32,
            title: Some(format!("Chapter {}", n)),
            thumbnail: None,
            release_date: None,
        })
        .collect();
    let title = media.get("title");
    Ok(MangaDetails {
        id: base.id,
        title: base.title.clone(),
        english_name: title.and_then(|t| str_at(t, "english")),
        native_name: title.and_then(|t| str_at(t, "native")),
        title_synonyms: {
            let mut syn: Vec<String> = media.get("synonyms").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
            if let Some(r) = title.and_then(|t| str_at(t, "romaji")).filter(|r| *r != base.title && !syn.contains(r)) {
                syn.insert(0, r);
            }
            if syn.is_empty() { None } else { Some(syn) }
        },
        cover_url: media
            .get("coverImage")
            .and_then(|c| str_at(c, "extraLarge").or_else(|| str_at(c, "large"))),
        trailer_url: None,
        description: str_at(media, "description").map(|d| strip_html(&d)),
        genres: base.genres.unwrap_or_default(),
        status: base.status,
        year: base.year,
        rating: base.rating,
        chapters,
        media_type: base.media_type,
        season: None,
        total_chapters: total,
        volumes: media.get("volumes").and_then(|v| v.as_u64()).map(|v| v as u32),
        authors: media
            .pointer("/staff/nodes")
            .and_then(|n| n.as_array())
            .map(|nodes| nodes.iter().filter_map(|n| n.pointer("/name/full").and_then(|x| x.as_str()).map(str::to_string)).collect()),
        serializations: None,
        demographics: None,
        themes: None,
        background: None,
    })
}

// --- Public API functions ---

pub fn search_manga(query: &str, page: i32, sfw: bool) -> Result<SearchResults, String> {
    or_anilist(jikan_search_manga(query, page, sfw), "manga search", || {
        anilist_media_page(page, sfw, AnilistMediaQuery { manga: true, search: Some(query), ..Default::default() })
    })
}

fn jikan_search_manga(query: &str, page: i32, sfw: bool) -> Result<SearchResults, String> {
    let page_str = page.to_string();
    let mut params = vec![("q", query), ("page", &page_str), ("limit", "25")];
    if sfw {
        params.push(("sfw", "true"));
    }

    let response: JikanPaginatedResponse<JikanManga> =
        JIKAN.get_parsed_with_query("/manga", &params)?;

    Ok(SearchResults {
        results: response
            .data
            .iter()
            .map(jikan_manga_to_search_result)
            .collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn top_manga(
    page: i32,
    type_filter: Option<&str>,
    filter: Option<&str>,
    sfw: bool,
) -> Result<SearchResults, String> {
    or_anilist(jikan_top_manga(page, type_filter, filter, sfw), "top manga", || {
        let (sort, status) = match filter {
            Some("publishing") => ("POPULARITY_DESC", Some("RELEASING")),
            Some("upcoming") => ("POPULARITY_DESC", Some("NOT_YET_RELEASED")),
            Some("bypopularity") => ("POPULARITY_DESC", None),
            Some("favorite") => ("FAVOURITES_DESC", None),
            _ => ("SCORE_DESC", None),
        };
        anilist_media_page(page, sfw, AnilistMediaQuery {
            manga: true,
            sort: Some(sort),
            status,
            formats: type_filter.and_then(anilist_manga_formats),
            ..Default::default()
        })
    })
}

fn jikan_top_manga(
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

    let response: JikanPaginatedResponse<JikanManga> =
        JIKAN.get_parsed_with_query("/top/manga", &params)?;

    Ok(SearchResults {
        results: response
            .data
            .iter()
            .map(jikan_manga_to_search_result)
            .collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn manga_details(mal_id: i64) -> Result<MangaDetails, String> {
    let path = format!("/manga/{}/full", mal_id);
    let jikan = JIKAN
        .get_parsed::<JikanResponse<JikanManga>>(&path)
        .map(|r| jikan_manga_to_manga_details(&r.data));
    or_anilist(jikan, "manga details", || anilist_manga_details(mal_id))
}

// --- Enrichment functions ---

pub fn manga_characters(mal_id: i64) -> Result<Vec<JikanCharacterEntry>, String> {
    let path = format!("/manga/{}/characters", mal_id);
    let response: JikanResponse<Vec<JikanCharacterEntry>> = JIKAN.get_parsed(&path)?;
    Ok(response.data)
}

pub fn manga_statistics(mal_id: i64) -> Result<JikanStatistics, String> {
    let path = format!("/manga/{}/statistics", mal_id);
    let response: JikanResponse<JikanStatistics> = JIKAN.get_parsed(&path)?;
    Ok(response.data)
}

pub fn manga_reviews(mal_id: i64, page: i32) -> Result<Vec<JikanReview>, String> {
    let page_str = page.to_string();
    let path = format!("/manga/{}/reviews", mal_id);
    let response: JikanPaginatedResponse<JikanReview> =
        JIKAN.get_parsed_with_query(&path, &[("page", &page_str)])?;
    Ok(response.data)
}

pub fn manga_pictures(mal_id: i64) -> Result<Vec<JikanPicture>, String> {
    let path = format!("/manga/{}/pictures", mal_id);
    let response: JikanResponse<Vec<JikanPicture>> = JIKAN.get_parsed(&path)?;
    Ok(response.data)
}

pub fn manga_news(mal_id: i64) -> Result<Vec<JikanNews>, String> {
    let path = format!("/manga/{}/news", mal_id);
    let response: JikanPaginatedResponse<JikanNews> = JIKAN.get_parsed(&path)?;
    Ok(response.data)
}

pub fn manga_recommendations(mal_id: i64) -> Result<SearchResults, String> {
    let path = format!("/manga/{}/recommendations", mal_id);
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

// --- Filtered search ---

#[allow(clippy::too_many_arguments)]
pub fn search_manga_filtered(
    query: Option<&str>,
    page: i32,
    sfw: bool,
    genres: Option<&str>,
    order_by: Option<&str>,
    sort: Option<&str>,
    status: Option<&str>,
    manga_type: Option<&str>,
    min_score: Option<&str>,
    max_score: Option<&str>,
) -> Result<SearchResults, String> {
    let jikan = jikan_search_manga_filtered(
        query, page, sfw, genres, order_by, sort, status, manga_type, min_score, max_score,
    );
    or_anilist(jikan, "manga filtered search", || {
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
            manga: true,
            search: query,
            sort: Some(anilist_sort(order_by, sort)),
            status: status.and_then(anilist_manga_status),
            formats: manga_type.and_then(anilist_manga_formats),
            genres: genre_names,
            // AniList's bounds are exclusive.
            min_score: score(min_score).map(|s| s - 1),
            max_score: score(max_score).map(|s| s + 1),
            ..Default::default()
        })
    })
}

#[allow(clippy::too_many_arguments)]
fn jikan_search_manga_filtered(
    query: Option<&str>,
    page: i32,
    sfw: bool,
    genres: Option<&str>,
    order_by: Option<&str>,
    sort: Option<&str>,
    status: Option<&str>,
    manga_type: Option<&str>,
    min_score: Option<&str>,
    max_score: Option<&str>,
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
    if let Some(t) = manga_type {
        params.push(("type", t));
    }
    if let Some(ms) = min_score {
        params.push(("min_score", ms));
    }
    if let Some(mx) = max_score {
        params.push(("max_score", mx));
    }

    let response: JikanPaginatedResponse<JikanManga> =
        JIKAN.get_parsed_with_query("/manga", &params)?;

    Ok(SearchResults {
        results: response
            .data
            .iter()
            .map(jikan_manga_to_search_result)
            .collect(),
        has_next_page: response.pagination.has_next_page,
    })
}

pub fn genres_manga() -> Result<TagsResult, String> {
    or_anilist(jikan_genres_manga(), "manga genres", || {
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

fn jikan_genres_manga() -> Result<TagsResult, String> {
    let response: JikanResponse<Vec<JikanGenre>> = JIKAN.get_parsed("/genres/manga")?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_jikan_manga_filters() {
        assert_eq!(anilist_manga_status("publishing"), Some("RELEASING"));
        assert_eq!(anilist_manga_status("discontinued"), Some("CANCELLED"));
        assert_eq!(anilist_manga_formats("manhwa"), Some(vec!["MANGA"]));
        assert_eq!(anilist_manga_formats("lightnovel"), Some(vec!["NOVEL"]));
        assert_eq!(anilist_manga_formats("oneshot"), Some(vec!["ONE_SHOT"]));
        assert_eq!(anilist_manga_formats("unknown"), None);
    }

    #[test]
    #[ignore = "hits api.jikan.moe and graphql.anilist.co"]
    fn live_manga_fallbacks() {
        let show = |label: &str, r: Result<SearchResults, String>| {
            let r = r.unwrap();
            println!("live {}: {} results, first={:?}", label, r.results.len(), r.results.first().map(|x| (&x.id, &x.title, x.available_episodes)));
            assert!(!r.results.is_empty(), "{} empty", label);
        };
        show("search chainsaw", search_manga("chainsaw man", 1, true));
        show("top manga", top_manga(1, None, None, true));
        show("top publishing", top_manga(1, Some("manga"), Some("publishing"), true));
        show("filtered", search_manga_filtered(None, 1, true, Some("1"), Some("popularity"), Some("asc"), Some("publishing"), Some("manga"), None, None));
        let d = manga_details(116778).unwrap();
        println!("live details: {} chapters={:?} authors={:?}", d.title, d.total_chapters, d.authors);
        assert!(!genres_manga().unwrap().genres.is_empty());
    }
}
