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
}

/// Paginated search results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResults {
    pub results: Vec<SearchResult>,
    #[serde(alias = "hasNextPage")]
    pub has_next_page: bool,
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
