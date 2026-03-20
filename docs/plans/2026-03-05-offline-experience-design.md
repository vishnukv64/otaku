# Offline Experience Design

**Date:** 2026-03-05
**Status:** Approved

## Problem

When the user has no internet connection, the app shows broken/loading states on pages that require API calls (Home, Anime, Manga). There is no guidance toward downloaded content that is available offline.

## Solution

A root-level offline guard that detects network loss and replaces internet-dependent pages with a rich Offline Hub showcasing downloaded anime and manga.

## Architecture

### useNetworkStatus Hook

Location: `src/hooks/useNetworkStatus.ts`

Centralized online/offline detection:
- Uses `navigator.onLine` for initial state
- Listens to `online`/`offline` window events
- Returns `{ isOnline: boolean, wasOffline: boolean }`
- `wasOffline` enables "Back online!" toast on reconnection

### OfflineGuard Component

Location: `src/components/layout/OfflineGuard.tsx`

Wraps `<Outlet />` in `__root.tsx`:
- When `isOnline === false` AND current route requires internet, renders `OfflineHub`
- When online or on offline-safe route, renders children normally

**Offline-safe routes** (always render normally):
- `/library`
- `/settings`
- `/downloads`
- `/watch` (plays local files)
- `/read` (reads local files)
- `/logs`
- `/notifications`
- `/stats`

**Internet-required routes** (replaced by OfflineHub):
- `/` (Home)
- `/anime`
- `/manga`

### OfflineHub Component

Location: `src/components/offline/OfflineHub.tsx`

Full-page view with:

1. **Hero section**: `WifiOff` icon composition, "You're Offline" heading, warm subtitle
2. **Downloaded Anime grid**: Cover cards from `getDownloadsWithMedia()`, showing title + episode count. Click navigates to `/watch`
3. **Downloaded Manga grid**: Cover cards from Rust backend's `get_all_downloaded_manga()`, showing title + chapter count. Click navigates to `/read`
4. **Empty state**: Friendly message if no downloads exist, with tips about downloading
5. **Quick links**: Settings, Library (work offline)

### Data Sources

- Anime downloads: `getDownloadsWithMedia()` returns `DownloadWithMedia[]` with `media_id`, `title`, `cover_url`, `episode_count`, `total_size`
- Manga downloads: Need to expose `get_all_downloaded_manga()` to frontend (or use `listAllChapterDownloads()` grouped by media)
- Cover images: Stored in `media` table `cover_url`. Use gradient placeholder fallback if image unavailable offline.

### Integration Point

In `src/routes/__root.tsx`, the `RootComponent` currently renders:
```tsx
<AppShell>
  <Outlet />
</AppShell>
```

Changed to:
```tsx
<AppShell>
  <OfflineGuard>
    <Outlet />
  </OfflineGuard>
</AppShell>
```

### Transitions

- Offline detection: Smooth fade-in of OfflineHub
- Back online: Toast "You're back online!" + fade-out, page content reloads
- CSS transitions via opacity/transform

### Mobile

- BottomTabBar stays visible and functional
- OfflineHub uses 2-column card grid
- Respects safe area padding
- Tapping Library/Settings in tab bar navigates normally (offline-safe)

## Files to Create/Modify

**New files:**
- `src/hooks/useNetworkStatus.ts`
- `src/components/offline/OfflineHub.tsx`
- `src/components/layout/OfflineGuard.tsx`

**Modified files:**
- `src/routes/__root.tsx` — wrap Outlet with OfflineGuard
- Possibly `src/utils/tauri-commands.ts` — expose `get_all_downloaded_manga` if not already available

## Non-Goals

- Caching online content for offline viewing (beyond what's already cached)
- Offline search
- Service worker / PWA-style caching
