# Schedule Page + Smart Notifications — Design Document

**Date**: 2026-03-07
**Status**: Approved

---

## Overview

Add a full Schedule page showing weekly anime airing times with day-based tabs, library integration, countdown timers, and smart push notifications for tracked anime. Manga notifications enhanced via existing release checker.

---

## Part 1: Schedule Page

### Route & Navigation
- **Route**: `/schedule`
- **Nav placement**: New top-nav item between Manga and Library
- **Icon**: Calendar icon (from lucide-react)

### Layout

```
┌─────────────────────────────────────────────────────┐
│  📅 Schedule                    Filter: [dropdown] ▼│
├─────────────────────────────────────────────────────┤
│ [MON] [TUE] [WED●] [THU] [FRI] [SAT] [SUN]        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  [poster]    │  │  [poster]    │  │  [poster]  │ │
│  │  Title       │  │  Title       │  │  Title     │ │
│  │  EP 24 · TV  │  │  EP 45 · TV  │  │  EP 12     │ │
│  │  ★ 8.73      │  │  ★ 8.51      │  │  ★ 8.25   │ │
│  │  Airs in 3h  │  │  📺 Watching │  │            │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│  ...more cards                                      │
└─────────────────────────────────────────────────────┘
```

### Day Tabs
- Horizontal scrollable tabs: Mon, Tue, Wed, Thu, Fri, Sat, Sun
- Today auto-selected on page load, highlighted with dot indicator
- Each tab shows anime count badge
- Switching tabs fetches from Jikan `/schedules?filter={day}&sfw=true`

### Filter Dropdown
Three filter modes:
- **All Anime** — show everything from the schedule (default)
- **My Library** — only show anime that are in user's library (any status)
- **Watching Only** — only show anime with `watching` status

### Schedule Card
Each card displays:
- Cover image (poster, from Jikan images)
- Title (English preferred, fallback romaji)
- Episode count chip (e.g., "24 EP")
- Score chip (gold star + number)
- Type badge (TV, ONA, OVA, etc.)
- Broadcast time in user's local timezone (converted from JST)
- **Countdown timer**: Reuse `NextEpisodeCountdown` component
  - Derive from `broadcast.day` + `broadcast.time` → next air timestamp
  - `broadcastInterval` = 7 days (weekly shows)
  - States: "Airs in 5h 23m" → "Airing now" (pulse) → "Aired 2h ago"
- Library status badge: green "Watching" / blue "Plan to Watch" / no badge if not in library
- Studio name (muted, small text)

### Card Interaction
- Click → opens `MediaDetailModal` (pass MAL ID as SearchResult)
- Consistent with anime browse page behavior

### Data Flow
```
User opens /schedule
  → auto-selects today's tab
  → calls jikan_schedules(day, sfw=true, page=1)
  → returns Vec<SearchResult> (reuse existing type)
  → frontend cross-references with library (batch isInLibrary check)
  → renders grid with status badges + countdown timers
  → cache results per-day in component state (avoid re-fetch on tab switch)
```

### Empty States
- No anime: "No anime scheduled for {day}" with calendar illustration
- Library filter, no matches: "None of your library anime air on {day}"
- Loading: Skeleton grid matching card layout

### Pagination
- Load more button at bottom (Jikan paginated response)
- Or infinite scroll if card count is manageable (~25 per page)

---

## Part 2: Smart Notifications

### New Notification Source: `"schedule"`
Added alongside existing sources (download, library, system).

### Trigger 1: "Airing Today" Morning Reminder

**When**: On app launch + every 6 hours via background task.

**Logic**:
1. Fetch today's schedule from Jikan (`/schedules?filter={today}`)
2. Cross-reference with user's library entries (status = watching, plan_to_watch)
3. For each match, check if we already sent an "airing today" notification (dedup via `last_schedule_check` timestamp stored in DB)
4. Emit notifications

**Content**:
- Single anime: "One Piece airs today at 10:00 AM"
- Multiple (3+): "3 anime from your library air today" with action → `/schedule`

**Action buttons**: "View Details" → opens detail modal, "View Schedule" → `/schedule`

### Trigger 2: "New Episode Available" (existing, enhanced)

**Already exists** via `release_checker.rs` detection.

**Enhancement**:
- Include richer context in notification message: "Bleach EP 45 is now available"
- Action button: "Watch Now" navigates to `/watch?malId={id}&episodeId={epId}`
- Works for both anime AND manga (manga = "Chapter X is now available")

### NotificationCenter Updates
- Add "Schedule" filter tab in the existing tab bar (alongside All/Episodes/Chapters/Downloads/System)
- Schedule notifications styled with calendar icon
- Action buttons route to detail modal or schedule page

### Background Task: `check_daily_schedule()`
- New Rust command running on app startup + 6-hour interval
- Fetches today's Jikan schedule
- Queries library for matches
- Emits Tauri events for matched anime
- Stores `last_schedule_notify_date` to prevent duplicate daily notifications
- Respects SFW filter setting from user preferences

---

## Part 3: Backend Changes

### New Jikan Commands (Rust)

```rust
// Fetch schedule for a specific day
pub fn jikan_schedules(day: &str, sfw: bool, page: i32) -> Result<SearchResults, String>

// Fetch today's schedule and cross-reference with library
pub fn check_daily_schedule() -> Result<Vec<ScheduleNotification>, String>
```

### New Types

```rust
pub struct ScheduleNotification {
    pub media_id: String,
    pub title: String,
    pub episode_info: Option<String>,
    pub broadcast_time: Option<String>,  // Local time string
    pub library_status: Option<String>,
}
```

### Jikan Schedule Response Mapping
Map Jikan schedule anime objects to existing `SearchResult` type:
- `mal_id` → `id`
- `title` / `title_english` → `title`
- `images.jpg.large_image_url` → `cover_url`
- `score` → `rating`
- `episodes` → `available_episodes`
- `status` → `status`
- `type` → `media_type`
- `broadcast.time` / `broadcast.day` → used for countdown calculation
- `studios[0].name` → `studios`

### Database
- Add `last_schedule_notify_date TEXT` column to a settings/metadata table (simple date string dedup)
- No new tables needed — reuse existing `notifications` table

---

## Part 4: Frontend Components

### New Files
- `src/routes/schedule.tsx` — route component
- `src/components/schedule/SchedulePage.tsx` — main page component
- `src/components/schedule/ScheduleCard.tsx` — individual anime card
- `src/components/schedule/DayTabs.tsx` — day tab bar

### Modified Files
- `src/components/layout/TopNav.tsx` — add Schedule nav link
- `src/components/notifications/NotificationCenter.tsx` — add Schedule tab
- `src/components/notifications/NotificationItem.tsx` — handle schedule notification rendering
- `src-tauri/src/jikan/commands.rs` — new schedule commands
- `src-tauri/src/jikan/manga.rs` or new `schedule.rs` — schedule logic
- `src-tauri/src/notifications.rs` — schedule notification emission

### Reused Components
- `MediaDetailModal` — opened on card click
- `NextEpisodeCountdown` — countdown timer on each card
- `DetailTabBar`-style tabs for day selection (or a new lighter variant)
- Existing notification infrastructure (store, events, UI)

---

## Implementation Order

1. **Backend**: Jikan schedule command + types + response mapping
2. **Schedule page**: Route, DayTabs, ScheduleCard, grid layout, filter dropdown
3. **Library integration**: Cross-reference schedule with library, status badges
4. **Countdown integration**: Wire NextEpisodeCountdown into schedule cards
5. **Navigation**: Add to TopNav
6. **Schedule notifications**: Background check task + "airing today" notifications
7. **NotificationCenter update**: Add Schedule tab + action buttons

---

## Verification

1. `npx tsc --noEmit` — zero errors
2. **Schedule page**: Navigate to `/schedule` → see today's tab selected → anime grid loads → click card → detail modal opens
3. **Day switching**: Click different day tabs → grid updates → counts match
4. **Filter**: Switch to "My Library" → only library anime shown → switch to "All" → full schedule
5. **Countdown**: Cards show "Airs in Xh Xm" updating live → "Aired Xh ago" for past shows
6. **Notifications**: Launch app → if library anime airs today, notification appears → click action → navigates correctly
7. **Mobile**: Day tabs scroll horizontally → cards responsive 2-col on mobile
