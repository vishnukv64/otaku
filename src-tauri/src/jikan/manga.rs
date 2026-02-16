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

pub fn genres_manga() -> Result<TagsResult, String> {
    let response: JikanPaginatedResponse<JikanGenre> = JIKAN.get_parsed("/genres/manga")?;

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
