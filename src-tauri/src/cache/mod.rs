// Cache Module - In-memory caching system for API responses
//
// Implements:
// - Generic LRU cache with TTL (time-to-live)
// - Thread-safe access via RwLock
// - Automatic expiration of stale entries
// - Configurable cache sizes and TTLs per data type

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::RwLock;
use std::time::{Duration, Instant};

/// A cached entry with expiration time
#[derive(Clone)]
struct CacheEntry<V> {
    value: V,
    expires_at: Instant,
}

impl<V> CacheEntry<V> {
    fn new(value: V, ttl: Duration) -> Self {
        Self {
            value,
            expires_at: Instant::now() + ttl,
        }
    }

    fn is_expired(&self) -> bool {
        Instant::now() > self.expires_at
    }
}

/// A simple in-memory cache with TTL support
pub struct Cache<K, V> {
    entries: RwLock<HashMap<K, CacheEntry<V>>>,
    default_ttl: Duration,
    max_entries: usize,
}

impl<K, V> Cache<K, V>
where
    K: Eq + Hash + Clone,
    V: Clone,
{
    /// Create a new cache with default TTL and max entries
    pub fn new(default_ttl: Duration, max_entries: usize) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            default_ttl,
            max_entries,
        }
    }

    /// Get a value from the cache if it exists and hasn't expired
    pub fn get(&self, key: &K) -> Option<V> {
        let entries = self.entries.read().ok()?;
        if let Some(entry) = entries.get(key) {
            if !entry.is_expired() {
                return Some(entry.value.clone());
            }
        }
        None
    }

    /// Insert a value into the cache with the default TTL
    pub fn insert(&self, key: K, value: V) {
        self.insert_with_ttl(key, value, self.default_ttl);
    }

    /// Insert a value into the cache with a custom TTL
    pub fn insert_with_ttl(&self, key: K, value: V, ttl: Duration) {
        if let Ok(mut entries) = self.entries.write() {
            // Evict expired entries if we're at capacity
            if entries.len() >= self.max_entries {
                self.evict_expired_entries(&mut entries);
            }

            // If still at capacity, remove oldest entries
            if entries.len() >= self.max_entries {
                // Simple eviction: remove ~10% of entries
                let to_remove: Vec<K> = entries
                    .keys()
                    .take(self.max_entries / 10)
                    .cloned()
                    .collect();
                for k in to_remove {
                    entries.remove(&k);
                }
            }

            entries.insert(key, CacheEntry::new(value, ttl));
        }
    }

    /// Remove expired entries from the cache
    fn evict_expired_entries(&self, entries: &mut HashMap<K, CacheEntry<V>>) {
        entries.retain(|_, entry| !entry.is_expired());
    }

    /// Clear all entries from the cache
    #[allow(dead_code)]
    pub fn clear(&self) {
        if let Ok(mut entries) = self.entries.write() {
            entries.clear();
        }
    }

    /// Get the number of entries in the cache (including expired ones)
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.entries.read().map(|e| e.len()).unwrap_or(0)
    }
}

// ==================== API Response Cache ====================

use crate::extensions::{
    ChapterImages, HomeContent, MangaDetails, MediaDetails, SearchResults, SeasonResults, TagsResult, VideoSources,
};
use std::sync::LazyLock;

/// Cache TTL durations for different data types
pub mod ttl {
    use std::time::Duration;

    /// Search and discover results - 5 minutes
    pub const SEARCH: Duration = Duration::from_secs(5 * 60);

    /// Media details - 1 hour (relatively stable)
    pub const DETAILS: Duration = Duration::from_secs(60 * 60);

    /// Video/chapter sources - 30 minutes (may change)
    pub const SOURCES: Duration = Duration::from_secs(30 * 60);

    /// Tags/genres - 24 hours (rarely change)
    pub const TAGS: Duration = Duration::from_secs(24 * 60 * 60);

    /// Home content - 10 minutes
    pub const HOME: Duration = Duration::from_secs(10 * 60);

    /// Recommendations - 15 minutes
    pub const RECOMMENDATIONS: Duration = Duration::from_secs(15 * 60);

    /// Season anime - 15 minutes (current season data changes moderately)
    pub const SEASON: Duration = Duration::from_secs(15 * 60);
}

/// Maximum cache entries for different caches
pub mod limits {
    /// Search results cache (query + page combinations)
    pub const SEARCH: usize = 200;

    /// Discover results cache
    pub const DISCOVER: usize = 100;

    /// Media details cache
    pub const DETAILS: usize = 500;

    /// Video sources cache
    pub const SOURCES: usize = 100;

    /// Chapter images cache
    pub const CHAPTER_IMAGES: usize = 50;

    /// Tags cache
    pub const TAGS: usize = 20;

    /// Home content cache
    pub const HOME: usize = 10;

    /// Recommendations cache
    pub const RECOMMENDATIONS: usize = 10;

    /// Season anime cache (season + year + page combinations)
    pub const SEASON: usize = 50;
}

// ==================== Global Cache Instances ====================

/// Global cache for search results (anime + manga)
pub static SEARCH_CACHE: LazyLock<Cache<String, SearchResults>> =
    LazyLock::new(|| Cache::new(ttl::SEARCH, limits::SEARCH));

/// Global cache for discover results (anime + manga)
pub static DISCOVER_CACHE: LazyLock<Cache<String, SearchResults>> =
    LazyLock::new(|| Cache::new(ttl::SEARCH, limits::DISCOVER));

/// Global cache for anime details
pub static ANIME_DETAILS_CACHE: LazyLock<Cache<String, MediaDetails>> =
    LazyLock::new(|| Cache::new(ttl::DETAILS, limits::DETAILS));

/// Global cache for manga details
pub static MANGA_DETAILS_CACHE: LazyLock<Cache<String, MangaDetails>> =
    LazyLock::new(|| Cache::new(ttl::DETAILS, limits::DETAILS));

/// Global cache for video sources
pub static VIDEO_SOURCES_CACHE: LazyLock<Cache<String, VideoSources>> =
    LazyLock::new(|| Cache::new(ttl::SOURCES, limits::SOURCES));

/// Global cache for chapter images
pub static CHAPTER_IMAGES_CACHE: LazyLock<Cache<String, ChapterImages>> =
    LazyLock::new(|| Cache::new(ttl::SOURCES, limits::CHAPTER_IMAGES));

/// Global cache for tags (anime + manga)
pub static TAGS_CACHE: LazyLock<Cache<String, TagsResult>> =
    LazyLock::new(|| Cache::new(ttl::TAGS, limits::TAGS));

/// Global cache for home content
pub static HOME_CONTENT_CACHE: LazyLock<Cache<String, HomeContent>> =
    LazyLock::new(|| Cache::new(ttl::HOME, limits::HOME));

/// Global cache for recommendations
pub static RECOMMENDATIONS_CACHE: LazyLock<Cache<String, SearchResults>> =
    LazyLock::new(|| Cache::new(ttl::RECOMMENDATIONS, limits::RECOMMENDATIONS));

/// Global cache for season anime
pub static SEASON_CACHE: LazyLock<Cache<String, SeasonResults>> =
    LazyLock::new(|| Cache::new(ttl::SEASON, limits::SEASON));

// ==================== Cache Key Builders ====================

/// Build a cache key for search queries
pub fn search_key(extension_id: &str, query: &str, page: u32, allow_adult: bool) -> String {
    format!("{}:{}:{}:{}", extension_id, query, page, allow_adult)
}

/// Build a cache key for discover queries
pub fn discover_key(
    extension_id: &str,
    page: u32,
    sort_type: Option<&str>,
    genres: &[String],
    allow_adult: bool,
) -> String {
    let sort = sort_type.unwrap_or("default");
    let genres_str = genres.join(",");
    format!(
        "{}:{}:{}:{}:{}",
        extension_id, page, sort, genres_str, allow_adult
    )
}

/// Build a cache key for media details
pub fn details_key(extension_id: &str, media_id: &str) -> String {
    format!("{}:{}", extension_id, media_id)
}

/// Build a cache key for video sources
pub fn sources_key(extension_id: &str, episode_id: &str) -> String {
    format!("{}:{}", extension_id, episode_id)
}

/// Build a cache key for chapter images
pub fn chapter_images_key(extension_id: &str, chapter_id: &str) -> String {
    format!("{}:{}", extension_id, chapter_id)
}

/// Build a cache key for tags
pub fn tags_key(extension_id: &str, page: u32) -> String {
    format!("{}:{}", extension_id, page)
}

/// Build a cache key for home content
pub fn home_content_key(extension_id: &str, allow_adult: bool) -> String {
    format!("{}:{}", extension_id, allow_adult)
}

/// Build a cache key for recommendations
pub fn recommendations_key(extension_id: &str, allow_adult: bool) -> String {
    format!("{}:{}", extension_id, allow_adult)
}

/// Build a cache key for season anime
pub fn season_key(extension_id: &str, page: u32, allow_adult: bool) -> String {
    format!("{}:{}:{}", extension_id, page, allow_adult)
}

// ==================== Cache Statistics ====================

/// Get cache statistics for debugging
#[derive(Debug, Clone, serde::Serialize)]
pub struct CacheStats {
    pub search_entries: usize,
    pub discover_entries: usize,
    pub anime_details_entries: usize,
    pub manga_details_entries: usize,
    pub video_sources_entries: usize,
    pub chapter_images_entries: usize,
    pub tags_entries: usize,
    pub home_content_entries: usize,
    pub recommendations_entries: usize,
    pub season_entries: usize,
}

/// Get current cache statistics
pub fn get_cache_stats() -> CacheStats {
    CacheStats {
        search_entries: SEARCH_CACHE.len(),
        discover_entries: DISCOVER_CACHE.len(),
        anime_details_entries: ANIME_DETAILS_CACHE.len(),
        manga_details_entries: MANGA_DETAILS_CACHE.len(),
        video_sources_entries: VIDEO_SOURCES_CACHE.len(),
        chapter_images_entries: CHAPTER_IMAGES_CACHE.len(),
        tags_entries: TAGS_CACHE.len(),
        home_content_entries: HOME_CONTENT_CACHE.len(),
        recommendations_entries: RECOMMENDATIONS_CACHE.len(),
        season_entries: SEASON_CACHE.len(),
    }
}

/// Clear all caches
pub fn clear_all_caches() {
    SEARCH_CACHE.clear();
    DISCOVER_CACHE.clear();
    ANIME_DETAILS_CACHE.clear();
    MANGA_DETAILS_CACHE.clear();
    VIDEO_SOURCES_CACHE.clear();
    CHAPTER_IMAGES_CACHE.clear();
    TAGS_CACHE.clear();
    HOME_CONTENT_CACHE.clear();
    RECOMMENDATIONS_CACHE.clear();
    SEASON_CACHE.clear();
    log::info!("All API caches cleared");
}
