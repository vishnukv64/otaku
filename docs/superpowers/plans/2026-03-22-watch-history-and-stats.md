# Watch History & Activity Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Watch/Read History page (`/history`) with timeline and series views, and an Activity Statistics dashboard (`/stats`) with charts, genre breakdowns, and streaks.

**Architecture:** Two new routes built on existing `watch_history` and `reading_history` SQLite tables. New Rust database functions provide aggregated data via Tauri commands. The current system stats at `/stats` relocate to Settings. `recharts` is added for the activity timeline chart; all other visualizations use CSS/Tailwind.

**Tech Stack:** Rust/SQLite (backend), React/TypeScript/TanStack Router/Zustand/Tailwind (frontend), recharts (activity chart only)

**Spec:** `docs/superpowers/specs/2026-03-22-watch-history-and-stats-design.md`

---

## File Structure

### New Files

```
src-tauri/src/database/history.rs         — unified history queries (timeline, series, delete, clear)
src-tauri/src/database/stats.rs           — all stats queries (summary, daily activity, genres, streaks, etc.)
src/components/history/HistoryPage.tsx     — main page: view toggle, filters, search, data loading
src/components/history/TimelineView.tsx    — date-grouped chronological list
src/components/history/SeriesView.tsx      — per-anime/manga card grid with expand
src/components/history/HistoryEntry.tsx    — single timeline row (cover, progress, actions)
src/components/history/SeriesCard.tsx      — aggregate series card (expandable)
src/components/stats/StatsPage.tsx         — main stats dashboard layout
src/components/stats/SummaryCards.tsx      — top row of 4 stat cards
src/components/stats/ActivityChart.tsx     — recharts area chart with period toggle
src/components/stats/GenreDistribution.tsx — CSS horizontal bar chart
src/components/stats/CompletionRings.tsx   — CSS SVG ring charts
src/components/stats/TopContent.tsx        — ranked anime/manga lists
src/components/stats/StreaksAndFun.tsx     — streak counters and fun stats
src/components/settings/DeveloperStats.tsx — relocated system stats (collapsible)
src/routes/history.tsx                     — thin route wrapper
```

### Modified Files

```
src-tauri/src/database/mod.rs             — add pub mod history; pub mod stats;
src-tauri/src/commands.rs                  — add new Tauri command functions
src-tauri/src/lib.rs                       — register new commands in invoke_handler
src/utils/tauri-commands.ts                — add TypeScript types and command wrappers
src/routes/stats.tsx                       — rewrite to render StatsPage instead of system stats
src/routes/settings.tsx                    — embed DeveloperStats in Developer section
src/components/layout/TopNav.tsx           — add History and Stats nav links
src/routes/library.tsx                     — add History/Stats links for mobile access
package.json                               — add recharts dependency
```

---

## Task 1: Install recharts dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install recharts**

```bash
cd /Users/vishnukv/facets/codebases/otaku && npm install recharts
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/vishnukv/facets/codebases/otaku && npm ls recharts
```

Expected: `recharts@2.x.x` listed

- [ ] **Step 3: Commit**

```bash
cd /Users/vishnukv/facets/codebases/otaku
git add package.json package-lock.json
git commit -m "chore: add recharts dependency for activity chart"
```

---

## Task 2: Backend — History database module

**Files:**
- Create: `src-tauri/src/database/history.rs`
- Modify: `src-tauri/src/database/mod.rs`

This module provides all queries for the `/history` page: unified timeline, series grouping, and deletion.

- [ ] **Step 1: Add module declaration**

In `src-tauri/src/database/mod.rs`, add:

```rust
pub mod history;
```

alongside existing `pub mod watch_history;` and `pub mod reading_history;`.

- [ ] **Step 2: Create history.rs with types**

Create `src-tauri/src/database/history.rs`:

```rust
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use anyhow::Result;

use super::media::MediaEntry;

/// A unified history entry that can represent either a watch or read event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    #[serde(rename = "type")]
    pub entry_type: String, // "watch" or "read"
    pub media: MediaEntry,
    pub episode_id: Option<String>,
    pub chapter_id: Option<String>,
    pub episode_number: Option<i32>,
    pub chapter_number: Option<f64>,
    pub progress_seconds: Option<f64>,
    pub current_page: Option<i32>,
    pub duration: Option<f64>,
    pub total_pages: Option<i32>,
    pub completed: bool,
    pub timestamp: String,
}

/// Aggregated history for a single anime/manga series.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaHistorySummary {
    pub media: MediaEntry,
    #[serde(rename = "type")]
    pub media_type: String, // "anime" or "manga"
    pub items_completed: i32,
    pub total_items: Option<i32>,
    pub total_time_seconds: f64,
    pub last_activity: String,
}
```

- [ ] **Step 3: Add `get_all_history` function**

Append to `history.rs`:

```rust
/// Returns a paginated, unified timeline of watch and read history.
/// When media_type is None, returns both anime and manga via UNION.
/// When "anime", queries only watch_history. When "manga", only reading_history.
pub async fn get_all_history(
    pool: &SqlitePool,
    page: i32,
    limit: i32,
    media_type: Option<&str>,
    search: Option<&str>,
) -> Result<Vec<HistoryEntry>> {
    let offset = (page - 1) * limit;
    let search_pattern = search.map(|s| format!("%{}%", s));

    let include_watch = media_type.is_none() || media_type == Some("anime");
    let include_read = media_type.is_none() || media_type == Some("manga");

    // Build UNION query dynamically
    let mut parts: Vec<String> = Vec::new();

    if include_watch {
        parts.push(format!(
            "SELECT 'watch' as entry_type,
                m.id, m.extension_id, m.title, m.english_name, m.native_name,
                m.description, m.cover_url, m.banner_url, m.trailer_url,
                m.media_type, m.content_type, m.status as media_status,
                m.year, m.rating, m.episode_count, m.episode_duration,
                m.season_quarter, m.season_year,
                m.aired_start_year, m.aired_start_month, m.aired_start_date,
                m.genres, m.created_at as media_created_at, m.updated_at as media_updated_at,
                w.episode_id, NULL as chapter_id,
                w.episode_number, NULL as chapter_number,
                w.progress_seconds, NULL as current_page,
                w.duration, NULL as total_pages,
                w.completed,
                w.last_watched as timestamp
            FROM watch_history w
            JOIN media m ON w.media_id = m.id
            WHERE 1=1 {}",
            if search_pattern.is_some() { "AND m.title LIKE ?" } else { "" }
        ));
    }

    if include_read {
        parts.push(format!(
            "SELECT 'read' as entry_type,
                m.id, m.extension_id, m.title, m.english_name, m.native_name,
                m.description, m.cover_url, m.banner_url, m.trailer_url,
                m.media_type, m.content_type, m.status as media_status,
                m.year, m.rating, m.episode_count, m.episode_duration,
                m.season_quarter, m.season_year,
                m.aired_start_year, m.aired_start_month, m.aired_start_date,
                m.genres, m.created_at as media_created_at, m.updated_at as media_updated_at,
                NULL as episode_id, r.chapter_id,
                NULL as episode_number, r.chapter_number,
                NULL as progress_seconds, r.current_page,
                NULL as duration, r.total_pages,
                r.completed,
                r.last_read as timestamp
            FROM reading_history r
            JOIN media m ON r.media_id = m.id
            WHERE 1=1 {}",
            if search_pattern.is_some() { "AND m.title LIKE ?" } else { "" }
        ));
    }

    let query_str = format!(
        "{} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        parts.join(" UNION ALL ")
    );

    let mut query = sqlx::query(&query_str);

    // Bind search patterns
    if include_watch {
        if let Some(ref pattern) = search_pattern {
            query = query.bind(pattern);
        }
    }
    if include_read {
        if let Some(ref pattern) = search_pattern {
            query = query.bind(pattern);
        }
    }
    query = query.bind(limit).bind(offset);

    let rows = query.fetch_all(pool).await?;

    let entries: Vec<HistoryEntry> = rows
        .iter()
        .map(|row| {
            use sqlx::Row;
            HistoryEntry {
                entry_type: row.get("entry_type"),
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
                    status: row.get("media_status"),
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
                    created_at: row.get("media_created_at"),
                    updated_at: row.get("media_updated_at"),
                },
                episode_id: row.get("episode_id"),
                chapter_id: row.get("chapter_id"),
                episode_number: row.get("episode_number"),
                chapter_number: row.get("chapter_number"),
                progress_seconds: row.get("progress_seconds"),
                current_page: row.get("current_page"),
                duration: row.get("duration"),
                total_pages: row.get("total_pages"),
                completed: row.get("completed"),
                timestamp: row.get("timestamp"),
            }
        })
        .collect();

    Ok(entries)
}
```

- [ ] **Step 4: Add `get_history_grouped_by_media` function**

Append to `history.rs`:

```rust
/// Returns history aggregated per anime/manga, paginated.
pub async fn get_history_grouped_by_media(
    pool: &SqlitePool,
    page: i32,
    limit: i32,
    media_type: Option<&str>,
    search: Option<&str>,
) -> Result<Vec<MediaHistorySummary>> {
    let offset = (page - 1) * limit;
    let search_pattern = search.map(|s| format!("%{}%", s));

    let include_watch = media_type.is_none() || media_type == Some("anime");
    let include_read = media_type.is_none() || media_type == Some("manga");

    let mut parts: Vec<String> = Vec::new();

    if include_watch {
        parts.push(format!(
            "SELECT m.id, m.extension_id, m.title, m.english_name, m.native_name,
                m.description, m.cover_url, m.banner_url, m.trailer_url,
                m.media_type, m.content_type, m.status as media_status,
                m.year, m.rating, m.episode_count as total_items, m.episode_duration,
                m.season_quarter, m.season_year,
                m.aired_start_year, m.aired_start_month, m.aired_start_date,
                m.genres, m.created_at as media_created_at, m.updated_at as media_updated_at,
                'anime' as type_label,
                COUNT(CASE WHEN w.completed = 1 THEN 1 END) as items_completed,
                COALESCE(SUM(w.progress_seconds), 0) as total_time_seconds,
                MAX(w.last_watched) as last_activity
            FROM watch_history w
            JOIN media m ON w.media_id = m.id
            WHERE 1=1 {}
            GROUP BY m.id",
            if search_pattern.is_some() { "AND m.title LIKE ?" } else { "" }
        ));
    }

    if include_read {
        parts.push(format!(
            "SELECT m.id, m.extension_id, m.title, m.english_name, m.native_name,
                m.description, m.cover_url, m.banner_url, m.trailer_url,
                m.media_type, m.content_type, m.status as media_status,
                m.year, m.rating, m.episode_count as total_items, m.episode_duration,
                m.season_quarter, m.season_year,
                m.aired_start_year, m.aired_start_month, m.aired_start_date,
                m.genres, m.created_at as media_created_at, m.updated_at as media_updated_at,
                'manga' as type_label,
                COUNT(CASE WHEN r.completed = 1 THEN 1 END) as items_completed,
                0.0 as total_time_seconds,
                MAX(r.last_read) as last_activity
            FROM reading_history r
            JOIN media m ON r.media_id = m.id
            WHERE 1=1 {}
            GROUP BY m.id",
            if search_pattern.is_some() { "AND m.title LIKE ?" } else { "" }
        ));
    }

    let query_str = format!(
        "SELECT * FROM ({}) ORDER BY last_activity DESC LIMIT ? OFFSET ?",
        parts.join(" UNION ALL ")
    );

    let mut query = sqlx::query(&query_str);

    if include_watch {
        if let Some(ref pattern) = search_pattern {
            query = query.bind(pattern);
        }
    }
    if include_read {
        if let Some(ref pattern) = search_pattern {
            query = query.bind(pattern);
        }
    }
    query = query.bind(limit).bind(offset);

    let rows = query.fetch_all(pool).await?;

    let summaries: Vec<MediaHistorySummary> = rows
        .iter()
        .map(|row| {
            use sqlx::Row;
            MediaHistorySummary {
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
                    status: row.get("media_status"),
                    year: row.get("year"),
                    rating: row.get("rating"),
                    episode_count: row.get("total_items"),
                    episode_duration: row.get("episode_duration"),
                    season_quarter: row.get("season_quarter"),
                    season_year: row.get("season_year"),
                    aired_start_year: row.get("aired_start_year"),
                    aired_start_month: row.get("aired_start_month"),
                    aired_start_date: row.get("aired_start_date"),
                    genres: row.get("genres"),
                    created_at: row.get("media_created_at"),
                    updated_at: row.get("media_updated_at"),
                },
                media_type: row.get("type_label"),
                items_completed: row.get("items_completed"),
                total_items: row.get("total_items"),
                total_time_seconds: row.get("total_time_seconds"),
                last_activity: row.get("last_activity"),
            }
        })
        .collect();

    Ok(summaries)
}
```

- [ ] **Step 5: Add delete/clear functions**

Append to `history.rs`:

```rust
/// Remove a single watch history entry.
pub async fn remove_watch_history_entry(
    pool: &SqlitePool,
    media_id: &str,
    episode_id: &str,
) -> Result<()> {
    sqlx::query("DELETE FROM watch_history WHERE media_id = ? AND episode_id = ?")
        .bind(media_id)
        .bind(episode_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Remove a single reading history entry.
pub async fn remove_reading_history_entry(
    pool: &SqlitePool,
    media_id: &str,
    chapter_id: &str,
) -> Result<()> {
    sqlx::query("DELETE FROM reading_history WHERE media_id = ? AND chapter_id = ?")
        .bind(media_id)
        .bind(chapter_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Clear all reading history.
pub async fn clear_all_reading_history(pool: &SqlitePool) -> Result<()> {
    sqlx::query("DELETE FROM reading_history")
        .execute(pool)
        .await?;
    Ok(())
}
```

- [ ] **Step 6: Verify compilation**

```bash
cd /Users/vishnukv/facets/codebases/otaku/src-tauri && cargo check
```

Expected: compiles without errors

- [ ] **Step 7: Commit**

```bash
cd /Users/vishnukv/facets/codebases/otaku
git add src-tauri/src/database/history.rs src-tauri/src/database/mod.rs
git commit -m "feat: add history database module with unified timeline and series queries"
```

---

## Task 3: Backend — Stats database module

**Files:**
- Create: `src-tauri/src/database/stats.rs`
- Modify: `src-tauri/src/database/mod.rs`

This module provides all aggregate queries for the `/stats` dashboard.

- [ ] **Step 1: Add module declaration**

In `src-tauri/src/database/mod.rs`, add:

```rust
pub mod stats;
```

- [ ] **Step 2: Create stats.rs with types**

Create `src-tauri/src/database/stats.rs`:

```rust
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use anyhow::Result;
use chrono::{Local, NaiveDateTime, Datelike, Weekday};

use super::media::MediaEntry;

/// Estimated reading time per page in minutes.
const READING_MINUTES_PER_PAGE: f64 = 2.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchStatsSummary {
    pub total_time_seconds: f64,
    pub episodes_completed: i32,
    pub series_completed: i32,
    pub total_episodes_started: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadingStatsSummary {
    pub total_chapters_completed: i32,
    pub total_pages_read: i32,
    pub series_completed: i32,
    pub total_chapters_started: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyActivity {
    pub date: String,
    pub watch_minutes: f64,
    pub read_minutes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreStat {
    pub genre: String,
    pub time_seconds: f64,
    pub count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionStatsCategory {
    pub watching: i32,
    pub completed: i32,
    pub on_hold: i32,
    pub dropped: i32,
    pub plan_to_watch: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionStats {
    pub anime: CompletionStatsCategory,
    pub manga: CompletionStatsCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopWatchedEntry {
    pub media: MediaEntry,
    pub total_time_seconds: f64,
    pub episodes_watched: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopReadEntry {
    pub media: MediaEntry,
    pub chapters_read: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreakStats {
    pub current_streak_days: i32,
    pub longest_streak_days: i32,
    pub longest_streak_start: String,
    pub longest_streak_end: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityPatterns {
    pub most_active_day: String,
    pub avg_daily_minutes: f64,
    pub avg_daily_span_minutes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BingeStats {
    pub max_episodes_in_day: i32,
    pub max_episodes_anime_title: String,
    pub max_episodes_date: String,
    pub max_chapters_in_day: i32,
    pub max_chapters_manga_title: String,
    pub max_chapters_date: String,
}
```

- [ ] **Step 3: Add `get_watch_stats_summary`**

Append to `stats.rs`:

```rust
pub async fn get_watch_stats_summary(pool: &SqlitePool) -> Result<WatchStatsSummary> {
    let row = sqlx::query(
        "SELECT
            COALESCE(SUM(progress_seconds), 0) as total_time,
            COUNT(CASE WHEN completed = 1 THEN 1 END) as eps_completed,
            COUNT(*) as eps_started
        FROM watch_history"
    )
    .fetch_one(pool)
    .await?;

    let series_row = sqlx::query(
        "SELECT COUNT(*) as cnt FROM library l
         JOIN media m ON l.media_id = m.id
         WHERE l.status = 'completed' AND m.media_type = 'anime'"
    )
    .fetch_one(pool)
    .await?;

    use sqlx::Row;
    Ok(WatchStatsSummary {
        total_time_seconds: row.get::<f64, _>("total_time"),
        episodes_completed: row.get::<i32, _>("eps_completed"),
        series_completed: series_row.get::<i32, _>("cnt"),
        total_episodes_started: row.get::<i32, _>("eps_started"),
    })
}
```

- [ ] **Step 4: Add `get_reading_stats_summary`**

Append to `stats.rs`:

```rust
pub async fn get_reading_stats_summary(pool: &SqlitePool) -> Result<ReadingStatsSummary> {
    let row = sqlx::query(
        "SELECT
            COUNT(CASE WHEN completed = 1 THEN 1 END) as chapters_completed,
            COALESCE(SUM(CASE WHEN completed = 1 THEN COALESCE(total_pages, 0) ELSE current_page END), 0) as total_pages,
            COUNT(*) as chapters_started
        FROM reading_history"
    )
    .fetch_one(pool)
    .await?;

    let series_row = sqlx::query(
        "SELECT COUNT(*) as cnt FROM library l
         JOIN media m ON l.media_id = m.id
         WHERE l.status = 'completed' AND m.media_type = 'manga'"
    )
    .fetch_one(pool)
    .await?;

    use sqlx::Row;
    Ok(ReadingStatsSummary {
        total_chapters_completed: row.get::<i32, _>("chapters_completed"),
        total_pages_read: row.get::<i32, _>("total_pages"),
        series_completed: series_row.get::<i32, _>("cnt"),
        total_chapters_started: row.get::<i32, _>("chapters_started"),
    })
}
```

- [ ] **Step 5: Add `get_daily_activity`**

Append to `stats.rs`:

```rust
pub async fn get_daily_activity(pool: &SqlitePool, days: i32) -> Result<Vec<DailyActivity>> {
    // Use SQLite's built-in 'localtime' modifier to convert UTC to system local time

    // Watch minutes per day (using local date)
    let watch_rows = sqlx::query(
        &format!(
            "SELECT DATE(last_watched, 'localtime') as day, SUM(progress_seconds) / 60.0 as minutes
            FROM watch_history
            WHERE DATE(last_watched, 'localtime') >= DATE('now', 'localtime', '-{} days')
            GROUP BY day ORDER BY day",
            days
        )
    )
    .fetch_all(pool)
    .await?;

    // Read minutes per day (estimated from pages)
    let read_rows = sqlx::query(
        &format!(
            "SELECT DATE(last_read, 'localtime') as day,
                SUM(CASE WHEN completed = 1 THEN COALESCE(total_pages, 0) ELSE current_page END) * {} as minutes
            FROM reading_history
            WHERE DATE(last_read, 'localtime') >= DATE('now', 'localtime', '-{} days')
            GROUP BY day ORDER BY day",
            READING_MINUTES_PER_PAGE, days
        )
    )
    .fetch_all(pool)
    .await?;

    // Merge watch and read data into a single timeline
    use std::collections::BTreeMap;
    use sqlx::Row;
    let mut day_map: BTreeMap<String, DailyActivity> = BTreeMap::new();

    for row in &watch_rows {
        let day: String = row.get("day");
        let minutes: f64 = row.get("minutes");
        day_map.entry(day.clone()).or_insert(DailyActivity {
            date: day,
            watch_minutes: 0.0,
            read_minutes: 0.0,
        }).watch_minutes = minutes;
    }

    for row in &read_rows {
        let day: String = row.get("day");
        let minutes: f64 = row.get("minutes");
        day_map.entry(day.clone()).or_insert(DailyActivity {
            date: day,
            watch_minutes: 0.0,
            read_minutes: 0.0,
        }).read_minutes = minutes;
    }

    Ok(day_map.into_values().collect())
}
```

- [ ] **Step 6: Add `get_genre_stats`**

Append to `stats.rs`:

```rust
pub async fn get_genre_stats(
    pool: &SqlitePool,
    media_type: Option<&str>,
) -> Result<Vec<GenreStat>> {
    let query_str = match media_type {
        Some("anime") => {
            "SELECT j.value as genre, SUM(w.progress_seconds) as time_seconds, COUNT(*) as count
             FROM watch_history w
             JOIN media m ON w.media_id = m.id, json_each(m.genres) j
             WHERE m.genres IS NOT NULL
             GROUP BY j.value ORDER BY time_seconds DESC LIMIT 10"
        }
        Some("manga") => {
            "SELECT j.value as genre,
                SUM(CASE WHEN r.completed = 1 THEN COALESCE(r.total_pages, 0) ELSE r.current_page END) * 120.0 as time_seconds,
                COUNT(*) as count
             FROM reading_history r
             JOIN media m ON r.media_id = m.id, json_each(m.genres) j
             WHERE m.genres IS NOT NULL
             GROUP BY j.value ORDER BY time_seconds DESC LIMIT 10"
        }
        _ => {
            "SELECT genre, SUM(time_seconds) as time_seconds, SUM(count) as count FROM (
                SELECT j.value as genre, SUM(w.progress_seconds) as time_seconds, COUNT(*) as count
                FROM watch_history w
                JOIN media m ON w.media_id = m.id, json_each(m.genres) j
                WHERE m.genres IS NOT NULL
                GROUP BY j.value
                UNION ALL
                SELECT j.value as genre,
                    SUM(CASE WHEN r.completed = 1 THEN COALESCE(r.total_pages, 0) ELSE r.current_page END) * 120.0 as time_seconds,
                    COUNT(*) as count
                FROM reading_history r
                JOIN media m ON r.media_id = m.id, json_each(m.genres) j
                WHERE m.genres IS NOT NULL
                GROUP BY j.value
            ) GROUP BY genre ORDER BY time_seconds DESC LIMIT 10"
        }
    };

    let rows = sqlx::query(query_str).fetch_all(pool).await?;

    use sqlx::Row;
    Ok(rows.iter().map(|row| GenreStat {
        genre: row.get("genre"),
        time_seconds: row.get("time_seconds"),
        count: row.get("count"),
    }).collect())
}
```

- [ ] **Step 7: Add `get_completion_stats`**

Append to `stats.rs`:

```rust
pub async fn get_completion_stats(pool: &SqlitePool) -> Result<CompletionStats> {
    let rows = sqlx::query(
        "SELECT m.media_type, l.status, COUNT(*) as cnt
         FROM library l
         JOIN media m ON l.media_id = m.id
         GROUP BY m.media_type, l.status"
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    let mut anime = CompletionStatsCategory { watching: 0, completed: 0, on_hold: 0, dropped: 0, plan_to_watch: 0 };
    let mut manga = CompletionStatsCategory { watching: 0, completed: 0, on_hold: 0, dropped: 0, plan_to_watch: 0 };

    for row in &rows {
        let media_type: String = row.get("media_type");
        let status: String = row.get("status");
        let cnt: i32 = row.get("cnt");

        let target = if media_type == "anime" { &mut anime } else { &mut manga };
        match status.as_str() {
            "watching" | "reading" => target.watching = cnt,
            "completed" => target.completed = cnt,
            "on_hold" => target.on_hold = cnt,
            "dropped" => target.dropped = cnt,
            "plan_to_watch" | "plan_to_read" => target.plan_to_watch = cnt,
            _ => {}
        }
    }

    Ok(CompletionStats { anime, manga })
}
```

- [ ] **Step 8: Add `get_top_watched_anime` and `get_top_read_manga`**

Append to `stats.rs`:

```rust
pub async fn get_top_watched_anime(pool: &SqlitePool, limit: i32) -> Result<Vec<TopWatchedEntry>> {
    let rows = sqlx::query(
        "SELECT m.*, SUM(w.progress_seconds) as total_time, COUNT(*) as eps_watched
         FROM watch_history w
         JOIN media m ON w.media_id = m.id
         GROUP BY m.id
         ORDER BY total_time DESC
         LIMIT ?"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    Ok(rows.iter().map(|row| TopWatchedEntry {
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
        total_time_seconds: row.get("total_time"),
        episodes_watched: row.get("eps_watched"),
    }).collect())
}

pub async fn get_top_read_manga(pool: &SqlitePool, limit: i32) -> Result<Vec<TopReadEntry>> {
    let rows = sqlx::query(
        "SELECT m.*, COUNT(CASE WHEN r.completed = 1 THEN 1 END) as chapters_read
         FROM reading_history r
         JOIN media m ON r.media_id = m.id
         GROUP BY m.id
         ORDER BY chapters_read DESC
         LIMIT ?"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    Ok(rows.iter().map(|row| TopReadEntry {
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
        chapters_read: row.get("chapters_read"),
    }).collect())
}
```

- [ ] **Step 9: Add streak and pattern functions**

Append to `stats.rs`:

```rust
pub async fn get_streak_stats(pool: &SqlitePool) -> Result<StreakStats> {
    // Get all unique active dates in local timezone
    // Use SQLite's built-in 'localtime' modifier to convert UTC to system local time

    let rows = sqlx::query(
            "SELECT DISTINCT day FROM (
                SELECT DATE(last_watched, 'localtime') as day FROM watch_history
                UNION
                SELECT DATE(last_read, 'localtime') as day FROM reading_history
            ) ORDER BY day DESC"
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    let dates: Vec<String> = rows.iter().map(|r| r.get::<String, _>("day")).collect();

    if dates.is_empty() {
        return Ok(StreakStats {
            current_streak_days: 0,
            longest_streak_days: 0,
            longest_streak_start: String::new(),
            longest_streak_end: String::new(),
        });
    }

    let today = Local::now().format("%Y-%m-%d").to_string();

    // Calculate current streak (from today or yesterday backwards)
    let mut current_streak = 0i32;
    let first_date = &dates[0];
    let is_today = first_date == &today;
    let is_yesterday = {
        let yesterday = (Local::now() - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
        first_date == &yesterday
    };

    if is_today || is_yesterday {
        current_streak = 1;
        for i in 1..dates.len() {
            let prev = NaiveDateTime::parse_from_str(&format!("{} 00:00:00", dates[i-1]), "%Y-%m-%d %H:%M:%S");
            let curr = NaiveDateTime::parse_from_str(&format!("{} 00:00:00", dates[i]), "%Y-%m-%d %H:%M:%S");
            if let (Ok(p), Ok(c)) = (prev, curr) {
                if (p - c).num_days() == 1 {
                    current_streak += 1;
                } else {
                    break;
                }
            }
        }
    }

    // Calculate longest streak
    let mut longest = 1i32;
    let mut longest_start = dates.last().cloned().unwrap_or_default();
    let mut longest_end = dates.first().cloned().unwrap_or_default();
    let mut streak = 1i32;
    let mut streak_start_idx = 0usize;

    for i in 1..dates.len() {
        let prev = NaiveDateTime::parse_from_str(&format!("{} 00:00:00", dates[i-1]), "%Y-%m-%d %H:%M:%S");
        let curr = NaiveDateTime::parse_from_str(&format!("{} 00:00:00", dates[i]), "%Y-%m-%d %H:%M:%S");
        if let (Ok(p), Ok(c)) = (prev, curr) {
            if (p - c).num_days() == 1 {
                streak += 1;
            } else {
                if streak > longest {
                    longest = streak;
                    longest_end = dates[streak_start_idx].clone();
                    longest_start = dates[i - 1].clone();
                }
                streak = 1;
                streak_start_idx = i;
            }
        }
    }
    if streak > longest {
        longest = streak;
        longest_end = dates[streak_start_idx].clone();
        longest_start = dates[dates.len() - 1].clone();
    }

    Ok(StreakStats {
        current_streak_days: current_streak,
        longest_streak_days: longest,
        longest_streak_start: longest_start,
        longest_streak_end: longest_end,
    })
}

pub async fn get_activity_patterns(pool: &SqlitePool) -> Result<ActivityPatterns> {
    // Use SQLite's built-in 'localtime' modifier to convert UTC to system local time

    // Most active day of week
    let dow_rows = sqlx::query(
        &format!(
            "SELECT day_of_week, AVG(total_minutes) as avg_min FROM (
                SELECT strftime('%w', day) as day_of_week, SUM(minutes) as total_minutes FROM (
                    SELECT DATE(last_watched, 'localtime') as day, SUM(progress_seconds) / 60.0 as minutes
                    FROM watch_history GROUP BY day
                    UNION ALL
                    SELECT DATE(last_read, 'localtime') as day,
                        SUM(CASE WHEN completed = 1 THEN COALESCE(total_pages, 0) ELSE current_page END) * {} as minutes
                    FROM reading_history GROUP BY day
                ) GROUP BY day
            ) GROUP BY day_of_week ORDER BY avg_min DESC LIMIT 1",
            READING_MINUTES_PER_PAGE
        )
    )
    .fetch_optional(pool)
    .await?;

    use sqlx::Row;
    let (most_active_day, _avg) = match dow_rows {
        Some(row) => {
            let dow: String = row.get("day_of_week");
            let avg: f64 = row.get("avg_min");
            let day_name = match dow.as_str() {
                "0" => "Sunday", "1" => "Monday", "2" => "Tuesday",
                "3" => "Wednesday", "4" => "Thursday", "5" => "Friday",
                "6" => "Saturday", _ => "Unknown"
            };
            (day_name.to_string(), avg)
        }
        None => ("None".to_string(), 0.0),
    };

    // Average daily minutes (across all active days)
    let avg_row = sqlx::query(
        &format!(
            "SELECT AVG(total_minutes) as avg_min FROM (
                SELECT SUM(minutes) as total_minutes FROM (
                    SELECT DATE(last_watched, 'localtime') as day, SUM(progress_seconds) / 60.0 as minutes
                    FROM watch_history GROUP BY day
                    UNION ALL
                    SELECT DATE(last_read, 'localtime') as day,
                        SUM(CASE WHEN completed = 1 THEN COALESCE(total_pages, 0) ELSE current_page END) * {} as minutes
                    FROM reading_history GROUP BY day
                ) GROUP BY day
            )",
            READING_MINUTES_PER_PAGE
        )
    )
    .fetch_one(pool)
    .await?;

    let avg_daily: f64 = avg_row.try_get("avg_min").unwrap_or(0.0);

    Ok(ActivityPatterns {
        most_active_day,
        avg_daily_minutes: avg_daily,
        avg_daily_span_minutes: 0.0, // Simplified: would require min/max timestamp per day
    })
}

pub async fn get_binge_stats(pool: &SqlitePool) -> Result<BingeStats> {
    // Use SQLite's built-in 'localtime' modifier to convert UTC to system local time

    // Most episodes in a single day
    let ep_row = sqlx::query(
            "SELECT m.title, DATE(w.last_watched, 'localtime') as day, COUNT(*) as cnt
            FROM watch_history w
            JOIN media m ON w.media_id = m.id
            GROUP BY m.id, day
            ORDER BY cnt DESC LIMIT 1"
    )
    .fetch_optional(pool)
    .await?;

    // Most chapters in a single day
    let ch_row = sqlx::query(
            "SELECT m.title, DATE(r.last_read, 'localtime') as day, COUNT(*) as cnt
            FROM reading_history r
            JOIN media m ON r.media_id = m.id
            GROUP BY m.id, day
            ORDER BY cnt DESC LIMIT 1"
    )
    .fetch_optional(pool)
    .await?;

    use sqlx::Row;
    Ok(BingeStats {
        max_episodes_in_day: ep_row.as_ref().map(|r| r.get::<i32, _>("cnt")).unwrap_or(0),
        max_episodes_anime_title: ep_row.as_ref().map(|r| r.get::<String, _>("title")).unwrap_or_default(),
        max_episodes_date: ep_row.as_ref().map(|r| r.get::<String, _>("day")).unwrap_or_default(),
        max_chapters_in_day: ch_row.as_ref().map(|r| r.get::<i32, _>("cnt")).unwrap_or(0),
        max_chapters_manga_title: ch_row.as_ref().map(|r| r.get::<String, _>("title")).unwrap_or_default(),
        max_chapters_date: ch_row.as_ref().map(|r| r.get::<String, _>("day")).unwrap_or_default(),
    })
}
```

- [ ] **Step 10: Verify compilation**

```bash
cd /Users/vishnukv/facets/codebases/otaku/src-tauri && cargo check
```

Expected: compiles without errors

- [ ] **Step 11: Commit**

```bash
cd /Users/vishnukv/facets/codebases/otaku
git add src-tauri/src/database/stats.rs src-tauri/src/database/mod.rs
git commit -m "feat: add stats database module with summary, activity, genre, streak queries"
```

---

## Task 4: Backend — Register Tauri commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

Wire up all new database functions as Tauri commands.

- [ ] **Step 1: Add history commands to commands.rs**

Add these command functions to `src-tauri/src/commands.rs` (near the existing watch/reading progress commands):

```rust
// --- History Commands ---

#[tauri::command]
pub async fn get_all_history(
    state: State<'_, AppState>,
    page: i32,
    limit: i32,
    media_type: Option<String>,
    search: Option<String>,
) -> Result<Vec<crate::database::history::HistoryEntry>, String> {
    let pool = state.database.pool();
    crate::database::history::get_all_history(
        pool, page, limit,
        media_type.as_deref(),
        search.as_deref(),
    ).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_history_grouped_by_media(
    state: State<'_, AppState>,
    page: i32,
    limit: i32,
    media_type: Option<String>,
    search: Option<String>,
) -> Result<Vec<crate::database::history::MediaHistorySummary>, String> {
    let pool = state.database.pool();
    crate::database::history::get_history_grouped_by_media(
        pool, page, limit,
        media_type.as_deref(),
        search.as_deref(),
    ).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_watch_history_entry(
    state: State<'_, AppState>,
    media_id: String,
    episode_id: String,
) -> Result<(), String> {
    let pool = state.database.pool();
    crate::database::history::remove_watch_history_entry(pool, &media_id, &episode_id)
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_reading_history_entry(
    state: State<'_, AppState>,
    media_id: String,
    chapter_id: String,
) -> Result<(), String> {
    let pool = state.database.pool();
    crate::database::history::remove_reading_history_entry(pool, &media_id, &chapter_id)
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_all_reading_history(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pool = state.database.pool();
    crate::database::history::clear_all_reading_history(pool)
        .await.map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Add stats commands to commands.rs**

```rust
// --- Stats Commands ---

#[tauri::command]
pub async fn get_watch_stats_summary(
    state: State<'_, AppState>,
) -> Result<crate::database::stats::WatchStatsSummary, String> {
    let pool = state.database.pool();
    crate::database::stats::get_watch_stats_summary(pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_reading_stats_summary(
    state: State<'_, AppState>,
) -> Result<crate::database::stats::ReadingStatsSummary, String> {
    let pool = state.database.pool();
    crate::database::stats::get_reading_stats_summary(pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_daily_activity(
    state: State<'_, AppState>,
    days: i32,
) -> Result<Vec<crate::database::stats::DailyActivity>, String> {
    let pool = state.database.pool();
    crate::database::stats::get_daily_activity(pool, days).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_genre_stats(
    state: State<'_, AppState>,
    media_type: Option<String>,
) -> Result<Vec<crate::database::stats::GenreStat>, String> {
    let pool = state.database.pool();
    crate::database::stats::get_genre_stats(pool, media_type.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_completion_stats(
    state: State<'_, AppState>,
) -> Result<crate::database::stats::CompletionStats, String> {
    let pool = state.database.pool();
    crate::database::stats::get_completion_stats(pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_top_watched_anime(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<crate::database::stats::TopWatchedEntry>, String> {
    let pool = state.database.pool();
    crate::database::stats::get_top_watched_anime(pool, limit).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_top_read_manga(
    state: State<'_, AppState>,
    limit: i32,
) -> Result<Vec<crate::database::stats::TopReadEntry>, String> {
    let pool = state.database.pool();
    crate::database::stats::get_top_read_manga(pool, limit).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_streak_stats(
    state: State<'_, AppState>,
) -> Result<crate::database::stats::StreakStats, String> {
    let pool = state.database.pool();
    crate::database::stats::get_streak_stats(pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_activity_patterns(
    state: State<'_, AppState>,
) -> Result<crate::database::stats::ActivityPatterns, String> {
    let pool = state.database.pool();
    crate::database::stats::get_activity_patterns(pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_binge_stats(
    state: State<'_, AppState>,
) -> Result<crate::database::stats::BingeStats, String> {
    let pool = state.database.pool();
    crate::database::stats::get_binge_stats(pool).await.map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, find the `tauri::generate_handler![...]` macro call and add these entries:

```rust
commands::get_all_history,
commands::get_history_grouped_by_media,
commands::remove_watch_history_entry,
commands::remove_reading_history_entry,
commands::clear_all_reading_history,
commands::get_watch_stats_summary,
commands::get_reading_stats_summary,
commands::get_daily_activity,
commands::get_genre_stats,
commands::get_completion_stats,
commands::get_top_watched_anime,
commands::get_top_read_manga,
commands::get_streak_stats,
commands::get_activity_patterns,
commands::get_binge_stats,
```

- [ ] **Step 4: Verify compilation**

```bash
cd /Users/vishnukv/facets/codebases/otaku/src-tauri && cargo check
```

Expected: compiles without errors

- [ ] **Step 5: Commit**

```bash
cd /Users/vishnukv/facets/codebases/otaku
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: register history and stats Tauri commands"
```

---

## Task 5: Frontend — TypeScript types and command wrappers

**Files:**
- Modify: `src/utils/tauri-commands.ts`

Add TypeScript interfaces matching the Rust structs, and async wrapper functions.

- [ ] **Step 1: Add history types**

Add near the existing `WatchHistory` and `ContinueWatchingEntry` types in `src/utils/tauri-commands.ts`:

```typescript
// --- History Types ---

export interface HistoryEntry {
  type: 'watch' | 'read'
  media: MediaEntry
  episode_id: string | null
  chapter_id: string | null
  episode_number: number | null
  chapter_number: number | null
  progress_seconds: number | null
  current_page: number | null
  duration: number | null
  total_pages: number | null
  completed: boolean
  timestamp: string
}

export interface MediaHistorySummary {
  media: MediaEntry
  type: 'anime' | 'manga'
  items_completed: number
  total_items: number | null
  total_time_seconds: number
  last_activity: string
}
```

- [ ] **Step 2: Add stats types**

```typescript
// --- Stats Types ---

export interface WatchStatsSummary {
  total_time_seconds: number
  episodes_completed: number
  series_completed: number
  total_episodes_started: number
}

export interface ReadingStatsSummary {
  total_chapters_completed: number
  total_pages_read: number
  series_completed: number
  total_chapters_started: number
}

export interface DailyActivity {
  date: string
  watch_minutes: number
  read_minutes: number
}

export interface GenreStat {
  genre: string
  time_seconds: number
  count: number
}

export interface CompletionStatsCategory {
  watching: number
  completed: number
  on_hold: number
  dropped: number
  plan_to_watch: number
}

export interface CompletionStats {
  anime: CompletionStatsCategory
  manga: CompletionStatsCategory
}

export interface TopWatchedEntry {
  media: MediaEntry
  total_time_seconds: number
  episodes_watched: number
}

export interface TopReadEntry {
  media: MediaEntry
  chapters_read: number
}

export interface StreakStats {
  current_streak_days: number
  longest_streak_days: number
  longest_streak_start: string
  longest_streak_end: string
}

export interface ActivityPatterns {
  most_active_day: string
  avg_daily_minutes: number
  avg_daily_span_minutes: number
}

export interface BingeStats {
  max_episodes_in_day: number
  max_episodes_anime_title: string
  max_episodes_date: string
  max_chapters_in_day: number
  max_chapters_manga_title: string
  max_chapters_date: string
}
```

- [ ] **Step 3: Add history command wrappers**

```typescript
// --- History Commands ---

export async function getAllHistory(
  page: number,
  limit: number,
  mediaType?: string,
  search?: string
): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>('get_all_history', {
    page,
    limit,
    mediaType: mediaType ?? null,
    search: search ?? null,
  })
}

export async function getHistoryGroupedByMedia(
  page: number,
  limit: number,
  mediaType?: string,
  search?: string
): Promise<MediaHistorySummary[]> {
  return invoke<MediaHistorySummary[]>('get_history_grouped_by_media', {
    page,
    limit,
    mediaType: mediaType ?? null,
    search: search ?? null,
  })
}

export async function removeWatchHistoryEntry(
  mediaId: string,
  episodeId: string
): Promise<void> {
  return invoke<void>('remove_watch_history_entry', { mediaId, episodeId })
}

export async function removeReadingHistoryEntry(
  mediaId: string,
  chapterId: string
): Promise<void> {
  return invoke<void>('remove_reading_history_entry', { mediaId, chapterId })
}

export async function clearAllWatchHistory(): Promise<void> {
  return invoke<void>('clear_all_watch_history')
}

export async function clearAllReadingHistory(): Promise<void> {
  return invoke<void>('clear_all_reading_history')
}
```

- [ ] **Step 4: Add stats command wrappers**

```typescript
// --- Stats Commands ---

export async function getWatchStatsSummary(): Promise<WatchStatsSummary> {
  return invoke<WatchStatsSummary>('get_watch_stats_summary')
}

export async function getReadingStatsSummary(): Promise<ReadingStatsSummary> {
  return invoke<ReadingStatsSummary>('get_reading_stats_summary')
}

export async function getDailyActivity(days: number): Promise<DailyActivity[]> {
  return invoke<DailyActivity[]>('get_daily_activity', { days })
}

export async function getGenreStats(mediaType?: string): Promise<GenreStat[]> {
  return invoke<GenreStat[]>('get_genre_stats', { mediaType: mediaType ?? null })
}

export async function getCompletionStats(): Promise<CompletionStats> {
  return invoke<CompletionStats>('get_completion_stats')
}

export async function getTopWatchedAnime(limit: number): Promise<TopWatchedEntry[]> {
  return invoke<TopWatchedEntry[]>('get_top_watched_anime', { limit })
}

export async function getTopReadManga(limit: number): Promise<TopReadEntry[]> {
  return invoke<TopReadEntry[]>('get_top_read_manga', { limit })
}

export async function getStreakStats(): Promise<StreakStats> {
  return invoke<StreakStats>('get_streak_stats')
}

export async function getActivityPatterns(): Promise<ActivityPatterns> {
  return invoke<ActivityPatterns>('get_activity_patterns')
}

export async function getBingeStats(): Promise<BingeStats> {
  return invoke<BingeStats>('get_binge_stats')
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/vishnukv/facets/codebases/otaku && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 6: Commit**

```bash
cd /Users/vishnukv/facets/codebases/otaku
git add src/utils/tauri-commands.ts
git commit -m "feat: add TypeScript types and command wrappers for history and stats"
```

---

## Task 6: Frontend — History page components

**Files:**
- Create: `src/components/history/HistoryPage.tsx`
- Create: `src/components/history/TimelineView.tsx`
- Create: `src/components/history/SeriesView.tsx`
- Create: `src/components/history/HistoryEntry.tsx`
- Create: `src/components/history/SeriesCard.tsx`
- Create: `src/routes/history.tsx`

Build the complete `/history` page with timeline and series views.

- [ ] **Step 1: Create the route file**

Create `src/routes/history.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { HistoryPage } from '@/components/history/HistoryPage'

export const Route = createFileRoute('/history')({
  component: HistoryPage,
})
```

- [ ] **Step 2: Create HistoryEntry component**

Create `src/components/history/HistoryEntry.tsx` — a single row in the timeline view showing cover, title, progress, and actions.

The component receives a `HistoryEntry` type from `tauri-commands.ts` and renders:
- Cover thumbnail (64x96px, rounded) using `useProxiedImage`
- Title with media type badge ("Anime" or "Manga")
- Progress info: "EP 4 · 14:32 / 23:45" for anime, "Ch. 12.5 · Page 8/24" for manga
- Progress bar (or checkmark if completed)
- Relative timestamp (using `Date` comparison for "2h ago", "Yesterday", etc.)
- Resume button (navigates to `/watch` or `/read`)
- Remove button (X icon, calls `removeWatchHistoryEntry` or `removeReadingHistoryEntry`)

Format chapter numbers: show as integer if whole (e.g., "12"), as decimal if fractional (e.g., "12.5").

Format time: convert `progress_seconds` to "mm:ss" or "h:mm:ss" format.

- [ ] **Step 3: Create SeriesCard component**

Create `src/components/history/SeriesCard.tsx` — an expandable card for the series view.

Shows: cover thumbnail, title, "12/24 episodes watched" or "8 chapters read", progress bar, last activity timestamp.

When expanded (via click), fetches individual history entries for that media via `getAllHistory(1, 100, mediaType, null)` filtered by media ID client-side, and renders them as a list of `HistoryEntry` components.

- [ ] **Step 4: Create TimelineView component**

Create `src/components/history/TimelineView.tsx`:

- Receives `entries: HistoryEntry[]`, `loading: boolean`, `onLoadMore: () => void`, `onRemove: (entry) => void`
- Groups entries by date: compare `entry.timestamp` to today/yesterday/date string
- Date grouping helper: `getDateLabel(timestamp: string): string` returns "Today", "Yesterday", or formatted date
- Renders date headers with entry lists underneath
- Intersection Observer at bottom triggers `onLoadMore` for infinite scroll
- Shows skeleton loaders when `loading` is true
- Shows empty state when entries array is empty

- [ ] **Step 5: Create SeriesView component**

Create `src/components/history/SeriesView.tsx`:

- Receives `summaries: MediaHistorySummary[]`, `loading: boolean`, `onLoadMore: () => void`, `onRemove: (mediaId, episodeId?, chapterId?) => void`
- Renders a grid of `SeriesCard` components (responsive: 1 col mobile, 2 col tablet, 3 col desktop)
- Intersection Observer for infinite scroll
- Skeleton loaders and empty state

- [ ] **Step 6: Create HistoryPage component**

Create `src/components/history/HistoryPage.tsx` — the main page that orchestrates everything:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { getAllHistory, getHistoryGroupedByMedia, removeWatchHistoryEntry, removeReadingHistoryEntry, clearAllReadingHistory, clearAllWatchHistory } from '@/utils/tauri-commands'
import type { HistoryEntry, MediaHistorySummary } from '@/utils/tauri-commands'
import { TimelineView } from './TimelineView'
import { SeriesView } from './SeriesView'
import { useSettingsStore } from '@/store/settingsStore'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import { Search, Trash2 } from 'lucide-react'
```

State:
- `view`: 'timeline' | 'series' (default 'timeline')
- `mediaType`: 'all' | 'anime' | 'manga' (default 'all')
- `search`: debounced search string (300ms)
- `entries`: `HistoryEntry[]` for timeline
- `summaries`: `MediaHistorySummary[]` for series view
- `page`: current page number
- `loading`, `hasMore`: pagination state

Data loading:
- On view/mediaType/search change, reset page to 1 and reload
- Timeline: calls `getAllHistory(page, 50, mediaType === 'all' ? undefined : mediaType, search)`
- Series: calls `getHistoryGroupedByMedia(page, 50, mediaType === 'all' ? undefined : mediaType, search)`
- Apply NSFW filter via `filterNsfwContent`
- Append results on page increment (infinite scroll)

Actions:
- Remove entry: call appropriate remove function, filter from local state
- Clear all: confirmation dialog, call `clearAllWatchHistory()` + `clearAllReadingHistory()`, reset state

Header layout:
- Pill toggle for Timeline/Series
- Tab buttons for All/Anime/Manga
- Search input with debounce
- Clear All button (trash icon with confirmation)

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /Users/vishnukv/facets/codebases/otaku && npx tsc --noEmit
```

- [ ] **Step 8: Verify dev server loads the page**

```bash
cd /Users/vishnukv/facets/codebases/otaku && npm run dev
```

Navigate to `http://localhost:1420/history` and verify the page renders without errors.

- [ ] **Step 9: Commit**

```bash
cd /Users/vishnukv/facets/codebases/otaku
git add src/routes/history.tsx src/components/history/
git commit -m "feat: add history page with timeline and series views"
```

---

## Task 7: Frontend — Stats page components

**Files:**
- Create: `src/components/stats/StatsPage.tsx`
- Create: `src/components/stats/SummaryCards.tsx`
- Create: `src/components/stats/ActivityChart.tsx`
- Create: `src/components/stats/GenreDistribution.tsx`
- Create: `src/components/stats/CompletionRings.tsx`
- Create: `src/components/stats/TopContent.tsx`
- Create: `src/components/stats/StreaksAndFun.tsx`

Build the complete `/stats` activity dashboard.

- [ ] **Step 1: Create SummaryCards component**

Create `src/components/stats/SummaryCards.tsx`:

- Receives `watchStats: WatchStatsSummary | null`, `readingStats: ReadingStatsSummary | null`
- Four cards in responsive grid (`grid-cols-2 lg:grid-cols-4`)
- Each card: icon, label, large formatted value, subtle secondary info
- Time Watched: format seconds as "Xd Xh Xm" helper function
- Episodes Completed: plain number with `toLocaleString()`
- Chapters Read: plain number
- Series Completed: sum of anime + manga series completed
- Skeleton state when data is null

- [ ] **Step 2: Create ActivityChart component**

Create `src/components/stats/ActivityChart.tsx`:

- Receives `data: DailyActivity[]`, `loading: boolean`
- Period toggle buttons: "7D" | "30D" | "90D" | "All"
- On period change, calls parent callback to refetch with new `days` value
- Uses recharts `AreaChart` with `ResponsiveContainer`:

```typescript
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
```

- Two `Area` elements: anime (blue #3b82f6) and manga (purple #8b5cf6)
- Custom tooltip showing exact minutes per category
- Manga tooltip includes "(estimated)" label
- Empty state: "Start watching or reading to see your activity trend"
- X-axis formats dates as "Mar 20" (short month + day)

- [ ] **Step 3: Create GenreDistribution component**

Create `src/components/stats/GenreDistribution.tsx`:

- Receives `genres: GenreStat[]`, `loading: boolean`
- Toggle: "Anime" | "Manga" | "Combined" — calls parent to refetch
- CSS horizontal bar chart:
  - Each bar: genre label (left), colored div with width proportional to max, time label (right)
  - Colors: use a 10-color palette array indexed by position
  - Bar width: `(stat.time_seconds / maxTime) * 100%`
- Format time: convert seconds to "Xh Xm" or "Xm" if under 1 hour
- Empty state: "No genre data yet"

- [ ] **Step 4: Create CompletionRings component**

Create `src/components/stats/CompletionRings.tsx`:

- Receives `stats: CompletionStats | null`
- Two SVG donut/ring charts side by side (anime + manga)
- Each ring uses SVG `<circle>` elements with `stroke-dasharray` and `stroke-dashoffset` for segments
- Color mapping: Completed (green), Watching (blue), On Hold (yellow), Dropped (red), Plan to Watch (gray)
- Total count in center of each ring
- Legend below each ring with colored dots and counts
- Labels: "Anime Library" and "Manga Library"
- Empty state when all counts are 0

- [ ] **Step 5: Create TopContent component**

Create `src/components/stats/TopContent.tsx`:

- Receives `topAnime: TopWatchedEntry[]`, `topManga: TopReadEntry[]`, `loading: boolean`
- Two columns (or stacked on mobile)
- Each list: numbered rank, cover thumbnail (40x60), title, stat value
- Anime: "Xh Xm · Y episodes"
- Manga: "X chapters read"
- Proxied images via `useProxiedImage`
- Empty state: "Watch more to see your favorites here"

- [ ] **Step 6: Create StreaksAndFun component**

Create `src/components/stats/StreaksAndFun.tsx`:

- Receives `streaks: StreakStats | null`, `patterns: ActivityPatterns | null`, `binge: BingeStats | null`
- Grid of stat tiles (responsive: 2 cols mobile, 3-4 cols desktop)
- Current streak: large number + "days" + flame icon (only if > 0)
- Longest streak: number + date range
- Most active day: day name + average time
- Average daily: formatted minutes
- Binge records: "X episodes of [Title]" and "X chapters of [Title]"
- Each tile: subtle background, icon, label, value
- Empty state for streaks: "0 day streak — watch or read something today!"

- [ ] **Step 7: Create StatsPage component**

Create `src/components/stats/StatsPage.tsx` — main orchestrator:

```typescript
import { useState, useEffect } from 'react'
import { getWatchStatsSummary, getReadingStatsSummary, getDailyActivity, getGenreStats, getCompletionStats, getTopWatchedAnime, getTopReadManga, getStreakStats, getActivityPatterns, getBingeStats } from '@/utils/tauri-commands'
```

State: one state variable per data section (all nullable, start null).

On mount: fire all 10 API calls in parallel via `Promise.allSettled()`. Update each state as its promise resolves (don't wait for all).

Layout (vertical scroll):
1. Page header: "Activity Stats" with subtle description
2. `<SummaryCards />`
3. `<ActivityChart />` with period state managed here
4. `<GenreDistribution />` with media type toggle state here
5. Two-column row: `<CompletionRings />` and `<TopContent />`
6. `<StreaksAndFun />`

- [ ] **Step 8: Rewrite stats route**

Rewrite `src/routes/stats.tsx` to:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { StatsPage } from '@/components/stats/StatsPage'

export const Route = createFileRoute('/stats')({
  component: StatsPage,
})
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd /Users/vishnukv/facets/codebases/otaku && npx tsc --noEmit
```

- [ ] **Step 10: Verify dev server loads the page**

Navigate to `http://localhost:1420/stats` and verify the dashboard renders.

- [ ] **Step 11: Commit**

```bash
cd /Users/vishnukv/facets/codebases/otaku
git add src/routes/stats.tsx src/components/stats/
git commit -m "feat: add activity statistics dashboard with charts, genres, streaks"
```

---

## Task 8: Relocate system stats to Settings

**Files:**
- Create: `src/components/settings/DeveloperStats.tsx`
- Modify: `src/routes/settings.tsx`

Move the existing system metrics UI into a collapsible section within Settings.

- [ ] **Step 1: Create DeveloperStats component**

Create `src/components/settings/DeveloperStats.tsx`:

Extract the core system stats UI from the old `src/routes/stats.tsx` (before it was rewritten in Task 7). This component should:

- Accept no props (self-contained)
- Manage its own expanded/collapsed state (default collapsed)
- Only start SSE stream (`startStatsStream()`) when expanded
- Stop stream (`stopStatsStream()`) when collapsed or unmounted
- Reuse the `StatCard` and `MiniChart` patterns from the original stats page
- Include storage usage display
- Wrap in a collapsible container with chevron toggle

Key: Read the git history for the original `src/routes/stats.tsx` content before the rewrite:

```bash
git show HEAD~1:src/routes/stats.tsx
```

Use that as the base and adapt it into a collapsible, self-contained component.

- [ ] **Step 2: Embed in Settings page**

In `src/routes/settings.tsx`, replace the existing Developer section (which currently just links to `/stats` and `/logs`) with:

```typescript
import { DeveloperStats } from '@/components/settings/DeveloperStats'
```

Replace the "System Stats" `SettingRow` with:

```typescript
<SettingSection title="Developer" description="Debugging and diagnostic tools">
  <DeveloperStats />
  <SettingRow
    label="Application Logs"
    description="View error logs and debug information"
  >
    <Link to="/logs" className="...">
      <FileText size={16} />
      View Logs
      <ChevronRight size={16} className="text-[var(--color-text-tertiary)]" />
    </Link>
  </SettingRow>
</SettingSection>
```

- [ ] **Step 3: Verify Settings page works**

Navigate to Settings, scroll to Developer section, expand system stats. Verify SSE stream starts/stops correctly.

- [ ] **Step 4: Commit**

```bash
cd /Users/vishnukv/facets/codebases/otaku
git add src/components/settings/DeveloperStats.tsx src/routes/settings.tsx
git commit -m "refactor: relocate system stats to Settings developer section"
```

---

## Task 9: Navigation updates

**Files:**
- Modify: `src/components/layout/TopNav.tsx`
- Modify: `src/routes/library.tsx`

Add navigation links for both features.

- [ ] **Step 1: Add to TopNav**

In `src/components/layout/TopNav.tsx`, update the `navItems` array:

```typescript
const navItems = [
  { name: 'Home', path: '/' },
  { name: 'Anime', path: '/anime' },
  { name: 'Manga', path: '/manga' },
  { name: 'Schedule', path: '/schedule' },
  { name: 'Library', path: '/library' },
  { name: 'History', path: '/history' },
  { name: 'Stats', path: '/stats' },
]
```

- [ ] **Step 2: Add mobile links to Library page**

In `src/routes/library.tsx`, add History and Stats links visible on mobile. Add a small section above the library tabs or below the header:

```typescript
import { useMobileLayout } from '@/hooks/useMobileLayout'
import { Link } from '@tanstack/react-router'
import { Clock, BarChart3 } from 'lucide-react'
```

Add below the page header, visible only on mobile:

```typescript
{isMobile && (
  <div className="flex gap-2 px-4 mb-3">
    <Link
      to="/history"
      className="flex-1 flex items-center justify-center gap-2 bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-hover)] rounded-lg py-2.5 text-sm font-medium text-[var(--color-text-secondary)]"
    >
      <Clock size={16} />
      History
    </Link>
    <Link
      to="/stats"
      className="flex-1 flex items-center justify-center gap-2 bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-hover)] rounded-lg py-2.5 text-sm font-medium text-[var(--color-text-secondary)]"
    >
      <BarChart3 size={16} />
      Stats
    </Link>
  </div>
)}
```

- [ ] **Step 3: Verify navigation**

- Desktop: TopNav shows History and Stats links
- Mobile: Library page shows History and Stats shortcut buttons
- Both routes are accessible and render correctly

- [ ] **Step 4: Commit**

```bash
cd /Users/vishnukv/facets/codebases/otaku
git add src/components/layout/TopNav.tsx src/routes/library.tsx
git commit -m "feat: add History and Stats navigation links"
```

---

## Task 10: Full build verification

- [ ] **Step 1: TypeScript check**

```bash
cd /Users/vishnukv/facets/codebases/otaku && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 2: Rust check**

```bash
cd /Users/vishnukv/facets/codebases/otaku/src-tauri && cargo check
```

Expected: no errors

- [ ] **Step 3: Full production build**

```bash
cd /Users/vishnukv/facets/codebases/otaku && npm run build
```

Expected: build succeeds

- [ ] **Step 4: Manual smoke test**

Run the app and verify:
1. `/history` — timeline loads, series view works, search filters, remove works
2. `/stats` — all sections render with data (or empty states if no data)
3. Settings → Developer → system stats still works (collapsible)
4. Navigation: TopNav links work, mobile Library shortcuts work

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
cd /Users/vishnukv/facets/codebases/otaku
git add -A
git commit -m "fix: address build issues from history and stats implementation"
```
