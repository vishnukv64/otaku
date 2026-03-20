# Schedule Page + Smart Notifications — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a weekly anime schedule page with day tabs, library integration, countdown timers, and smart push notifications for tracked anime.

**Architecture:** Frontend schedule page (TanStack route + 3 components) consuming existing `jikanSchedules` backend command, with broadcast data added to `SearchResult` for countdown timers. Schedule notifications via new Rust background task emitting through existing notification infrastructure.

**Tech Stack:** React + TanStack Router, Rust/Tauri backend, Jikan API, SQLite, Zustand notification store

---

## Task 1: Add Broadcast Fields to SearchResult

The existing `jikanSchedules` command maps through `jikan_anime_to_search_result` which drops broadcast data. We need broadcast fields on `SearchResult` for countdown timers.

**Files:**
- Modify: `src-tauri/src/extensions/types.rs:39-74` (Rust struct)
- Modify: `src/types/extension.ts:19-48` (TS interface)
- Modify: `src-tauri/src/jikan/anime.rs:65-87` (mapping function)

**Step 1: Add broadcast fields to Rust SearchResult**

In `src-tauri/src/extensions/types.rs`, add after the `studios` field (line 73):

```rust
    /// Broadcast day (e.g., "Mondays") — from Jikan schedule data
    #[serde(default, alias = "broadcastDay")]
    pub broadcast_day: Option<String>,
    /// Broadcast time in JST (e.g., "01:30") — from Jikan schedule data
    #[serde(default, alias = "broadcastTime")]
    pub broadcast_time: Option<String>,
    /// Broadcast timezone (e.g., "Asia/Tokyo")
    #[serde(default, alias = "broadcastTimezone")]
    pub broadcast_timezone: Option<String>,
```

**Step 2: Add broadcast fields to TS SearchResult**

In `src/types/extension.ts`, add after the `studios` field (line 47):

```typescript
  /** Broadcast day (e.g., "Mondays") — from Jikan schedule data */
  broadcast_day?: string
  /** Broadcast time in JST (e.g., "01:30") — from Jikan schedule data */
  broadcast_time?: string
  /** Broadcast timezone (e.g., "Asia/Tokyo") */
  broadcast_timezone?: string
```

**Step 3: Populate broadcast in jikan_anime_to_search_result**

In `src-tauri/src/jikan/anime.rs`, update the `jikan_anime_to_search_result` function (around line 65). Add after `studios`:

```rust
        broadcast_day: anime.broadcast.as_ref().and_then(|b| b.day.clone()),
        broadcast_time: anime.broadcast.as_ref().and_then(|b| b.time.clone()),
        broadcast_timezone: anime.broadcast.as_ref().and_then(|b| b.timezone.clone()),
```

**Step 4: Verify**

Run: `npx tsc --noEmit` — zero errors expected (new optional fields don't break existing consumers).

**Step 5: Commit**

```bash
git add src-tauri/src/extensions/types.rs src/types/extension.ts src-tauri/src/jikan/anime.rs
git commit -m "feat: add broadcast fields to SearchResult for schedule countdown timers"
```

---

## Task 2: Create Schedule Route

**Files:**
- Create: `src/routes/schedule.tsx`

**Step 1: Create the route file**

Create `src/routes/schedule.tsx` with TanStack file-based routing:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { SchedulePage } from '@/components/schedule/SchedulePage'

export const Route = createFileRoute('/schedule')({
  component: SchedulePage,
})
```

**Step 2: Verify**

Run: `npx tsc --noEmit` — will fail because `SchedulePage` doesn't exist yet. That's expected; we'll create it in Task 3.

**Step 3: Commit**

```bash
git add src/routes/schedule.tsx
git commit -m "feat: add /schedule route"
```

---

## Task 3: Create DayTabs Component

**Files:**
- Create: `src/components/schedule/DayTabs.tsx`

**Step 1: Implement DayTabs**

```tsx
import { useRef, useEffect } from 'react'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export type DayKey = (typeof DAYS)[number]

/** Get today's day key (e.g., "monday") */
export function getTodayKey(): DayKey {
  const jsDay = new Date().getDay() // 0=Sun, 1=Mon...
  // Map: Sun(0)→sunday, Mon(1)→monday, ...
  const mapped = jsDay === 0 ? 6 : jsDay - 1
  return DAYS[mapped]
}

interface DayTabsProps {
  activeDay: DayKey
  onDayChange: (day: DayKey) => void
  counts?: Partial<Record<DayKey, number>>
}

export function DayTabs({ activeDay, onDayChange, counts }: DayTabsProps) {
  const todayKey = getTodayKey()
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  // Scroll active tab into view on mount
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeDay])

  return (
    <div ref={scrollRef} className="flex gap-1 overflow-x-auto scrollbar-hide px-1 py-2">
      {DAYS.map((day, i) => {
        const isActive = day === activeDay
        const isToday = day === todayKey
        const count = counts?.[day]

        return (
          <button
            key={day}
            ref={isActive ? activeRef : undefined}
            onClick={() => onDayChange(day)}
            className={`
              relative flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${isActive
                ? 'bg-[#e50914] text-white'
                : 'bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.6)] hover:bg-[rgba(255,255,255,0.1)] hover:text-white'
              }
            `}
          >
            <span className="flex items-center gap-1.5">
              {DAY_LABELS[i]}
              {isToday && !isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#e50914]" />
              )}
              {count !== undefined && (
                <span className={`text-xs ${isActive ? 'text-white/70' : 'text-[rgba(255,255,255,0.4)]'}`}>
                  {count}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/schedule/DayTabs.tsx
git commit -m "feat: add DayTabs component for schedule page"
```

---

## Task 4: Create ScheduleCard Component

**Files:**
- Create: `src/components/schedule/ScheduleCard.tsx`

**Step 1: Implement ScheduleCard**

This card displays anime info with countdown timer, library status badge, and click-to-detail.

```tsx
import { Star, Tv, Play } from 'lucide-react'
import type { SearchResult } from '@/types/extension'
import { useProxiedImage } from '@/hooks/useProxiedImage'

/** Convert Jikan broadcast day+time (JST) to a local Date for the upcoming occurrence */
export function getNextBroadcastDate(broadcastDay?: string, broadcastTime?: string): Date | null {
  if (!broadcastDay || !broadcastTime) return null

  const dayMap: Record<string, number> = {
    Sundays: 0, Mondays: 1, Tuesdays: 2, Wednesdays: 3,
    Thursdays: 4, Fridays: 5, Saturdays: 6,
  }
  const targetDayUTC = dayMap[broadcastDay]
  if (targetDayUTC === undefined) return null

  // Parse time (e.g., "01:30")
  const [hours, minutes] = broadcastTime.split(':').map(Number)
  if (isNaN(hours) || isNaN(minutes)) return null

  // Build a Date in JST (UTC+9), then find the next occurrence
  const now = new Date()
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const jstTarget = new Date(jstNow)
  jstTarget.setHours(hours, minutes, 0, 0)

  // Set to the correct day of the week
  const currentDay = jstNow.getDay()
  let daysUntil = targetDayUTC - currentDay
  if (daysUntil < 0) daysUntil += 7
  if (daysUntil === 0 && jstTarget <= jstNow) daysUntil = 7
  jstTarget.setDate(jstTarget.getDate() + daysUntil)

  // Convert back from JST to UTC: subtract 9 hours
  const utcMs = jstTarget.getTime() - (9 * 60 * 60 * 1000)
  // Adjust for the local timezone offset difference vs JST
  const jstOffset = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getTime() - now.getTime()
  return new Date(now.getTime() + (jstTarget.getTime() - jstNow.getTime()))
}

/** Format countdown for display */
export function formatCountdown(targetDate: Date | null): { text: string; isPast: boolean; isAiring: boolean } {
  if (!targetDate) return { text: '', isPast: false, isAiring: false }

  const now = Date.now()
  const diff = targetDate.getTime() - now

  // "Airing now" window: 0 to -30 minutes
  if (diff <= 0 && diff > -30 * 60 * 1000) {
    return { text: 'Airing now', isPast: false, isAiring: true }
  }

  if (diff <= 0) {
    const absDiff = Math.abs(diff)
    const hours = Math.floor(absDiff / (1000 * 60 * 60))
    const minutes = Math.floor((absDiff / (1000 * 60)) % 60)
    if (hours > 0) return { text: `Aired ${hours}h ago`, isPast: true, isAiring: false }
    return { text: `Aired ${minutes}m ago`, isPast: true, isAiring: false }
  }

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff / (1000 * 60)) % 60)

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return { text: `Airs in ${days}d ${hours % 24}h`, isPast: false, isAiring: false }
  }
  if (hours > 0) return { text: `Airs in ${hours}h ${minutes}m`, isPast: false, isAiring: false }
  return { text: `Airs in ${minutes}m`, isPast: false, isAiring: false }
}

interface ScheduleCardProps {
  anime: SearchResult
  libraryStatus?: string | null // "watching", "plan_to_watch", etc.
  onClick: () => void
}

export function ScheduleCard({ anime, libraryStatus, onClick }: ScheduleCardProps) {
  const coverSrc = useProxiedImage(anime.cover_url || '')
  const nextBroadcast = getNextBroadcastDate(anime.broadcast_day, anime.broadcast_time)
  const countdown = formatCountdown(nextBroadcast)

  const statusLabels: Record<string, { label: string; color: string }> = {
    watching: { label: 'Watching', color: 'bg-green-600' },
    plan_to_watch: { label: 'Plan to Watch', color: 'bg-blue-600' },
    completed: { label: 'Completed', color: 'bg-purple-600' },
    on_hold: { label: 'On Hold', color: 'bg-yellow-600' },
    dropped: { label: 'Dropped', color: 'bg-red-800' },
  }

  const libBadge = libraryStatus ? statusLabels[libraryStatus] : null

  return (
    <button
      onClick={onClick}
      className="group relative bg-[rgba(255,255,255,0.04)] rounded-xl overflow-hidden border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.15)] transition-all text-left w-full"
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] overflow-hidden">
        <img
          src={coverSrc}
          alt={anime.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
        />
        {/* Library status badge */}
        {libBadge && (
          <div className={`absolute top-2 left-2 ${libBadge.color} px-2 py-0.5 rounded text-[10px] font-semibold text-white`}>
            {libBadge.label}
          </div>
        )}
        {/* Type badge */}
        {anime.media_type && (
          <div className="absolute top-2 right-2 bg-black/70 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/80 flex items-center gap-1">
            <Tv className="w-2.5 h-2.5" />
            {anime.media_type}
          </div>
        )}
        {/* Countdown overlay at bottom of poster */}
        {countdown.text && (
          <div className={`absolute bottom-0 left-0 right-0 px-2 py-1.5 text-xs font-medium
            ${countdown.isAiring
              ? 'bg-[#e50914]/90 text-white animate-pulse'
              : countdown.isPast
                ? 'bg-black/70 text-white/50'
                : 'bg-black/70 text-green-400'
            }`}
          >
            {countdown.isAiring && <Play className="w-3 h-3 inline mr-1 fill-current" />}
            {countdown.text}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 space-y-1">
        <h3 className="text-sm font-medium text-white line-clamp-2 leading-tight">{anime.title}</h3>
        <div className="flex items-center gap-2 text-xs text-[rgba(255,255,255,0.5)]">
          {anime.available_episodes && (
            <span>{anime.available_episodes} EP</span>
          )}
          {anime.rating && (
            <span className="flex items-center gap-0.5 text-amber-400">
              <Star className="w-3 h-3 fill-current" />
              {anime.rating.toFixed(2)}
            </span>
          )}
        </div>
        {anime.studios && anime.studios.length > 0 && (
          <p className="text-[11px] text-[rgba(255,255,255,0.35)] truncate">{anime.studios[0]}</p>
        )}
      </div>
    </button>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/schedule/ScheduleCard.tsx
git commit -m "feat: add ScheduleCard component with countdown timer and library badge"
```

---

## Task 5: Create SchedulePage Component

**Files:**
- Create: `src/components/schedule/SchedulePage.tsx`

**Step 1: Implement the main page**

```tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { Calendar, Filter, Loader2 } from 'lucide-react'
import { jikanSchedules, isInLibrary, getLibraryEntry } from '@/utils/tauri-commands'
import type { SearchResult } from '@/types/extension'
import { DayTabs, getTodayKey, type DayKey } from './DayTabs'
import { ScheduleCard } from './ScheduleCard'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import { useSettingsStore } from '@/store/settingsStore'

type FilterMode = 'all' | 'library' | 'watching'

interface DayData {
  results: SearchResult[]
  hasNextPage: boolean
  page: number
  libraryStatuses: Record<string, string | null>
}

export function SchedulePage() {
  const [activeDay, setActiveDay] = useState<DayKey>(getTodayKey())
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [dayCache, setDayCache] = useState<Partial<Record<DayKey, DayData>>>({})
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedAnime, setSelectedAnime] = useState<SearchResult | null>(null)
  const abortRef = useRef(0)
  const sfwEnabled = useSettingsStore((s) => s.sfw)

  // Fetch schedule data for a day
  const fetchDay = useCallback(async (day: DayKey, page: number = 1) => {
    const token = ++abortRef.current
    if (page === 1) setLoading(true)
    else setLoadingMore(true)

    try {
      const data = await jikanSchedules(day, page, sfwEnabled)
      if (token !== abortRef.current) return // stale

      let results = data.results
      if (sfwEnabled) {
        results = filterNsfwContent(results) as SearchResult[]
      }

      // Batch check library status for all results
      const statuses: Record<string, string | null> = {}
      await Promise.all(
        results.map(async (anime) => {
          try {
            const entry = await getLibraryEntry(anime.id)
            statuses[anime.id] = entry?.status ?? null
          } catch {
            statuses[anime.id] = null
          }
        })
      )

      if (token !== abortRef.current) return // stale

      setDayCache((prev) => {
        const existing = prev[day]
        if (page === 1) {
          return { ...prev, [day]: { results, hasNextPage: data.has_next_page, page, libraryStatuses: statuses } }
        }
        // Append for pagination
        return {
          ...prev,
          [day]: {
            results: [...(existing?.results ?? []), ...results],
            hasNextPage: data.has_next_page,
            page,
            libraryStatuses: { ...(existing?.libraryStatuses ?? {}), ...statuses },
          },
        }
      })
    } catch (err) {
      console.error(`Failed to fetch schedule for ${day}:`, err)
    } finally {
      if (token === abortRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [sfwEnabled])

  // Fetch on day change (use cache if available)
  useEffect(() => {
    if (!dayCache[activeDay]) {
      fetchDay(activeDay)
    }
  }, [activeDay, fetchDay])

  const dayData = dayCache[activeDay]

  // Apply filter
  const filteredResults = (dayData?.results ?? []).filter((anime) => {
    if (filterMode === 'all') return true
    const status = dayData?.libraryStatuses[anime.id]
    if (filterMode === 'library') return status !== null
    if (filterMode === 'watching') return status === 'watching'
    return true
  })

  const handleLoadMore = () => {
    if (dayData?.hasNextPage) {
      fetchDay(activeDay, (dayData.page ?? 1) + 1)
    }
  }

  // Day counts for tab badges (only cached days)
  const dayCounts: Partial<Record<DayKey, number>> = {}
  for (const [day, data] of Object.entries(dayCache)) {
    dayCounts[day as DayKey] = data.results.length
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0a0a0a]/95 backdrop-blur-sm border-b border-[rgba(255,255,255,0.06)]">
        <div className="max-w-7xl mx-auto px-4 pt-4 pb-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#e50914]" />
              <h1 className="text-xl font-bold text-white">Schedule</h1>
            </div>
            {/* Filter dropdown */}
            <div className="relative">
              <select
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value as FilterMode)}
                className="appearance-none bg-[rgba(255,255,255,0.06)] text-white text-sm pl-3 pr-8 py-1.5 rounded-lg border border-[rgba(255,255,255,0.1)] cursor-pointer focus:outline-none focus:border-[#e50914]"
              >
                <option value="all">All Anime</option>
                <option value="library">My Library</option>
                <option value="watching">Watching Only</option>
              </select>
              <Filter className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[rgba(255,255,255,0.4)] pointer-events-none" />
            </div>
          </div>
          <DayTabs activeDay={activeDay} onDayChange={setActiveDay} counts={dayCounts} />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 pt-4">
        {loading ? (
          // Skeleton loading
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[2/3] rounded-xl bg-[rgba(255,255,255,0.06)]" />
                <div className="mt-2 h-3 rounded bg-[rgba(255,255,255,0.06)] w-3/4" />
                <div className="mt-1 h-2.5 rounded bg-[rgba(255,255,255,0.04)] w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredResults.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Calendar className="w-12 h-12 text-[rgba(255,255,255,0.15)] mb-4" />
            <p className="text-[rgba(255,255,255,0.5)] text-sm">
              {filterMode === 'all'
                ? `No anime scheduled for ${activeDay.charAt(0).toUpperCase() + activeDay.slice(1)}`
                : filterMode === 'library'
                  ? `None of your library anime air on ${activeDay.charAt(0).toUpperCase() + activeDay.slice(1)}`
                  : `No anime you're watching airs on ${activeDay.charAt(0).toUpperCase() + activeDay.slice(1)}`
              }
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {filteredResults.map((anime) => (
                <ScheduleCard
                  key={anime.id}
                  anime={anime}
                  libraryStatus={dayData?.libraryStatuses[anime.id]}
                  onClick={() => setSelectedAnime(anime)}
                />
              ))}
            </div>
            {/* Load More */}
            {dayData?.hasNextPage && filterMode === 'all' && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-6 py-2 rounded-lg bg-[rgba(255,255,255,0.06)] text-white/70 text-sm hover:bg-[rgba(255,255,255,0.1)] transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : (
                    'Load More'
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail Modal */}
      {selectedAnime && (
        <MediaDetailModal
          anime={selectedAnime}
          isOpen={true}
          onClose={() => setSelectedAnime(null)}
        />
      )}
    </div>
  )
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit` — should pass (all imports exist).

**Step 3: Commit**

```bash
git add src/components/schedule/SchedulePage.tsx
git commit -m "feat: add SchedulePage with day tabs, filter, grid, and detail modal"
```

---

## Task 6: Add Schedule to TopNav

**Files:**
- Modify: `src/components/layout/TopNav.tsx:13-18`

**Step 1: Add Schedule nav item**

In `src/components/layout/TopNav.tsx`, update the `navItems` array. Insert Schedule between Manga and Library:

```typescript
const navItems = [
  { name: 'Home', path: '/' },
  { name: 'Anime', path: '/anime' },
  { name: 'Manga', path: '/manga' },
  { name: 'Schedule', path: '/schedule' },
  { name: 'Library', path: '/library' },
]
```

**Step 2: Verify**

Run: `npx tsc --noEmit` — zero errors.

**Step 3: Commit**

```bash
git add src/components/layout/TopNav.tsx
git commit -m "feat: add Schedule to top navigation"
```

---

## Task 7: Add Schedule Notification Backend

Add a `check_daily_schedule` command that cross-references today's Jikan schedule with the user's library and emits "airing today" notifications.

**Files:**
- Create: `src-tauri/src/jikan/schedule.rs`
- Modify: `src-tauri/src/jikan/mod.rs` (add `pub mod schedule;`)
- Modify: `src-tauri/src/jikan/commands.rs` (add new command)
- Modify: `src-tauri/src/lib.rs` (register command)

**Step 1: Create schedule.rs**

```rust
use super::anime;
use super::types::JikanAnime;
use crate::notifications::{emit_notification, NotificationAction, NotificationPayload, NotificationType};
use chrono::Local;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::AppHandle;

/// Check today's schedule against user library and emit notifications
pub async fn check_daily_schedule_inner(app: &AppHandle, pool: &SqlitePool) -> Result<(), String> {
    // 1. Check if we already notified today
    let today = Local::now().format("%Y-%m-%d").to_string();
    let last_check: Option<String> = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key = 'last_schedule_notify_date'"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    if last_check.as_ref() == Some(&today) {
        return Ok(()); // Already notified today
    }

    // 2. Determine today's day name for Jikan filter
    let day_name = Local::now().format("%A").to_string().to_lowercase();

    // 3. Fetch today's schedule (page 1 only for notifications)
    let schedule = anime::schedules(Some(&day_name), 1, true)
        .map_err(|e| format!("Schedule fetch error: {}", e))?;

    // 4. Cross-reference with library
    let mut matches = Vec::new();
    for result in &schedule.results {
        let in_lib: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM library WHERE media_id = ? AND status IN ('watching', 'plan_to_watch')"
        )
        .bind(&result.id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?;

        if in_lib {
            matches.push(result.clone());
        }
    }

    if matches.is_empty() {
        // Still mark as checked to avoid re-fetching
        sqlx::query(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_schedule_notify_date', ?)"
        )
        .bind(&today)
        .execute(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?;
        return Ok(());
    }

    // 5. Emit notification(s)
    if matches.len() == 1 {
        let anime = &matches[0];
        let time_str = anime.broadcast_time.as_deref().unwrap_or("today");
        let notification = NotificationPayload::new(
            NotificationType::Info,
            format!("{} airs today", anime.title),
            format!("Airs at {} (JST)", time_str),
            Some("schedule".to_string()),
            Some(NotificationAction {
                label: "View Schedule".to_string(),
                route: Some("/schedule".to_string()),
                callback: None,
            }),
            None,
        );
        emit_notification(app, pool, notification).await
            .map_err(|e| format!("Notification error: {}", e))?;
    } else {
        let notification = NotificationPayload::new(
            NotificationType::Info,
            format!("{} anime from your library air today", matches.len()),
            matches.iter().take(3).map(|a| a.title.as_str()).collect::<Vec<_>>().join(", "),
            Some("schedule".to_string()),
            Some(NotificationAction {
                label: "View Schedule".to_string(),
                route: Some("/schedule".to_string()),
                callback: None,
            }),
            None,
        );
        emit_notification(app, pool, notification).await
            .map_err(|e| format!("Notification error: {}", e))?;
    }

    // 6. Mark today as checked
    sqlx::query(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_schedule_notify_date', ?)"
    )
    .bind(&today)
    .execute(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}
```

**Step 2: Add `pub mod schedule;` to `src-tauri/src/jikan/mod.rs`**

Add after existing module declarations:
```rust
pub mod schedule;
```

**Step 3: Add command to `src-tauri/src/jikan/commands.rs`**

Add a new Tauri command at the end of the file:

```rust
#[tauri::command]
pub async fn check_daily_schedule(app: AppHandle, state: tauri::State<'_, crate::commands::AppState>) -> Result<(), String> {
    let pool = state.db.clone();
    super::schedule::check_daily_schedule_inner(&app, &pool).await
}
```

Note: You'll need `use tauri::AppHandle;` at the top of commands.rs if not already imported.

**Step 4: Register in lib.rs**

Add `jikan::commands::check_daily_schedule` to the `invoke_handler` registration list (near line 494).

**Step 5: Add `app_settings` table creation**

In the database initialization code (wherever tables are created), ensure:
```sql
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
)
```

Check if this table already exists — if a similar key-value store is used, reuse it.

**Step 6: Verify**

Run: `cargo check` from `src-tauri/` — zero errors.

**Step 7: Commit**

```bash
git add src-tauri/src/jikan/schedule.rs src-tauri/src/jikan/mod.rs src-tauri/src/jikan/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add check_daily_schedule backend for airing-today notifications"
```

---

## Task 8: Wire Schedule Check on App Startup

**Files:**
- Modify: `src-tauri/src/lib.rs` (or wherever app startup tasks are initiated)

**Step 1: Add startup schedule check**

Find where the release checker or other background tasks are spawned on app startup. Add a schedule check alongside:

```rust
// After app setup, spawn a one-shot schedule check
let app_handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    // Small delay to let app fully initialize
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    if let Some(state) = app_handle.try_state::<crate::commands::AppState>() {
        let _ = jikan::schedule::check_daily_schedule_inner(&app_handle, &state.db).await;
    }
});
```

**Step 2: Add frontend Tauri command wrapper**

In `src/utils/tauri-commands.ts`, add:

```typescript
/** Trigger daily schedule notification check */
export async function checkDailySchedule(): Promise<void> {
  return await invoke('check_daily_schedule')
}
```

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs src/utils/tauri-commands.ts
git commit -m "feat: trigger schedule notification check on app startup"
```

---

## Task 9: Add Schedule Tab to NotificationCenter

**Files:**
- Modify: `src/components/notifications/NotificationCenter.tsx`
- Modify: `src/components/notifications/NotificationItem.tsx` (optional — schedule icon)

**Step 1: Update TabType and tabs array**

In `NotificationCenter.tsx`, update the `TabType` (line 68):

```typescript
type TabType = 'all' | 'episode' | 'chapter' | 'schedule' | 'download' | 'system'
```

Update the `tabs` array (around line 262):

```typescript
const tabs: { key: TabType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'episode', label: 'Episodes' },
  { key: 'chapter', label: 'Chapters' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'download', label: 'Downloads' },
  { key: 'system', label: 'System' },
]
```

**Step 2: Update getNotifCategory**

In `NotificationCenter.tsx`, update `getNotifCategory` (line 39) to handle schedule source:

```typescript
export function getNotifCategory(n: Notification): 'episode' | 'chapter' | 'schedule' | 'download' | 'system' {
  // Check source first
  if (n.source === 'schedule') return 'schedule'
  if (n.source === 'release') {
    const lower = (n.title + ' ' + n.message).toLowerCase()
    if (lower.includes('ch.') || lower.includes('chapter') || lower.includes('manga')) return 'chapter'
    return 'episode'
  }
  if (n.source === 'download') return 'download'

  // Fallback: infer from title/message
  const lower = (n.title + ' ' + n.message).toLowerCase()
  if (lower.includes('schedule') || lower.includes('airs today')) return 'schedule'
  if (lower.includes('download')) return 'download'
  if (lower.includes('episode') || lower.includes('ep ')) return 'episode'
  if (lower.includes('chapter') || lower.includes('ch.')) return 'chapter'

  return 'system'
}
```

**Step 3: Update tab filtering logic**

The existing filtering logic uses `getNotifCategory(n) === activeTab`. Since we updated the function's return type to include `'schedule'`, the tab filtering should work automatically.

**Step 4: Verify**

Run: `npx tsc --noEmit` — zero errors.

**Step 5: Commit**

```bash
git add src/components/notifications/NotificationCenter.tsx
git commit -m "feat: add Schedule tab to NotificationCenter"
```

---

## Task 10: Final Verification & Polish

**Step 1: Full TypeScript check**

Run: `npx tsc --noEmit` — zero errors.

**Step 2: Cargo check**

Run: `cd src-tauri && cargo check` — zero errors.

**Step 3: Manual testing checklist**

1. Navigate to `/schedule` — today's tab auto-selected, anime grid loads
2. Click different day tabs — grid updates with that day's anime
3. Switch filter to "My Library" — only library anime shown
4. Switch to "Watching Only" — further filtered
5. Click any card — `MediaDetailModal` opens
6. Countdown timers show "Airs in Xh Xm" for upcoming shows
7. Shows that already aired show "Aired Xh ago"
8. TopNav shows Schedule link between Manga and Library
9. NotificationCenter has Schedule tab
10. Day tabs scroll horizontally on mobile
11. Cards are responsive: 2-col on mobile, 6-col on desktop

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete schedule page with day tabs, countdown timers, and smart notifications"
```
