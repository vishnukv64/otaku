# Watch History & Activity Statistics Design Spec

## Overview

Two new features for the Otaku app:
1. **Watch/Read History** (`/history`) — chronological and per-series views of all watched episodes and read chapters
2. **Activity Statistics** (`/stats`) — dashboard showing watch/read metrics, genre breakdowns, streaks, and activity trends

Both features build on existing `watch_history` and `reading_history` SQLite tables that already track per-episode/chapter progress.

## Decisions

- **Two separate routes** (`/history` and `/stats`) rather than a combined page — clean separation of "what" vs "how much"
- **History has two views**: Timeline (chronological by day) and Series (grouped by anime/manga)
- **Stats covers both anime and manga** in a unified dashboard
- **Charts**: CSS/Tailwind for everything except the daily activity time-series graph, which uses `recharts` (~40KB gzipped)
- **System stats** (CPU/memory) currently at `/stats` will be relocated to `/settings` as a Developer section
- **Single `library` table**: Both anime and manga share one `library` table, differentiated by joining with `media.media_type`. There is no separate `manga_library` table.
- **Fractional chapter numbers**: `reading_history.chapter_number` is `REAL`/`f64` (e.g., Ch. 34.5). UI must display fractional values correctly.
- **Streaks use local timezone**: Streak calculations convert UTC timestamps to system local time before grouping by day. The Tauri backend reads the system timezone via `chrono::Local`.
- **Reading time estimation**: Since actual reading duration is not tracked, manga "time" in stats is estimated as `completed_chapters * avg_pages * 2 min/page` (configurable constant). This is clearly labeled as an estimate in the UI.

---

## Feature 1: Watch/Read History Page (`/history`)

### Route & Navigation

- New TanStack Router route at `/history`
- **Desktop**: Added to TopNav navigation links
- **Mobile**: Accessible from Library page (as a "History" tab/link within Library) rather than adding a 6th BottomTabBar item, which would crowd small screens. The BottomTabBar stays at 5 items.
- Component file: `src/routes/history.tsx` (thin wrapper) + `src/components/history/HistoryPage.tsx`

### UI Layout

#### Header
- **View toggle**: "Timeline" | "Series" pill switcher
- **Type filter tabs**: "All" | "Anime" | "Manga" (when "All" is selected, a unified backend query handles merged pagination — see commands below)
- **Search bar**: filter entries by title (debounced 300ms)
- **Clear All History**: button with confirmation dialog

#### Timeline View (default)
- Entries grouped by date: "Today", "Yesterday", then date strings ("March 20, 2026")
- Each entry:
  - Cover thumbnail (proxied via `useProxiedImage`)
  - Title (anime/manga name)
  - Episode/chapter info: "EP 4 · 14:32 / 23:45" or "Ch. 12.5 · Page 8/24" (chapter numbers may be fractional)
  - Progress bar (percentage of episode/chapter completed)
  - Completed episodes/chapters show checkmark icon instead of progress bar
  - Relative timestamp ("2h ago", "Yesterday at 3:15 PM")
- **Actions per entry**:
  - Click → opens `MediaDetailModal` or `MangaDetailModal`
  - Resume button → navigates to `/watch?malId=X&episodeId=Y` or `/read?malId=X&chapterId=Y`
  - Remove button (X icon on desktop, swipe on mobile) → deletes single history entry
- **Pagination**: infinite scroll, 50 entries per page

#### Series View
- One card per anime/manga with aggregate stats
- Card contents:
  - Cover thumbnail
  - Title
  - Progress summary: "12/24 episodes watched" or "8/45 chapters read"
  - Overall series progress bar
  - Last activity timestamp
- Click card → expand inline to show individual episode/chapter entries
- Same resume/remove actions on expanded entries

### Empty State
- Illustration + "No history yet — start watching or reading to see your activity here"

### Backend: New Tauri Commands

```rust
// Unified paginated timeline (handles "All" tab with UNION query, or filter by media_type)
// Returns WatchHistoryEntry / ReadingHistoryEntry (distinct from ContinueWatchingEntry to include completed items)
// Date grouping ("Today", "Yesterday", etc.) happens in the frontend
get_all_history(page: i32, limit: i32, media_type: Option<String>, search: Option<String>)
    -> Vec<HistoryEntry>
    // HistoryEntry: { type: "watch"|"read", media: MediaEntry, episode_id/chapter_id, episode_number/chapter_number,
    //   progress_seconds/current_page, duration/total_pages, completed, timestamp: String }
    // When media_type is None ("All"), uses UNION of watch_history + reading_history ordered by timestamp DESC
    // When media_type is "anime", queries only watch_history; "manga" queries only reading_history

// Series view - aggregated per anime/manga (paginated)
get_history_grouped_by_media(page: i32, limit: i32, media_type: Option<String>, search: Option<String>)
    -> Vec<MediaHistorySummary>
    // MediaHistorySummary: { media: MediaEntry, type: "anime"|"manga",
    //   items_completed: i32, total_items: Option<i32>, total_time_seconds: f64, last_activity: String }

// Delete individual entries
remove_watch_history_entry(media_id: String, episode_id: String) -> ()
remove_reading_history_entry(media_id: String, chapter_id: String) -> ()

// clear_all_watch_history() already exists
clear_all_reading_history() -> ()
```

### Frontend Components

```
src/components/history/
  HistoryPage.tsx         — main page with view toggle, filters, search
  TimelineView.tsx        — chronological grouped-by-date list
  SeriesView.tsx          — per-anime/manga card grid
  HistoryEntry.tsx        — single timeline entry (cover, progress, actions)
  SeriesCard.tsx          — aggregate series card (expandable)
  HistoryEmptyState.tsx   — empty state component
```

---

## Feature 2: Activity Statistics Page (`/stats`)

### Route & Navigation

- Repurpose existing `/stats` route
- Move current system metrics (CPU/memory/disk from `src/routes/stats.tsx`) into Settings page as a "Developer Tools" collapsible section
- **Desktop**: Added to TopNav alongside History
- **Mobile**: Accessible from Library page (alongside History link) or via Settings
- Component file: `src/routes/stats.tsx` (rewritten) + `src/components/stats/StatsPage.tsx`

### UI Layout

#### Summary Cards (top row)
Four stat cards in a responsive grid:

| Card | Value | Source |
|------|-------|--------|
| Time Watched | "3d 14h 22m" | `SUM(progress_seconds)` from watch_history |
| Episodes Completed | "156" | `COUNT(*) WHERE completed = 1` from watch_history |
| Chapters Read | "342" | `COUNT(*) WHERE completed = 1` from reading_history |
| Series Completed | "8" | `COUNT(*) WHERE status = 'completed'` from `library` table (user-set, reliable even when episode_count is NULL) |

#### Activity Graph (recharts)
- **Area chart** showing daily minutes of activity over a selectable period
- Period toggle: "7 Days" | "30 Days" | "90 Days" | "All Time"
- Two overlaid areas: anime watch time (blue) and manga read time (purple)
- X-axis: dates, Y-axis: minutes
- Hover tooltip: exact minutes per category per day
- **Note**: manga "time" is estimated as `completed_chapters * avg_pages_per_chapter * 2 min/page`. This is an approximation — clearly labeled "(estimated)" in the tooltip. The 2 min/page constant is defined in the Rust backend as `READING_MINUTES_PER_PAGE`.

#### Genre Distribution (CSS horizontal bar chart)
- Top 10 genres ranked by time spent
- Each bar: genre label, colored bar proportional to time, time label
- Parsed from `media.genres` JSON field using SQLite `json_each()` joined with watch/reading time:
  ```sql
  SELECT j.value as genre, SUM(w.progress_seconds) as time_seconds
  FROM watch_history w JOIN media m ON w.media_id = m.id, json_each(m.genres) j
  GROUP BY j.value ORDER BY time_seconds DESC LIMIT 10
  ```
- Toggle: "Anime" | "Manga" | "Combined"

#### Completion Rates (CSS progress rings)
- Two side-by-side ring charts (anime and manga)
- Segments: Completed, Watching/Reading, On Hold, Dropped, Plan to Watch/Read
- Counts inside/below each ring
- Data from unified `library` table joined with `media.media_type` to split anime vs manga:
  ```sql
  SELECT m.media_type, l.status, COUNT(*) FROM library l JOIN media m ON l.media_id = m.id GROUP BY m.media_type, l.status
  ```

#### Top Anime & Manga (ranked lists)
- **Top 5 Most Watched Anime**: cover thumbnail, title, total time, episode count, progress bar
- **Top 5 Most Read Manga**: cover thumbnail, title, chapters read, progress bar
- Ranked by total time (anime) or chapters completed (manga)

#### Streaks & Fun Stats
- **Current streak**: consecutive days with any watch/read activity + flame icon
- **Longest streak**: date range + day count
- **Most active day of week**: "Saturdays — avg 2h 15m" (from day-of-week aggregation)
- **Average daily active span**: mean time between first and last activity per day (labeled as "daily span", not "session" — true session detection would require gap-based heuristics)
- **Binge record**: most episodes/chapters consumed in a single day, with anime/manga title and date

### Backend: New Tauri Commands

```rust
// Summary stats
get_watch_stats_summary() -> WatchStatsSummary
    // { total_time_seconds: f64, episodes_completed: i32, series_completed: i32, total_episodes_started: i32 }

get_reading_stats_summary() -> ReadingStatsSummary
    // { total_chapters_completed: i32, total_pages_read: i32, series_completed: i32, total_chapters_started: i32 }

// Daily activity for chart (returns array of { date: String, watch_minutes: f64, read_minutes: f64 })
get_daily_activity(days: i32) -> Vec<DailyActivity>

// Genre breakdown (returns array of { genre: String, time_seconds: f64, count: i32 })
get_genre_stats(media_type: Option<String>) -> Vec<GenreStat>

// Library status distribution
get_completion_stats() -> CompletionStats
    // { anime: { watching: i32, completed: i32, on_hold: i32, dropped: i32, plan_to_watch: i32 }, manga: { ... } }

// Top content
get_top_watched_anime(limit: i32) -> Vec<TopWatchedEntry>
    // { media: MediaEntry, total_time_seconds: f64, episodes_watched: i32 }

get_top_read_manga(limit: i32) -> Vec<TopReadEntry>
    // { media: MediaEntry, chapters_read: i32 }

// Streaks and fun stats
// All date groupings use system local timezone (chrono::Local) to convert UTC timestamps before aggregation
get_streak_stats() -> StreakStats
    // { current_streak_days: i32, longest_streak_days: i32, longest_streak_start: String, longest_streak_end: String }

get_activity_patterns() -> ActivityPatterns
    // { most_active_day: String, avg_daily_minutes: f64, avg_daily_span_minutes: f64 }

get_binge_stats() -> BingeStats
    // { max_episodes_in_day: i32, max_episodes_anime_title: String, max_episodes_date: String, max_chapters_in_day: i32, max_chapters_manga_title: String, max_chapters_date: String }
```

### Frontend Components

```
src/components/stats/
  StatsPage.tsx            — main page layout
  SummaryCards.tsx          — top row of 4 stat cards
  ActivityChart.tsx         — recharts area chart with period toggle
  GenreDistribution.tsx     — horizontal bar chart (CSS)
  CompletionRings.tsx       — progress ring charts (CSS)
  TopContent.tsx            — ranked lists (anime + manga)
  StreaksAndFun.tsx          — streak counters and fun stats
  StatsEmptyState.tsx        — empty state when no data
```

### Dependency Addition
- `recharts` — used only in `ActivityChart.tsx` for the time-series area chart
- Tree-shakeable: import only `AreaChart`, `Area`, `XAxis`, `YAxis`, `Tooltip`, `ResponsiveContainer`

---

## Migration: System Stats Relocation

The current `/stats` route (`src/routes/stats.tsx`, 443 lines) shows system metrics (CPU, memory, disk, process stats via SSE streaming). This content moves to:

- `src/components/settings/DeveloperSection.tsx` — collapsible section within the Settings page
- The existing Settings page already has a "Developer" section (links to `/stats` and `/logs`). This section will be expanded to embed the system stats inline rather than linking out.
- **SSE lifecycle**: The stream starts only when the Developer section is expanded (not on Settings mount). Collapsing the section stops the stream.
- **Components preserved**: `StatCard` and `MiniChart` sub-components move to `src/components/settings/` alongside `DeveloperSection.tsx`
- The `/stats` route file is fully replaced with the new Activity Statistics page — no redirect needed since the URL stays the same but the content changes
- The existing `/logs` link in Settings remains as-is (separate route)

---

## Shared Patterns

### Per-Section Empty States (Stats)
- **Activity Graph**: "Start watching or reading to see your activity trend" (flat line at 0)
- **Genre Distribution**: "No genre data yet" (hidden if no genres in media table)
- **Completion Rings**: Show all zeros with "Add anime or manga to your library to track progress"
- **Top Content**: "Watch more to see your favorites here"
- **Streaks**: "0 day streak — watch or read something today!" (no flame icon)

---

## Shared Patterns

Both pages follow existing codebase conventions:
- **Image proxy**: `useProxiedImage` hook for cover thumbnails
- **NSFW filtering**: `filterNSFW()` utility applied to all results
- **Mobile responsive**: stacked layouts on mobile, grid on desktop
- **Loading states**: skeleton placeholders while data loads
- **Error handling**: toast notifications on command failures
- **Empty states**: illustration + helpful text when no data exists

---

## Data Flow

```
User visits /history
  → HistoryPage mounts
  → Calls get_all_history(1, 50, media_type=None, search=None)
  → Rust queries watch_history UNION reading_history JOIN media, paginated
  → Returns unified HistoryEntry[] with media metadata
  → Frontend groups entries by date ("Today", "Yesterday", ...)
  → Infinite scroll triggers next page load

User visits /stats
  → StatsPage mounts
  → Parallel calls to all stats commands
  → Rust runs aggregate SQL queries
  → Frontend renders dashboard sections as data arrives
  → Activity chart populated last (heaviest query)
```

---

## Out of Scope

- Real-time reading duration tracking (we estimate from page count)
- Social/sharing features for stats
- Export stats to image/PDF
- Comparison with other users
- MAL/AniList sync of history (separate feature)
