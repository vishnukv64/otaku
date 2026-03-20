# Offline Experience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When the app has no internet, replace internet-dependent pages with a rich Offline Hub showcasing downloaded anime and manga, guiding users to their offline content.

**Architecture:** A `useNetworkStatus` hook detects online/offline state. An `OfflineGuard` component wraps `<Outlet />` in the root route and conditionally renders an `OfflineHub` page (with downloaded anime/manga grids) when offline on internet-dependent routes. Routes like Library, Settings, Downloads, Watch, and Read continue working normally.

**Tech Stack:** React, TanStack Router, Zustand, Tailwind CSS, Lucide icons, Tauri IPC commands

---

### Task 1: Create useNetworkStatus Hook

**Files:**
- Create: `src/hooks/useNetworkStatus.ts`

**Step 1: Create the hook file**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'

interface NetworkStatus {
  isOnline: boolean
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const wasOfflineRef = useRef(false)

  const handleOnline = useCallback(() => {
    setIsOnline(true)
    if (wasOfflineRef.current) {
      toast.success("You're back online!", { duration: 3000 })
      wasOfflineRef.current = false
    }
  }, [])

  const handleOffline = useCallback(() => {
    setIsOnline(false)
    wasOfflineRef.current = true
  }, [])

  useEffect(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [handleOnline, handleOffline])

  return { isOnline }
}
```

**Step 2: Verify no lint errors**

Run: `cd /Users/vishnukv/facets/codebases/otaku && npx tsc --noEmit --pretty 2>&1 | grep useNetworkStatus || echo "No errors"`
Expected: No errors

**Step 3: Commit**

```bash
git add src/hooks/useNetworkStatus.ts
git commit -m "feat: add useNetworkStatus hook for offline detection"
```

---

### Task 2: Create OfflineHub Component

**Files:**
- Create: `src/components/offline/OfflineHub.tsx`

**Context:**
- Anime downloads API: `getDownloadsWithMedia()` returns `DownloadWithMedia[]` with `{ media_id, title, cover_url?, episode_count, total_size }`
- Manga downloads API: `getDownloadedMangaWithMedia()` returns `DownloadedMangaWithMedia[]` with `{ media_id, title, cover_url?, chapter_count, total_images, total_size }`
- Watch route params: `/watch?malId={media_id}&episodeId={episodeNumber}`
- Read route params: `/read?extensionId={extId}&mangaId={mangaId}&malId={malId}`
- The app uses CSS variables: `--color-bg-primary` (#141414), `--color-bg-secondary` (#1a1a1a), `--color-bg-hover` (#2a2a2a), `--color-accent-primary` (#e50914), `--color-text-primary` (#fff), `--color-text-secondary` (#b3b3b3), `--color-text-muted` (#808080)
- The app uses Lucide icons. Relevant ones: `WifiOff`, `Download`, `Tv`, `BookOpen`, `Library`, `Settings`, `Play`, `BookMarked`
- Cover images may not load offline. Use a gradient placeholder fallback.
- Mobile: 2-column grid. Desktop: 4-column grid.
- Use `useNavigate` from `@tanstack/react-router` for navigation.
- The `isMobile()` utility exists at `@/utils/platform`.

**Step 1: Create the OfflineHub component**

```tsx
import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { WifiOff, Tv, BookOpen, Download, Library, Settings, Play, BookMarked } from 'lucide-react'
import { getDownloadsWithMedia, getDownloadedMangaWithMedia } from '@/utils/tauri-commands'
import type { DownloadWithMedia, DownloadedMangaWithMedia } from '@/utils/tauri-commands'
import { isMobile } from '@/utils/platform'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function CoverImage({ src, title }: { src?: string; title: string }) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-[var(--color-bg-hover)] to-[var(--color-bg-secondary)] flex items-center justify-center">
        <span className="text-2xl font-bold text-[var(--color-text-muted)] opacity-50">
          {title.charAt(0).toUpperCase()}
        </span>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={title}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  )
}

export function OfflineHub() {
  const navigate = useNavigate()
  const mobile = isMobile()
  const [animeDownloads, setAnimeDownloads] = useState<DownloadWithMedia[]>([])
  const [mangaDownloads, setMangaDownloads] = useState<DownloadedMangaWithMedia[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadDownloads() {
      try {
        const [anime, manga] = await Promise.all([
          getDownloadsWithMedia().catch(() => []),
          getDownloadedMangaWithMedia().catch(() => []),
        ])
        setAnimeDownloads(anime)
        setMangaDownloads(manga)
      } finally {
        setLoading(false)
      }
    }
    loadDownloads()
  }, [])

  const hasContent = animeDownloads.length > 0 || mangaDownloads.length > 0

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col">
      {/* Hero Section */}
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="relative mb-6">
          <div className="w-20 h-20 rounded-full bg-[var(--color-accent-primary)]/10 flex items-center justify-center">
            <WifiOff className="w-10 h-10 text-[var(--color-accent-primary)]" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
          You're Offline
        </h1>
        <p className="text-[var(--color-text-secondary)] text-center max-w-md">
          {hasContent
            ? "No worries — your downloads are ready to enjoy"
            : "Download episodes and chapters when you're online to enjoy them offline"}
        </p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[var(--color-accent-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : hasContent ? (
        <div className="flex-1 px-4 pb-8 space-y-8">
          {/* Downloaded Anime Section */}
          {animeDownloads.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Tv size={18} className="text-[var(--color-accent-primary)]" />
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  Downloaded Anime
                </h2>
                <span className="text-sm text-[var(--color-text-muted)]">
                  ({animeDownloads.length})
                </span>
              </div>
              <div className={`grid gap-3 ${mobile ? 'grid-cols-2' : 'grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}`}>
                {animeDownloads.map((anime) => (
                  <button
                    key={anime.media_id}
                    onClick={() => navigate({ to: '/watch', search: { malId: anime.media_id } })}
                    className="group text-left rounded-lg overflow-hidden bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-all hover:scale-[1.02] hover:shadow-lg"
                  >
                    <div className="aspect-[2/3] relative overflow-hidden">
                      <CoverImage src={anime.cover_url} title={anime.title} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        <div className="flex items-center gap-1 text-xs text-white/80 mb-1">
                          <Play size={10} className="fill-current" />
                          <span>{anime.episode_count} episode{anime.episode_count !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                      {/* Play overlay on hover */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                        <div className="w-12 h-12 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center">
                          <Play size={20} className="fill-white text-white ml-0.5" />
                        </div>
                      </div>
                    </div>
                    <div className="p-2.5">
                      <h3 className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-2 leading-tight">
                        {anime.title}
                      </h3>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        {formatBytes(anime.total_size)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Downloaded Manga Section */}
          {mangaDownloads.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <BookOpen size={18} className="text-[var(--color-accent-primary)]" />
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  Downloaded Manga
                </h2>
                <span className="text-sm text-[var(--color-text-muted)]">
                  ({mangaDownloads.length})
                </span>
              </div>
              <div className={`grid gap-3 ${mobile ? 'grid-cols-2' : 'grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}`}>
                {mangaDownloads.map((manga) => (
                  <button
                    key={manga.media_id}
                    onClick={() => navigate({ to: '/downloads' })}
                    className="group text-left rounded-lg overflow-hidden bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-all hover:scale-[1.02] hover:shadow-lg"
                  >
                    <div className="aspect-[2/3] relative overflow-hidden">
                      <CoverImage src={manga.cover_url} title={manga.title} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        <div className="flex items-center gap-1 text-xs text-white/80 mb-1">
                          <BookMarked size={10} />
                          <span>{manga.chapter_count} chapter{manga.chapter_count !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                      {/* Read overlay on hover */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                        <div className="w-12 h-12 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center">
                          <BookOpen size={20} className="text-white" />
                        </div>
                      </div>
                    </div>
                    <div className="p-2.5">
                      <h3 className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-2 leading-tight">
                        {manga.title}
                      </h3>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        {formatBytes(manga.total_size)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        /* Empty state - no downloads at all */
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
          <div className="w-16 h-16 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center mb-4">
            <Download size={24} className="text-[var(--color-text-muted)]" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
            Nothing Downloaded Yet
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] text-center max-w-sm mb-6">
            When you're online, tap the download button on any episode or chapter to save it for offline viewing.
          </p>
          <div className="flex items-center gap-3">
            <Link
              to="/library"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] text-sm transition-colors"
            >
              <Library size={16} />
              Library
            </Link>
            <Link
              to="/settings"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] text-sm transition-colors"
            >
              <Settings size={16} />
              Settings
            </Link>
          </div>
        </div>
      )}

      {/* Quick access footer when content exists */}
      {hasContent && !loading && (
        <div className="px-4 pb-6">
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/downloads"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-sm transition-colors"
            >
              <Download size={14} />
              Manage Downloads
            </Link>
            <Link
              to="/library"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-sm transition-colors"
            >
              <Library size={14} />
              Library
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Verify no lint errors**

Run: `cd /Users/vishnukv/facets/codebases/otaku && npx tsc --noEmit --pretty 2>&1 | grep -E 'OfflineHub|error' | head -10 || echo "No errors"`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/offline/OfflineHub.tsx
git commit -m "feat: add OfflineHub component with downloaded anime/manga grids"
```

---

### Task 3: Create OfflineGuard Component

**Files:**
- Create: `src/components/layout/OfflineGuard.tsx`

**Context:**
- This component wraps `<Outlet />` in the root route
- Uses `useNetworkStatus` from Task 1
- Uses `useRouterState` from `@tanstack/react-router` to get current path
- When offline AND on an internet-required route, renders `OfflineHub` instead of children
- Offline-safe routes: `/library`, `/settings`, `/downloads`, `/watch`, `/read`, `/logs`, `/notifications`, `/stats`
- Internet-required routes: `/` (Home), `/anime`, `/manga` — anything not in the safe list

**Step 1: Create the OfflineGuard component**

```tsx
import { type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { OfflineHub } from '@/components/offline/OfflineHub'

// Routes that work without internet (local data only)
const OFFLINE_SAFE_ROUTES = [
  '/library',
  '/settings',
  '/downloads',
  '/watch',
  '/read',
  '/logs',
  '/notifications',
  '/stats',
]

function isOfflineSafe(pathname: string): boolean {
  return OFFLINE_SAFE_ROUTES.some((route) => pathname.startsWith(route))
}

interface OfflineGuardProps {
  children: ReactNode
}

export function OfflineGuard({ children }: OfflineGuardProps) {
  const { isOnline } = useNetworkStatus()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  // If online, always render children
  if (isOnline) {
    return <>{children}</>
  }

  // If offline but on a safe route, render children
  if (isOfflineSafe(currentPath)) {
    return <>{children}</>
  }

  // Offline on an internet-required route — show the hub
  return (
    <div className="animate-in fade-in duration-300">
      <OfflineHub />
    </div>
  )
}
```

**Step 2: Verify no lint errors**

Run: `cd /Users/vishnukv/facets/codebases/otaku && npx tsc --noEmit --pretty 2>&1 | grep -E 'OfflineGuard|error' | head -10 || echo "No errors"`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/layout/OfflineGuard.tsx
git commit -m "feat: add OfflineGuard to intercept internet-dependent routes when offline"
```

---

### Task 4: Integrate OfflineGuard into Root Route

**Files:**
- Modify: `src/routes/__root.tsx`

**Context:**
- The root route currently renders `<AppShell><Outlet /></AppShell>` inside a `<MediaStatusProvider>`
- We wrap `<Outlet />` with `<OfflineGuard>` so the guard can intercept when offline

**Step 1: Add import**

At the top of `src/routes/__root.tsx`, add:
```typescript
import { OfflineGuard } from '@/components/layout/OfflineGuard'
```

**Step 2: Wrap Outlet with OfflineGuard**

In the `RootComponent` function, change the return from:
```tsx
<AppShell>
  <Outlet />
</AppShell>
```
to:
```tsx
<AppShell>
  <OfflineGuard>
    <Outlet />
  </OfflineGuard>
</AppShell>
```

**Step 3: Verify the app compiles**

Run: `cd /Users/vishnukv/facets/codebases/otaku && npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors

**Step 4: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "feat: integrate OfflineGuard into root route"
```

---

### Task 5: Manual Testing & Polish

**Step 1: Test offline mode in browser DevTools**

1. Run the app: `cd /Users/vishnukv/facets/codebases/otaku && npm run dev` (or `cargo tauri dev`)
2. Open DevTools → Network tab → toggle "Offline" mode
3. Navigate to Home (`/`) — should see OfflineHub with "You're Offline"
4. Navigate to `/anime` — should see OfflineHub
5. Navigate to `/manga` — should see OfflineHub
6. Navigate to `/library` — should render normally (offline-safe)
7. Navigate to `/settings` — should render normally (offline-safe)
8. Navigate to `/downloads` — should render normally (offline-safe)
9. Toggle back online — should see "You're back online!" toast
10. Home page should load normally again

**Step 2: Verify downloaded content shows up**

If you have downloaded anime/manga:
1. Go offline
2. Check that cover cards appear in the OfflineHub grid
3. Click an anime card — should navigate to `/watch`
4. Go back, click "Manage Downloads" — should navigate to `/downloads`

If you have no downloads:
1. Go offline
2. Check that the "Nothing Downloaded Yet" empty state shows
3. Library and Settings links should work

**Step 3: Test mobile layout**

Use DevTools responsive mode (or run on device):
1. BottomTabBar should remain visible
2. OfflineHub grid should be 2 columns
3. Tapping Library/Settings in tab bar should navigate normally

**Step 4: Final commit**

If any CSS tweaks or fixes were needed during testing:
```bash
git add -A
git commit -m "fix: polish offline hub styling and layout"
```
