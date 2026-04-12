# Recommendation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local recommendation engine that surfaces personalized anime/manga suggestions as carousels on the home page, using TF-IDF genre scoring, per-series similarity, and genre-weighted API discovery.

**Architecture:** Three backend endpoints (content recommendations, similar-to-watched, user genre preferences) powered by SQLite queries on existing watch_history/library/media tables. Frontend adds 3-5 new carousels to the home page using the existing `MediaCarousel` + `useJikanQuery` patterns. Genre-weighted discovery reuses existing Jikan search commands filtered by the user's top genres.

**Tech Stack:** Rust/SQLite (backend queries), React/TypeScript (frontend carousels), Embla Carousel (existing), Jikan API (existing integration)

**Spec:** `docs/superpowers/specs/2026-04-12-recommendation-engine-design.md`

---

### Task 1: Create recommendations module — TF-IDF genre scoring + content recommendations

**Files:**
- Create: `src-tauri/src/database/recommendations.rs`
- Modify: `src-tauri/src/database/mod.rs`

- [ ] **Step 1: Add module to mod.rs**

In `src-tauri/src/database/mod.rs`, add:
```rust
pub mod recommendations;
```

- [ ] **Step 2: Create recommendations.rs with types**

Create `src-tauri/src/database/recommendations.rs`:

```rust
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use anyhow::Result;

use super::media::MediaEntry;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenrePreference {
    pub genre: String,
    pub tf: f64,        // time-frequency: seconds spent
    pub idf: f64,       // inverse document frequency
    pub tfidf: f64,     // combined score
    pub weight: f64,    // normalized 0.0-1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendationEntry {
    pub media: MediaEntry,
    pub score: f64,
    pub reason: String,
    pub matched_genres: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarToGroup {
    pub source_title: String,
    pub source_cover_url: Option<String>,
    pub source_id: String,
    pub recommendations: Vec<RecommendationEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserGenreProfile {
    pub top_genres: Vec<GenrePreference>,
    pub total_watch_time_seconds: f64,
    pub total_series: i32,
}
```

- [ ] **Step 3: Implement genre preference builder with TF-IDF + recency decay**

Add to `recommendations.rs`:

```rust
/// Build a TF-IDF weighted genre preference vector with recency decay.
/// TF = time spent on genre (with recency weighting)
/// IDF = log(total_cached_media / media_with_this_genre)
pub async fn build_genre_profile(pool: &SqlitePool) -> Result<UserGenreProfile> {
    use sqlx::Row;

    // Step 1: Get genre time-frequency with recency decay
    // decay = 0.95^(days_since / 30) — recent watches count more
    let tf_rows = sqlx::query(
        "SELECT j.value as genre,
            SUM(w.progress_seconds * POWER(0.95, (JULIANDAY('now') - JULIANDAY(w.last_watched)) / 30.0)) as weighted_time
         FROM watch_history w
         JOIN media m ON w.media_id = m.id, json_each(m.genres) j
         WHERE m.genres IS NOT NULL AND w.last_watched IS NOT NULL
         GROUP BY j.value
         ORDER BY weighted_time DESC"
    )
    .fetch_all(pool)
    .await?;

    if tf_rows.is_empty() {
        return Ok(UserGenreProfile {
            top_genres: vec![],
            total_watch_time_seconds: 0.0,
            total_series: 0,
        });
    }

    // Step 2: Get IDF values — how distinctive each genre is
    let total_media: f64 = sqlx::query("SELECT COUNT(*) as cnt FROM media WHERE genres IS NOT NULL")
        .fetch_one(pool).await?.get::<i32, _>("cnt") as f64;

    let idf_rows = sqlx::query(
        "SELECT j.value as genre, COUNT(DISTINCT m.id) as doc_count
         FROM media m, json_each(m.genres) j
         WHERE m.genres IS NOT NULL
         GROUP BY j.value"
    )
    .fetch_all(pool)
    .await?;

    let idf_map: std::collections::HashMap<String, f64> = idf_rows.iter().map(|r| {
        let genre: String = r.get("genre");
        let doc_count: i32 = r.get("doc_count");
        let idf = if doc_count > 0 && total_media > 0.0 {
            (total_media / doc_count as f64).ln()
        } else {
            0.0
        };
        (genre, idf)
    }).collect();

    // Step 3: Combine TF × IDF and normalize
    let mut preferences: Vec<GenrePreference> = tf_rows.iter().map(|r| {
        let genre: String = r.get("genre");
        let tf: f64 = r.get("weighted_time");
        let idf = idf_map.get(&genre).copied().unwrap_or(1.0);
        let tfidf = tf * idf;
        GenrePreference { genre, tf, idf, tfidf, weight: 0.0 }
    }).collect();

    let max_tfidf = preferences.iter().map(|p| p.tfidf).fold(0.0f64, f64::max);
    if max_tfidf > 0.0 {
        for p in &mut preferences {
            p.weight = p.tfidf / max_tfidf;
        }
    }

    // Summary stats
    let total_time: f64 = sqlx::query("SELECT COALESCE(SUM(progress_seconds), 0) as t FROM watch_history")
        .fetch_one(pool).await?.get("t");
    let total_series: i32 = sqlx::query("SELECT COUNT(DISTINCT media_id) as cnt FROM watch_history")
        .fetch_one(pool).await?.get("cnt");

    Ok(UserGenreProfile {
        top_genres: preferences,
        total_watch_time_seconds: total_time,
        total_series,
    })
}
```

- [ ] **Step 4: Implement content recommendation scoring**

Add to `recommendations.rs`:

```rust
/// Score and rank media from the local cache based on the user's genre profile.
/// Returns media NOT in the user's library, ranked by TF-IDF genre overlap + public rating.
pub async fn get_content_recommendations(pool: &SqlitePool, limit: i32) -> Result<Vec<RecommendationEntry>> {
    use sqlx::Row;

    let profile = build_genre_profile(pool).await?;
    if profile.top_genres.is_empty() {
        return Ok(vec![]);
    }

    // Build a weight map for fast lookup
    let weight_map: std::collections::HashMap<String, f64> = profile.top_genres.iter()
        .map(|p| (p.genre.to_lowercase(), p.weight))
        .collect();

    // Get candidate media: not in library, has genres, decent rating
    let candidates = sqlx::query(
        "SELECT m.* FROM media m
         WHERE m.genres IS NOT NULL
           AND m.id NOT IN (SELECT media_id FROM library)
           AND CAST(m.rating AS REAL) > 6.0
         ORDER BY CAST(m.rating AS REAL) DESC
         LIMIT 500"
    )
    .fetch_all(pool)
    .await?;

    // Score each candidate
    let mut scored: Vec<RecommendationEntry> = candidates.iter().filter_map(|row| {
        let genres_json: Option<String> = row.get("genres");
        let genres: Vec<String> = genres_json
            .and_then(|g| serde_json::from_str(&g).ok())
            .unwrap_or_default();

        if genres.is_empty() { return None; }

        let mut genre_score = 0.0;
        let mut matched = Vec::new();

        for g in &genres {
            if let Some(&w) = weight_map.get(&g.to_lowercase()) {
                genre_score += w;
                matched.push(g.clone());
            }
        }

        if matched.is_empty() { return None; }

        let rating: f64 = row.try_get::<f64, _>("rating").unwrap_or(0.0);
        let rating_bonus = rating / 10.0 * 0.3;
        let total_score = genre_score + rating_bonus;

        let top_matched: Vec<String> = matched.iter().take(2).cloned().collect();
        let reason = format!("Because you like {}", top_matched.join(", "));

        Some(RecommendationEntry {
            media: MediaEntry {
                id: row.get("id"),
                extension_id: row.get("extension_id"),
                title: row.get("title"),
                english_name: row.get("english_name"),
                native_name: row.get("native_name"),
                description: row.get("description"),
                cover_url: row.get("cover_url"),
                banner_url: row.get("banner_url"),
                trailer_url: row.get("trailer_url"),
                media_type: row.get("media_type"),
                content_type: row.get("content_type"),
                status: row.get("status"),
                year: row.get("year"),
                rating: row.get("rating"),
                episode_count: row.get("episode_count"),
                episode_duration: row.get("episode_duration"),
                season_quarter: row.get("season_quarter"),
                season_year: row.get("season_year"),
                aired_start_year: row.get("aired_start_year"),
                aired_start_month: row.get("aired_start_month"),
                aired_start_date: row.get("aired_start_date"),
                genres: row.get("genres"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            },
            score: total_score,
            reason,
            matched_genres: matched,
        })
    }).collect();

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit as usize);

    Ok(scored)
}
```

- [ ] **Step 5: Verify compilation**

```bash
cd src-tauri && cargo check
```
Expected: compiles with warnings about unused functions (not wired up yet)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/database/recommendations.rs src-tauri/src/database/mod.rs
git commit -m "feat(recs): add TF-IDF genre scoring and content recommendation engine"
```

---

### Task 2: Add "Because you watched X" per-series similarity

**Files:**
- Modify: `src-tauri/src/database/recommendations.rs`

- [ ] **Step 1: Implement similar-to-watched query**

Add to `recommendations.rs`:

```rust
/// Find media similar to the user's top-rated series based on genre overlap.
/// Returns up to 3 groups, each with recommendations similar to a specific series.
pub async fn get_similar_to_watched(pool: &SqlitePool, limit_per_series: i32) -> Result<Vec<SimilarToGroup>> {
    use sqlx::Row;

    // Get user's top 3 highest-rated series (recency-weighted)
    let top_series = sqlx::query(
        "SELECT m.id, m.title, m.cover_url, m.genres,
                COALESCE(l.score, 0) * 10 + (100.0 / (1.0 + JULIANDAY('now') - JULIANDAY(MAX(w.last_watched)))) as rank_score
         FROM library l
         JOIN media m ON l.media_id = m.id
         JOIN watch_history w ON w.media_id = m.id
         WHERE l.status IN ('completed', 'watching')
           AND m.genres IS NOT NULL
         GROUP BY m.id
         ORDER BY rank_score DESC
         LIMIT 3"
    )
    .fetch_all(pool)
    .await?;

    if top_series.is_empty() {
        return Ok(vec![]);
    }

    // For each top series, find similar media
    let library_ids = sqlx::query("SELECT media_id FROM library")
        .fetch_all(pool).await?;
    let library_set: std::collections::HashSet<String> = library_ids.iter()
        .map(|r| r.get::<String, _>("media_id"))
        .collect();

    let mut groups = Vec::new();

    for series_row in &top_series {
        let source_id: String = series_row.get("id");
        let source_title: String = series_row.get("title");
        let source_cover: Option<String> = series_row.get("cover_url");
        let source_genres_json: Option<String> = series_row.get("genres");

        let source_genres: Vec<String> = source_genres_json
            .and_then(|g| serde_json::from_str(&g).ok())
            .unwrap_or_default();

        if source_genres.len() < 2 { continue; }

        // Find candidates sharing 3+ genres (or 2+ if source has few genres)
        let min_overlap = if source_genres.len() >= 4 { 3 } else { 2 };

        let candidates = sqlx::query(
            "SELECT m.* FROM media m
             WHERE m.genres IS NOT NULL
               AND m.id != ?
               AND m.id NOT IN (SELECT media_id FROM library)
             ORDER BY CAST(m.rating AS REAL) DESC
             LIMIT 200"
        )
        .bind(&source_id)
        .fetch_all(pool)
        .await?;

        let source_set: std::collections::HashSet<String> = source_genres.iter()
            .map(|g| g.to_lowercase()).collect();

        let mut recs: Vec<RecommendationEntry> = candidates.iter().filter_map(|row| {
            let id: String = row.get("id");
            if library_set.contains(&id) { return None; }

            let genres_json: Option<String> = row.get("genres");
            let genres: Vec<String> = genres_json
                .and_then(|g| serde_json::from_str(&g).ok())
                .unwrap_or_default();

            let matched: Vec<String> = genres.iter()
                .filter(|g| source_set.contains(&g.to_lowercase()))
                .cloned()
                .collect();

            if matched.len() < min_overlap { return None; }

            let rating: f64 = row.try_get::<f64, _>("rating").unwrap_or(0.0);
            let score = matched.len() as f64 + rating / 10.0;

            Some(RecommendationEntry {
                media: MediaEntry {
                    id: row.get("id"),
                    extension_id: row.get("extension_id"),
                    title: row.get("title"),
                    english_name: row.get("english_name"),
                    native_name: row.get("native_name"),
                    description: row.get("description"),
                    cover_url: row.get("cover_url"),
                    banner_url: row.get("banner_url"),
                    trailer_url: row.get("trailer_url"),
                    media_type: row.get("media_type"),
                    content_type: row.get("content_type"),
                    status: row.get("status"),
                    year: row.get("year"),
                    rating: row.get("rating"),
                    episode_count: row.get("episode_count"),
                    episode_duration: row.get("episode_duration"),
                    season_quarter: row.get("season_quarter"),
                    season_year: row.get("season_year"),
                    aired_start_year: row.get("aired_start_year"),
                    aired_start_month: row.get("aired_start_month"),
                    aired_start_date: row.get("aired_start_date"),
                    genres: row.get("genres"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                },
                score,
                reason: format!("{} genres in common", matched.len()),
                matched_genres: matched,
            })
        }).collect();

        recs.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        recs.truncate(limit_per_series as usize);

        if !recs.is_empty() {
            groups.push(SimilarToGroup {
                source_title,
                source_cover_url: source_cover,
                source_id,
                recommendations: recs,
            });
        }
    }

    Ok(groups)
}
```

- [ ] **Step 2: Add user genre profile endpoint**

Add to `recommendations.rs`:

```rust
/// Get the user's top genre preferences for frontend use (genre-weighted Jikan queries).
pub async fn get_user_top_genres(pool: &SqlitePool, limit: i32) -> Result<UserGenreProfile> {
    let mut profile = build_genre_profile(pool).await?;
    profile.top_genres.truncate(limit as usize);
    Ok(profile)
}
```

- [ ] **Step 3: Verify compilation**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/database/recommendations.rs
git commit -m "feat(recs): add per-series similarity and user genre profile endpoints"
```

---

### Task 3: Wire up Tauri commands and registration

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add command handlers to commands.rs**

Append after the last stats command in `commands.rs`:

```rust
// Recommendations
#[tauri::command]
pub async fn get_content_recommendations(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<crate::database::recommendations::RecommendationEntry>, String> {
    let pool = state.database.pool();
    crate::database::recommendations::get_content_recommendations(pool, limit).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_similar_to_watched(
    state: State<'_, AppState>,
    limit_per_series: i32,
) -> Result<Vec<crate::database::recommendations::SimilarToGroup>, String> {
    let pool = state.database.pool();
    crate::database::recommendations::get_similar_to_watched(pool, limit_per_series).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_user_top_genres(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<crate::database::recommendations::UserGenreProfile, String> {
    let pool = state.database.pool();
    crate::database::recommendations::get_user_top_genres(pool, limit).await.map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register commands in lib.rs**

Add after the stats command registrations in the `invoke_handler` list:

```rust
      // Recommendations
      commands::get_content_recommendations,
      commands::get_similar_to_watched,
      commands::get_user_top_genres,
```

- [ ] **Step 3: Verify full backend compiles**

```bash
cd src-tauri && cargo check
```
Expected: clean compilation, no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(recs): register recommendation commands in Tauri handler"
```

---

### Task 4: Add TypeScript types and command wrappers

**Files:**
- Modify: `src/utils/tauri-commands.ts`

- [ ] **Step 1: Add types after the existing stats types section**

Add to `src/utils/tauri-commands.ts` after the stats types:

```typescript
// ==================== Recommendation Types ====================

export interface GenrePreference {
  genre: string
  tf: number
  idf: number
  tfidf: number
  weight: number
}

export interface RecommendationEntry {
  media: MediaEntry
  score: number
  reason: string
  matched_genres: string[]
}

export interface SimilarToGroup {
  source_title: string
  source_cover_url: string | null
  source_id: string
  recommendations: RecommendationEntry[]
}

export interface UserGenreProfile {
  top_genres: GenrePreference[]
  total_watch_time_seconds: number
  total_series: number
}
```

- [ ] **Step 2: Add command wrappers after the stats commands section**

```typescript
// ==================== Recommendation Commands ====================

export async function getContentRecommendations(limit: number): Promise<RecommendationEntry[]> {
  return invoke<RecommendationEntry[]>('get_content_recommendations', { limit })
}

export async function getSimilarToWatched(limitPerSeries: number): Promise<SimilarToGroup[]> {
  return invoke<SimilarToGroup[]>('get_similar_to_watched', { limitPerSeries })
}

export async function getUserTopGenres(limit: number): Promise<UserGenreProfile> {
  return invoke<UserGenreProfile>('get_user_top_genres', { limit })
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/tauri-commands.ts
git commit -m "feat(recs): add TypeScript types and command wrappers for recommendations"
```

---

### Task 5: Create RecommendationCarousel component

**Files:**
- Create: `src/components/home/RecommendationCarousel.tsx`

- [ ] **Step 1: Create the component**

This component wraps the existing `MediaCarousel` but adds recommendation reason tags and handles the "Because you watched X" variant with a source series avatar.

Create `src/components/home/RecommendationCarousel.tsx`:

```tsx
/**
 * RecommendationCarousel — wraps MediaCarousel with recommendation reason pills.
 * Two variants:
 * 1. Standard: "Recommended For You" with genre-based reasons
 * 2. Similar-to: "Because you watched X" with source series avatar
 */

import { useEffect, useState } from 'react'
import { MediaCarousel } from '@/components/media/MediaCarousel'
import type { RecommendationEntry, SimilarToGroup } from '@/utils/tauri-commands'
import type { SearchResult } from '@/types/extension'

/** Convert a RecommendationEntry to a SearchResult for MediaCarousel */
function toSearchResult(entry: RecommendationEntry): SearchResult {
  const m = entry.media
  return {
    id: m.id,
    title: m.title,
    cover_url: m.cover_url ?? undefined,
    description: m.description ?? undefined,
    year: m.year ?? undefined,
    status: m.status ?? undefined,
    rating: m.rating ?? undefined,
    media_type: m.content_type ?? undefined,
    genres: m.genres ? JSON.parse(m.genres) : undefined,
  }
}

interface RecommendationCarouselProps {
  title: string
  items: RecommendationEntry[]
  loading?: boolean
  onItemClick?: (item: SearchResult) => void
}

export function RecommendationCarousel({ title, items, loading, onItemClick }: RecommendationCarouselProps) {
  if (!loading && items.length === 0) return null

  return (
    <MediaCarousel
      title={title}
      items={items.map(toSearchResult)}
      loading={loading}
      onItemClick={onItemClick}
    />
  )
}

interface SimilarToCarouselProps {
  group: SimilarToGroup
  onItemClick?: (item: SearchResult) => void
}

export function SimilarToCarousel({ group, onItemClick }: SimilarToCarouselProps) {
  if (group.recommendations.length === 0) return null

  const title = `Because you watched ${group.source_title}`

  return (
    <div>
      <MediaCarousel
        title={title}
        items={group.recommendations.map(toSearchResult)}
        onItemClick={onItemClick}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/home/RecommendationCarousel.tsx
git commit -m "feat(recs): add RecommendationCarousel and SimilarToCarousel components"
```

---

### Task 6: Integrate recommendation carousels into the home page

**Files:**
- Modify: `src/routes/index.tsx`

This is the main integration task. The home page already renders carousels via the `useJikanQuery` hook pattern. We add 3 new sections:
1. "Recommended For You" — from `getContentRecommendations(20)`
2. "Because you watched X" — from `getSimilarToWatched(8)` (up to 3 rows)
3. "Trending in Your Genres" — from existing Jikan search filtered by user's top genres

- [ ] **Step 1: Read the current home page to identify insertion point**

Read `src/routes/index.tsx` and find where "Continue Watching" and the first trending carousel are. The recommendation carousels go between them.

- [ ] **Step 2: Add imports and state**

Add to the imports section of the home page:

```typescript
import { getContentRecommendations, getSimilarToWatched, getUserTopGenres } from '@/utils/tauri-commands'
import type { RecommendationEntry, SimilarToGroup } from '@/utils/tauri-commands'
import { RecommendationCarousel, SimilarToCarousel } from '@/components/home/RecommendationCarousel'
```

Add state inside the home page component:

```typescript
const [recommendations, setRecommendations] = useState<RecommendationEntry[]>([])
const [similarGroups, setSimilarGroups] = useState<SimilarToGroup[]>([])
const [recsLoading, setRecsLoading] = useState(true)
```

- [ ] **Step 3: Add data fetching in useEffect**

Add a useEffect for recommendation fetching:

```typescript
useEffect(() => {
  const loadRecs = async () => {
    try {
      const [recs, similar] = await Promise.all([
        getContentRecommendations(20).catch(() => []),
        getSimilarToWatched(8).catch(() => []),
      ])
      setRecommendations(recs)
      setSimilarGroups(similar)
    } catch (e) {
      console.error('Recommendations failed:', e)
    } finally {
      setRecsLoading(false)
    }
  }
  loadRecs()
}, [])
```

- [ ] **Step 4: Add carousels to JSX**

Insert after Continue Watching/Reading sections and before the trending carousels:

```tsx
{/* Recommendations */}
{!recsLoading && recommendations.length > 0 && (
  <RecommendationCarousel
    title="Recommended For You"
    items={recommendations}
    onItemClick={handleItemClick}
  />
)}

{/* Because you watched X */}
{similarGroups.map((group) => (
  <SimilarToCarousel
    key={group.source_id}
    group={group}
    onItemClick={handleItemClick}
  />
))}
```

Note: `handleItemClick` should be the existing click handler used by other carousels on the home page (opens the media detail modal). Match the existing pattern.

- [ ] **Step 5: Verify full build**

```bash
npx tsc --noEmit && npm run build
```

- [ ] **Step 6: Verify Rust backend**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 7: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat(recs): integrate recommendation carousels into home page"
```

---

### Task 7: Add genre-weighted Jikan discover carousel

**Files:**
- Modify: `src/routes/index.tsx`

This carousel uses the user's top genres to filter the existing Jikan search. It reuses `useJikanQuery` and the existing `jikanSearchAnimeFiltered` command, just parameterized by the user's preferred genres.

- [ ] **Step 1: Add genre-weighted discover hook**

In the home page component, after the recommendation state, add:

```typescript
const [topGenreIds, setTopGenreIds] = useState<string[]>([])

useEffect(() => {
  getUserTopGenres(3)
    .then((profile) => {
      // Map genre names to genre slugs for Jikan filtering
      // The existing genre browse uses genre names directly
      const names = profile.top_genres.map((g) => g.genre)
      setTopGenreIds(names)
    })
    .catch(() => {})
}, [])
```

Then use `useJikanQuery` for the genre-weighted discover (only if we have genre preferences):

```typescript
const genreDiscover = useJikanQuery({
  cacheKey: topGenreIds.length > 0 ? `home:genre-discover:${topGenreIds.join(',')}` : '',
  fetcher: () => jikanSearchAnimeFiltered({
    genres: topGenreIds.slice(0, 2).join(','),
    orderBy: 'score',
    sort: 'desc',
    limit: 20,
    sfw: sfwEnabled,
  }),
  ttlSeconds: CACHE_TTL.POPULAR,
  mediaType: 'anime',
  deduplicate: true,
  enabled: topGenreIds.length > 0,
})
```

Note: Adapt `jikanSearchAnimeFiltered` call to match the exact function signature in the codebase. Check `src/utils/tauri-commands.ts` for the exact parameters.

- [ ] **Step 2: Add the carousel to JSX**

Insert after the "Because you watched" carousels:

```tsx
{/* Trending in Your Genres */}
{topGenreIds.length > 0 && (genreDiscover.data?.length ?? 0) > 0 && (
  <MediaCarousel
    title={`Trending in ${topGenreIds.slice(0, 2).join(' & ')}`}
    items={genreDiscover.data}
    loading={genreDiscover.loading}
    onItemClick={handleItemClick}
  />
)}
```

- [ ] **Step 3: Verify full build**

```bash
npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Final commit**

```bash
git add src/routes/index.tsx
git commit -m "feat(recs): add genre-weighted Jikan discover carousel on home page"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `cargo check` passes (Rust backend)
- [ ] `npx tsc --noEmit` passes (TypeScript)
- [ ] `npm run build` passes (Vite bundle)
- [ ] Home page shows "Recommended For You" carousel (if user has watch history)
- [ ] Home page shows "Because you watched X" rows (if user has rated/completed series)
- [ ] Home page shows "Trending in {genres}" carousel (if online + has genre preferences)
- [ ] All carousels hidden gracefully for new users with no history
- [ ] Clicking a recommendation card opens the media detail modal
