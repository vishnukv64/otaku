
# Recommendation Engine Design

## Overview

Add a local recommendation engine to the Otaku app that suggests anime/manga based on user watching patterns. Two complementary strategies: content-based filtering (offline) and genre-weighted API discovery (online). Results surface as 2 new carousels on the home page.

## Strategy

### A. Content-Based Filtering (Offline)

Three sub-strategies that produce separate carousel rows:

#### A1. "Recommended For You" — TF-IDF Genre Scoring

**Endpoint:** `get_content_recommendations(limit: i32) -> Vec<RecommendationEntry>`

**Algorithm:**
1. Build a genre preference vector using TF-IDF weighting:
   - **TF (term frequency):** How much time the user spent on each genre (seconds)
   - **IDF (inverse document frequency):** How rare the genre is in the media cache. Common genres like "Action" get downweighted; distinctive genres like "Psychological" get boosted.
   - `genre_weight = tf × idf` where `idf = log(total_media / media_with_genre)`
   - Apply **recency decay:** multiply each watch entry's contribution by `0.95^(days_since_watched / 30)` — content watched this month counts ~100%, 3 months ago ~86%, 6 months ago ~74%
   - Normalize weights to 0.0–1.0 range
2. Query the local media cache for candidates:
   - Media NOT in the user's library (no entry in `library` table)
   - Has genres (non-null `genres` JSON array)
   - Has a public rating > 6.0
3. Score each candidate:
   - `score = Σ(genre_tfidf_weight × genre_match_flag) + (public_rating / 10.0 × 0.3)`
4. Return top N by score, with a `reason` field: "Because you like {top_2_matched_genres}"

#### A2. "Because You Watched X" — Per-Series Similarity

**Endpoint:** `get_similar_to_watched(limit_per_series: i32) -> Vec<SimilarToEntry>`

**Algorithm:**
1. Pick the user's top 3 highest-rated series from library (by user score, fallback to time spent)
2. For each series, find media in the cache that shares 3+ genres with it
3. Exclude anything already in library
4. Rank by genre overlap count + public rating
5. Return grouped by source series: `{ source_title: "Demon Slayer", recommendations: [...] }`

This creates Netflix-style "Because you watched Demon Slayer" rows.

#### A3. Recency Weighting

Both A1 and A2 apply recency decay to ensure recent taste dominates:
- `decay_factor = 0.95^(days_ago / 30)`
- Applied when building the genre vector (A1) and when selecting the "top 3 rated" series (A2 — prefer recently completed over old favorites)

**Return types:**
```rust
struct RecommendationEntry {
    media: MediaEntry,
    score: f64,
    reason: String,           // e.g. "Because you like Fantasy, Action"
    matched_genres: Vec<String>,
}

struct SimilarToGroup {
    source_title: String,
    source_cover_url: Option<String>,
    recommendations: Vec<RecommendationEntry>,
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

Add 3-5 new carousels to the home page, positioned after "Continue Watching/Reading" and before generic trending carousels:

1. **"Recommended For You"** — `get_content_recommendations(20)`
   - Uses existing carousel/card components
   - Each card shows a subtle pill tag: "Because you like {genre}" using the `reason` field
   - Skeleton loader while data loads
   - Hidden entirely if result is empty

2. **"Because You Watched {Title}"** — `get_similar_to_watched(8)` (up to 3 rows)
   - One carousel per source series (e.g. "Because you watched Demon Slayer")
   - Shows the source series cover as a small avatar next to the row title
   - Each card shows genre overlap count as pill: "4 genres in common"
   - Hidden if no rated series or no similar media found

3. **"Trending in Your Genres"** — `get_genre_weighted_discover(20)`
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
- `src-tauri/src/commands.rs` — Add 3 new command handlers
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
- No ML models — uses TF-IDF genre weighting + recency decay instead (Netflix-comparable for single-user)
- No dedicated recommendations page (can add later)
- No recommendation history/dismissal tracking
