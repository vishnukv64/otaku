# Recommendation Engine Design

## Overview

Add a local recommendation engine to the Otaku app that suggests anime/manga based on user watching patterns. Two complementary strategies: content-based filtering (offline) and genre-weighted API discovery (online). Results surface as 2 new carousels on the home page.

## Strategy

### A. Content-Based Filtering (Offline)

**Endpoint:** `get_content_recommendations(limit: i32) -> Vec<RecommendationEntry>`

**Algorithm:**
1. Build a genre preference vector from the user's watch/reading history:
   - For each genre, calculate: `weight = time_spent_seconds + (avg_user_score × 1000)`
   - Normalize weights to 0.0–1.0 range
2. Query the local media cache for candidates:
   - Media NOT in the user's library (no entry in `library` table)
   - Has genres (non-null `genres` JSON array)
   - Has a public rating > 6.0
3. Score each candidate:
   - `score = Σ(genre_weight × genre_match_flag) + (public_rating / 10.0 × 0.3)`
   - `genre_match_flag` = 1 if candidate has that genre, 0 otherwise
4. Return top N by score, with a `reason` field listing the top 2 matched genres

**Return type:**
```rust
struct RecommendationEntry {
    media: MediaEntry,
    score: f64,
    reason: String,           // e.g. "Because you like Fantasy, Action"
    matched_genres: Vec<String>,
}
```

### B. Genre-Weighted Discovery (Online)

**Endpoint:** `get_genre_weighted_discover(limit: i32) -> Vec<RecommendationEntry>`

**Algorithm:**
1. Get user's top 3 genres by watch time (reuse `get_genre_stats` query)
2. For each top genre, call Jikan API: `GET /anime?genres={genre_mal_id}&order_by=score&sort=desc&limit={limit/3}`
3. Merge results, exclude any media already in library
4. Tag each result with which genre it matched
5. Return combined list

**Genre-to-MAL-ID mapping:** Maintain a static lookup table in Rust for the ~20 most common genres (Action=1, Adventure=2, Comedy=4, Drama=8, Fantasy=10, etc.)

### Fallback Behavior

| Condition | Content-Based | Genre-Weighted |
|-----------|--------------|----------------|
| New user (<5 episodes) | Hidden | Hidden |
| No cached media | Hidden | Shown |
| Offline | Shown | Hidden |
| Normal | Shown | Shown |

## Frontend Integration

### Home Page Carousels

Add 2 new carousels to the home page, positioned after "Continue Watching/Reading" and before generic trending carousels:

1. **"Recommended For You"** — `get_content_recommendations(20)`
   - Uses existing carousel/card components
   - Each card shows a subtle pill tag: "Because you like {genre}" using the `reason` field
   - Skeleton loader while data loads
   - Hidden entirely if result is empty

2. **"Trending in Your Genres"** — `get_genre_weighted_discover(20)`
   - Same carousel pattern
   - Each card shows matched genre as pill tag
   - Hidden if offline or empty result
   - Graceful error handling (just hide, don't show error)

### Card Enhancement

Add an optional `tag` prop to the existing media card component to display the recommendation reason as a small overlay pill at the bottom of the card.

## Data Flow

```
User watches anime → watch_history grows → genre weights update
                                              ↓
Home page loads → fires both recommendation queries in parallel
                                              ↓
Content-based: SQLite query on local media cache → scored + ranked
Genre-weighted: Jikan API call filtered by top genres → merged + deduped
                                              ↓
Two carousels render with recommendation reason tags
```

## Files to Create/Modify

### Backend (Rust)
- `src-tauri/src/database/recommendations.rs` — New module: genre vector builder, scoring, candidate queries
- `src-tauri/src/commands.rs` — Add 2 new command handlers
- `src-tauri/src/lib.rs` — Register new commands
- `src-tauri/src/database/mod.rs` — Add `pub mod recommendations;`

### Frontend (TypeScript/React)
- `src/utils/tauri-commands.ts` — Add types + command wrappers
- `src/components/home/RecommendationCarousel.tsx` — New component for recommendation carousels with reason tags
- Home page component — Add the 2 new carousels after continue watching

## Edge Cases

- **Cold start:** Hide carousels until user has 5+ watched episodes
- **All cached media already in library:** Content-based returns empty, carousel hidden
- **Jikan rate limiting:** Genre-weighted fails silently, carousel hidden
- **Genre name mismatch:** Normalize genre strings to lowercase for matching between AllAnime and Jikan taxonomies
- **Stale cache:** Content-based only recommends from media the user has browsed before (local cache). This is acceptable — it recommends from the user's discovered universe.

## Non-Goals

- No collaborative filtering (no "users like you" data)
- No ML models or external recommendation APIs
- No dedicated recommendations page (can add later)
- No recommendation history/dismissal tracking
