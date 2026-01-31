// Extension System Data Types
//
// Defines the core data structures for the extension system including
// extension metadata, search results, media details, and video sources.

use serde::{Deserialize, Serialize};

/// Extension metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(rename = "type")]
    pub extension_type: ExtensionType,
    pub language: String,
    #[serde(alias = "baseUrl")]
    pub base_url: String,
}

/// Type of content the extension provides
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionType {
    Anime,
    Manga,
}

/// Episode date information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeDate {
    pub year: u32,
    pub month: u32, // 0-indexed (0 = January)
    pub date: u32,
}

/// Search result item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    #[serde(alias = "coverUrl")]
    pub cover_url: Option<String>,
    #[serde(alias = "trailerUrl")]
    pub trailer_url: Option<String>,
    pub description: Option<String>,
    pub year: Option<u32>,
    pub status: Option<String>,
    pub rating: Option<f32>,
    /// Latest episode number (for currently airing)
    #[serde(alias = "latestEpisode")]
    pub latest_episode: Option<u32>,
    /// Date of the latest episode release
    #[serde(alias = "latestEpisodeDate")]
    pub latest_episode_date: Option<EpisodeDate>,
    /// Total available episodes (sub)
    #[serde(alias = "availableEpisodes")]
    pub available_episodes: Option<u32>,
    /// Media type: TV, Movie, OVA, ONA, Special
    #[serde(alias = "mediaType")]
    pub media_type: Option<String>,
    /// Genres for NSFW filtering
    #[serde(default)]
    pub genres: Option<Vec<String>>,
}

/// Paginated search results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResults {
    pub results: Vec<SearchResult>,
    #[serde(alias = "hasNextPage")]
    pub has_next_page: bool,
}

/// Season anime results with season info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeasonResults {
    pub results: Vec<SearchResult>,
    #[serde(alias = "hasNextPage")]
    pub has_next_page: bool,
    pub season: String,
    pub year: u32,
}

/// Episode information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    pub id: String,
    pub number: f32,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
}

/// Season information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Season {
    pub quarter: Option<String>,
    pub year: Option<u32>,
}

/// Aired start date
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiredStart {
    pub year: u32,
    pub month: Option<u32>,
    pub date: Option<u32>,
}

/// Detailed media information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDetails {
    pub id: String,
    pub title: String,
    #[serde(alias = "english_name")]
    pub english_name: Option<String>,
    #[serde(alias = "native_name")]
    pub native_name: Option<String>,
    #[serde(alias = "coverUrl")]
    pub cover_url: Option<String>,
    #[serde(alias = "trailerUrl")]
    pub trailer_url: Option<String>,
    pub description: Option<String>,
    pub genres: Vec<String>,
    pub status: Option<String>,
    pub year: Option<u32>,
    pub rating: Option<f32>,
    pub episodes: Vec<Episode>,
    #[serde(rename = "type")]
    pub media_type: Option<String>,
    pub season: Option<Season>,
    pub episode_duration: Option<u64>,
    pub episode_count: Option<u32>,
    pub aired_start: Option<AiredStart>,
    /// ISO 8601 timestamp of last episode release
    #[serde(alias = "lastUpdateEnd")]
    pub last_update_end: Option<String>,
    /// Interval between episodes in milliseconds
    #[serde(alias = "broadcastInterval")]
    pub broadcast_interval: Option<u64>,
}

/// Video quality
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoSource {
    pub url: String,
    pub quality: String,
    #[serde(rename = "type")]
    pub source_type: String, // "hls", "mp4", "dash"
    pub server: String, // Server name (e.g., 'Wixmp', 'Default', etc.)
}

/// Subtitle track
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtitle {
    pub url: String,
    pub language: String,
    pub label: String,
}

/// Video sources with subtitles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoSources {
    pub sources: Vec<VideoSource>,
    pub subtitles: Vec<Subtitle>,
}

/// Tag/Genre information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
    pub slug: String,
    pub count: u32,
    pub thumbnail: Option<String>,
}

/// Tags result containing genres and studios
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagsResult {
    pub genres: Vec<Tag>,
    pub studios: Vec<Tag>,
    #[serde(alias = "hasNextPage")]
    pub has_next_page: bool,
}

// ==================== Home Content Types ====================

/// A category of content for the home page
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomeCategory {
    pub id: String,
    pub title: String,
    pub items: Vec<SearchResult>,
}

/// Home page content with all categories
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomeContent {
    pub featured: Option<SearchResult>,
    pub categories: Vec<HomeCategory>,
}

// ==================== Manga Types ====================

/// Chapter information for manga
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chapter {
    pub id: String,
    pub number: f32,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    #[serde(alias = "releaseDate")]
    pub release_date: Option<String>,
}

/// Single page/image in a chapter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterImage {
    pub url: String,
    pub page: u32,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Collection of images for a chapter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterImages {
    pub images: Vec<ChapterImage>,
    #[serde(alias = "totalPages")]
    pub total_pages: u32,
    pub title: Option<String>,
}

/// Manga details with chapters instead of episodes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaDetails {
    pub id: String,
    pub title: String,
    #[serde(alias = "english_name")]
    pub english_name: Option<String>,
    #[serde(alias = "native_name")]
    pub native_name: Option<String>,
    #[serde(alias = "coverUrl")]
    pub cover_url: Option<String>,
    #[serde(alias = "trailerUrl")]
    pub trailer_url: Option<String>,
    pub description: Option<String>,
    pub genres: Vec<String>,
    pub status: Option<String>,
    pub year: Option<u32>,
    pub rating: Option<f32>,
    pub chapters: Vec<Chapter>,
    #[serde(rename = "type")]
    pub media_type: Option<String>,
    pub season: Option<Season>,
    #[serde(alias = "totalChapters")]
    pub total_chapters: Option<u32>,
}
