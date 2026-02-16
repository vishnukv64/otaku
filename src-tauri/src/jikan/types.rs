// Jikan API response types. Many fields are present for complete JSON deserialization
// but not directly read by application code — suppress dead_code for the whole module.
#![allow(dead_code)]

use serde::Deserialize;

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

#[derive(Debug, Clone, Deserialize)]
pub struct JikanTrailer {
    pub youtube_id: Option<String>,
    pub url: Option<String>,
    pub embed_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanMalEntry {
    pub mal_id: i64,
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub name: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanTitle {
    #[serde(rename = "type")]
    pub title_type: String,
    pub title: String,
}

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

#[derive(Debug, Clone, Deserialize)]
pub struct JikanBroadcast {
    pub day: Option<String>,
    pub time: Option<String>,
    pub timezone: Option<String>,
    pub string: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanRelation {
    pub relation: String,
    pub entry: Vec<JikanMalEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanExternalLink {
    pub name: String,
    pub url: String,
}

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
    pub relations: Option<Vec<JikanRelation>>,
    pub external: Option<Vec<JikanExternalLink>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JikanWatchEpisodeEntry {
    pub entry: JikanAnime,
    pub region_locked: Option<bool>,
}

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

#[derive(Debug, Clone, Deserialize)]
pub struct JikanGenre {
    pub mal_id: i64,
    pub name: String,
    pub url: Option<String>,
    pub count: Option<i32>,
}

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
