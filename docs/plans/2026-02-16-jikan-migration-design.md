# Jikan API Migration Design

**Date:** 2026-02-16
**Status:** Approved
**Scope:** Replace AllAnime as primary metadata source with Jikan (MyAnimeList) API

## Summary

Migrate Otaku's anime/manga metadata layer from AllAnime's GraphQL API to Jikan REST API (v4). AllAnime extensions are retained solely for video streaming (`getSources`) and manga page images (`getChapterImages`). A search-based bridge connects Jikan entries to AllAnime content IDs.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Metadata source | Jikan API v4 | Free, no auth, rich MAL data, stable REST API |
| Streaming source | AllAnime (retained) | Jikan has no video/manga content delivery |
| Integration pattern | Rust-native HTTP client | Clean REST API doesn't need QuickJS sandbox overhead |
| ID mapping | Search-based linking | Search AllAnime by title when user wants to watch/read, cache results |
| User data | Fresh start | New entries use MAL IDs; old AllAnime data stays but won't link |

## Architecture

### Current Flow
```
Frontend → Tauri Command → QuickJS Extension → AllAnime GraphQL → Response
```

### New Flow
```
Metadata:  Frontend → Tauri Command → Rust Jikan Client → Jikan REST API → Response
Streaming: Frontend → Tauri Command → Bridge (resolve AllAnime ID) → QuickJS Extension → AllAnime → Sources
```

## 1. Rust Backend: Jikan Client Module

### File Structure
```
src-tauri/src/jikan/
├── mod.rs          // HTTP client with rate limiter (3/sec, 60/min)
├── types.rs        // Serde structs for Jikan API responses
├── anime.rs        // Anime API calls + mapping to app types
├── manga.rs        // Manga API calls + mapping to app types
└── commands.rs     // New Tauri IPC commands
```

### Rate Limiter
Token-bucket implementation enforcing Jikan's limits:
- 3 requests per second
- 60 requests per minute
- Queues excess requests with backoff

### Jikan Response Types (Serde)
```rust
struct JikanAnime {
    mal_id: i64,
    url: String,
    images: JikanImages,
    trailer: Option<JikanTrailer>,
    titles: Vec<JikanTitle>,
    title: String,
    title_english: Option<String>,
    title_japanese: Option<String>,
    type_: Option<String>,         // TV, Movie, OVA, etc.
    source: Option<String>,
    episodes: Option<i32>,
    status: Option<String>,        // "Currently Airing", "Finished Airing", "Not yet aired"
    airing: bool,
    aired: Option<JikanAired>,
    duration: Option<String>,
    rating: Option<String>,        // "PG-13", "R", etc.
    score: Option<f64>,
    rank: Option<i32>,
    popularity: Option<i32>,
    members: Option<i32>,
    favorites: Option<i32>,
    synopsis: Option<String>,
    season: Option<String>,
    year: Option<i32>,
    studios: Vec<JikanMalEntry>,
    genres: Vec<JikanMalEntry>,
    themes: Vec<JikanMalEntry>,
    demographics: Vec<JikanMalEntry>,
    // /full only:
    relations: Option<Vec<JikanRelation>>,
    streaming: Option<Vec<JikanExternalLink>>,
}

struct JikanManga {
    mal_id: i64,
    images: JikanImages,
    titles: Vec<JikanTitle>,
    title: String,
    title_english: Option<String>,
    title_japanese: Option<String>,
    type_: Option<String>,         // Manga, Light Novel, Manhwa, etc.
    chapters: Option<i32>,
    volumes: Option<i32>,
    status: Option<String>,        // "Publishing", "Finished", "On Hiatus"
    score: Option<f64>,
    rank: Option<i32>,
    synopsis: Option<String>,
    authors: Vec<JikanMalEntry>,
    genres: Vec<JikanMalEntry>,
    themes: Vec<JikanMalEntry>,
}
```

### Field Mapping: Jikan → App Types

| Jikan Field | App Type Field | Transform |
|-------------|---------------|-----------|
| `mal_id` | `id` | `i64.to_string()` |
| `title` | `title` | Direct |
| `title_english` | `english_name` | Direct |
| `title_japanese` | `native_name` | Direct |
| `images.jpg.large_image_url` | `cover` | Direct (no proxy needed) |
| `synopsis` | `description` | Direct |
| `score` | `rating` | Direct (already 0-10) |
| `status` | `status` | Map: "Currently Airing"→"Releasing", "Finished Airing"→"Completed", "Not yet aired"→"Not Yet Released" |
| `type` | `media_type` | Direct (TV/Movie/OVA/etc.) |
| `episodes` | `available_episodes` | Direct |
| `genres[].name` | `genres` | Collect names |
| `season` | `season_quarter` | Direct (spring/summer/fall/winter) |
| `year` | `season_year` | Direct |
| `aired.from` | `aired_start_*` | Parse ISO date components |
| `rank` | `rank` | New field |
| `studios[].name` | `studios` | New field |
| `trailer.youtube_id` | `trailer_url` | Construct YouTube URL |
| `streaming` | `streaming_links` | New field (Crunchyroll, Netflix, etc.) |

### New Tauri Commands
```rust
// Search
#[tauri::command]
async fn jikan_search_anime(query: String, page: i32, sfw: bool) -> Result<SearchResults>
async fn jikan_search_manga(query: String, page: i32, sfw: bool) -> Result<SearchResults>

// Top / Discover
async fn jikan_top_anime(page: i32, type_filter: Option<String>, filter: Option<String>) -> Result<SearchResults>
async fn jikan_top_manga(page: i32, type_filter: Option<String>, filter: Option<String>) -> Result<SearchResults>

// Seasons
async fn jikan_season_now(page: i32) -> Result<SearchResults>
async fn jikan_season(year: i32, season: String, page: i32) -> Result<SearchResults>
async fn jikan_season_upcoming(page: i32) -> Result<SearchResults>

// Details
async fn jikan_anime_details(mal_id: i64) -> Result<MediaDetails>
async fn jikan_manga_details(mal_id: i64) -> Result<MangaDetails>

// Episodes (Jikan provides episode metadata, not sources)
async fn jikan_anime_episodes(mal_id: i64, page: i32) -> Result<Vec<Episode>>

// Supporting
async fn jikan_anime_characters(mal_id: i64) -> Result<Vec<Character>>
async fn jikan_anime_recommendations(mal_id: i64) -> Result<SearchResults>
async fn jikan_genres_anime() -> Result<TagsResult>
async fn jikan_genres_manga() -> Result<TagsResult>
async fn jikan_schedules(day: Option<String>) -> Result<SearchResults>
async fn jikan_random_anime() -> Result<SearchResult>
```

## 2. AllAnime Streaming Bridge

### Purpose
Connect Jikan metadata (MAL ID + title) to AllAnime content for video/manga sources.

### Flow
```
User clicks "Watch Episode 5 of Naruto" (MAL ID: 20)
  ↓
Check id_mappings table: mal_id=20 → allanime_id?
  ↓ (cache miss)
Search AllAnime: query="Naruto"
  ↓
Match by title similarity + year
  ↓
Store mapping: {mal_id: "20", allanime_id: "R5KxJRjMi", media_type: "anime"}
  ↓
Construct episode ID: "R5KxJRjMi-5"
  ↓
Call existing: get_video_sources("com.allanime.source", "R5KxJRjMi-5")
```

### New SQLite Table
```sql
CREATE TABLE id_mappings (
    mal_id TEXT PRIMARY KEY,
    allanime_id TEXT NOT NULL,
    media_type TEXT NOT NULL,  -- "anime" or "manga"
    title TEXT NOT NULL,       -- for debugging
    created_at TEXT DEFAULT (datetime('now'))
);
```

### New Tauri Command
```rust
#[tauri::command]
async fn resolve_allanime_id(
    title: String,
    english_title: Option<String>,
    media_type: String,
    year: Option<i32>,
    mal_id: String,
) -> Result<Option<String>>
```

### Matching Algorithm
1. Check `id_mappings` cache for `mal_id`
2. If miss: search AllAnime with `english_title` (preferred) then `title`
3. Score candidates:
   - Exact title match: +10
   - Case-insensitive match: +8
   - Fuzzy match (>80% similarity): +5
   - Year matches: +3
4. Pick highest-scoring candidate, store in `id_mappings`
5. Return AllAnime ID or `None` if no match

## 3. Frontend Changes

### Route: Home (`/`)
**Before:** `loadExtension()` → `streamHomeContent()` (SSE)
**After:** Parallel Jikan calls:
- `jikan_top_anime(filter="airing")` → "Trending Now"
- `jikan_top_anime()` → "Top Rated"
- `jikan_season_upcoming()` → "Upcoming"
- `jikan_season_now()` → "This Season"

### Route: Anime Browser (`/anime`)
**Before:** `discoverAnime(extensionId, page, sortType, genres)`
**After:**
- Search tab: `jikan_search_anime(query, page, sfw)`
- Browse tab: `jikan_top_anime(page, type, filter)`
- Season tab: `jikan_season_now(page)`
- New filters: type (TV/Movie/OVA), status (airing/complete/upcoming), rating

### Route: Manga Browser (`/manga`)
**Before:** `discoverManga(extensionId, page, sortType, genres)`
**After:**
- Search: `jikan_search_manga(query, page, sfw)`
- Browse: `jikan_top_manga(page, type, filter)`
- Type filter: Manga/Manhwa/Manhua/Light Novel

### Route: Watch (`/watch`)
**Before:** `getAnimeDetails(extensionId, animeId)` → `getVideoSources(extensionId, episodeId)`
**After:**
1. `jikan_anime_details(mal_id)` → metadata + episode count
2. `jikan_anime_episodes(mal_id, page)` → episode titles/thumbnails
3. On play: `resolve_allanime_id(title, ...)` → AllAnime ID
4. `get_video_sources("com.allanime.source", "{allanimeId}-{epNum}")`

### Route: Read (`/read`)
**Before:** `getMangaDetails(extensionId, mangaId)` → `getChapterImages(extensionId, chapterId)`
**After:**
1. `jikan_manga_details(mal_id)` → metadata + chapter count
2. On read: `resolve_allanime_id(title, ...)` → AllAnime ID
3. `get_chapter_images("com.allanime.manga", "{allanimeId}-{chNum}")`

### Component: MediaCard
- Remove: `latest_episode` / `latest_episode_date` badge
- Add: MAL `rank` badge (#1, #47, etc.)
- Images: MAL CDN (no proxy needed) - remove `useProxiedImage` for Jikan content

### Component: MediaDetailModal
- Add: Studios, producers info
- Add: Relations (sequels, prequels, spin-offs)
- Add: Streaming platform links (Crunchyroll, Netflix, etc.)
- Trailer: Use `trailer.youtube_id` directly
- "Watch" button triggers bridge resolution

### Type Updates (`src/types/extension.ts`)
Add to existing types:
```typescript
// SearchResult additions
mal_id?: number;
rank?: number;
popularity?: number;
studios?: string[];

// MediaDetails additions
rank?: number;
popularity?: number;
studios?: { name: string; mal_id: number }[];
relations?: { relation: string; entry: { mal_id: number; type: string; name: string }[] }[];
streaming_links?: { name: string; url: string }[];
```

### New Frontend Wrappers (`src/utils/tauri-commands.ts`)
Add Jikan-specific command wrappers alongside existing ones. Remove `extensionId` from the call signatures for Jikan commands.

### Store Updates
- `mediaStore.ts`: Update search/discover to call Jikan commands
- `settingsStore.ts`: NSFW filter maps to Jikan's `sfw` parameter
- Remove extension loading logic from routes (no more `loadExtension()` on mount)

## 4. What Gets Removed

- Extension loading on app startup (for metadata - keep for streaming)
- SSE streaming for discover results (Jikan returns paginated directly)
- `useProxiedImage` for anime cover images (MAL CDN allows direct access)
- Persisted query hash management
- Hex URL decoding (stays in AllAnime extension for streaming only)
- `extensionId` parameter from most frontend flows

## 5. What Stays

- AllAnime extensions (`allanime-extension.ts`, `allanime-manga-extension.ts`)
- `load_extension()`, `get_video_sources()`, `get_chapter_images()` commands
- Video proxy server (`video_server.rs`)
- Image proxy for manga pages (`proxy_image_request`)
- QuickJS runtime (for AllAnime source resolution)
- Download system
- Player/reader components (UI unchanged)

## 6. New Capabilities from Jikan

- **Anime schedules:** Weekly broadcast schedule (`/schedules`)
- **Season browser:** Browse any past/future season (`/seasons/{year}/{season}`)
- **Detailed episodes:** Episode titles, synopses, air dates from MAL
- **Character info:** Characters with voice actors
- **Relations:** Sequel/prequel/side story navigation
- **Streaming links:** Direct links to Crunchyroll, Netflix, etc.
- **Random anime:** Discover random entries
- **Better search:** Filter by type, status, rating, score range, genres, date range

## 7. Migration Risks

| Risk | Mitigation |
|------|------------|
| Rate limiting (3/sec) | Token-bucket limiter in Rust client; cache aggressively |
| Bridge title mismatch | Fuzzy matching + year validation; manual override option |
| Jikan downtime | Cache last-known responses; show cached data with stale indicator |
| Chapter list gap | Jikan has chapter count but not individual chapter details; AllAnime bridge provides actual chapter data |
| AllAnime API changes | Extensions are isolated; only affects streaming, not core metadata |

## 8. Jikan API Reference

**Base URL:** `https://api.jikan.moe/v4/`

### Endpoints Used

| Endpoint | Purpose | Rate Impact |
|----------|---------|-------------|
| `GET /anime?q=...` | Search anime | 1 req |
| `GET /manga?q=...` | Search manga | 1 req |
| `GET /anime/{id}/full` | Full anime details | 1 req |
| `GET /manga/{id}/full` | Full manga details | 1 req |
| `GET /anime/{id}/episodes?page=` | Episode list | 1 req/page |
| `GET /anime/{id}/characters` | Characters | 1 req |
| `GET /anime/{id}/recommendations` | Recommendations | 1 req |
| `GET /top/anime` | Top anime (with filters) | 1 req |
| `GET /top/manga` | Top manga (with filters) | 1 req |
| `GET /seasons/now` | Current season | 1 req |
| `GET /seasons/{year}/{season}` | Specific season | 1 req |
| `GET /seasons/upcoming` | Upcoming anime | 1 req |
| `GET /genres/anime` | Anime genres list | 1 req |
| `GET /genres/manga` | Manga genres list | 1 req |
| `GET /schedules` | Weekly schedule | 1 req |
| `GET /random/anime` | Random anime | 1 req |

### Key Query Parameters (Search)
- `q` - Search query
- `page`, `limit` - Pagination
- `type` - tv/movie/ova/special/ona/music
- `status` - airing/complete/upcoming
- `rating` - g/pg/pg13/r17/r/rx
- `sfw` - Filter adult content
- `genres` - Comma-separated genre IDs
- `order_by` - score/rank/popularity/title/etc.
- `sort` - asc/desc
- `min_score`/`max_score` - Score range
- `start_date`/`end_date` - Date range (YYYY-MM-DD)

### Top Anime Filters
- `filter` - airing/upcoming/bypopularity/favorite

### Response Notes
- Missing values: `null` (not undefined)
- Missing score: `0`
- Dates: ISO 8601 UTC
- Images: `jpg` and `webp` variants with small/regular/large sizes
