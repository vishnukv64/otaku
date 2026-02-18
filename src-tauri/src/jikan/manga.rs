use super::anime::{extract_genre_names, extract_image_url};
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
        title: manga.title.clone(),
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
        rank: manga.rank,
        popularity: manga.popularity,
        studios: None,
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
    }
}

// --- Public API functions ---

pub fn search_manga(query: &str, page: i32, sfw: bool) -> Result<SearchResults, String> {
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
    let response: JikanResponse<JikanManga> = JIKAN.get_parsed(&path)?;
    Ok(jikan_manga_to_manga_details(&response.data))
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

// --- Filtered search ---

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
