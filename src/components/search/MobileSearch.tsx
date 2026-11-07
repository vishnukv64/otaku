/**
 * Phone full-screen search (mock: design/files/search.html). Desktop keeps the SpotlightSearch modal.
 */
import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, X, WifiOff } from 'lucide-react'
import { jikanSearchAnime, jikanSearchManga, jikanSeasonNow, getLibraryWithMedia } from '@/utils/tauri-commands'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { MangaDetailModal } from '@/components/media/MangaDetailModal'
import { useSettingsStore } from '@/store/settingsStore'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import type { SearchResult } from '@/types/extension'

interface Hit extends SearchResult {
  mediaType: 'anime' | 'manga'
}
type Scope = 'all' | 'anime' | 'manga'

const RECENT_KEY = 'otaku.search.recent'

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function errorCopy(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err || '')
  if (!m) return 'Search failed'
  if (m.includes('429') || m.toLowerCase().includes('rate limited')) {
    return 'Jikan is rate limiting searches. Wait a moment and try again.'
  }
  return m
}

export function MobileSearch({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const nsfwFilter = useSettingsStore((s) => s.nsfwFilter)
  const { isOnline } = useNetworkStatus()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [anime, setAnime] = useState<Hit[]>([])
  const [manga, setManga] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [selected, setSelected] = useState<Hit | null>(null)
  const [trending, setTrending] = useState<Hit[] | null>(null) // null = loading
  const [trendingFailed, setTrendingFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 50)
    else {
      setQuery('')
      setError(null)
    }
  }, [isOpen])

  // Trending = currently airing season (same source the Anime tab uses).
  useEffect(() => {
    if (!isOpen || !isOnline || trending) return
    let stale = false
    setTrendingFailed(false)
    jikanSeasonNow(1, nsfwFilter)
      .then((r) => {
        if (stale) return
        setTrending(
          filterNsfwContent(r.results, (i) => i.genres, nsfwFilter, (i) => i.title)
            .slice(0, 8)
            .map((x) => ({ ...x, mediaType: 'anime' as const }))
        )
      })
      .catch(() => !stale && setTrendingFailed(true))
    return () => {
      stale = true
    }
  }, [isOpen, isOnline, nsfwFilter, trending])

  useEffect(() => {
    const q = query.trim()
    if (!isOpen || !q) {
      setAnime([])
      setManga([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    let stale = false
    const timer = setTimeout(async () => {
      try {
        if (!isOnline) {
          const lib = await getLibraryWithMedia()
          if (stale) return
          const hits = lib
            .map((e) => e.media)
            .filter((m) => m.title.toLowerCase().includes(q.toLowerCase()))
            .map<Hit>((m) => ({
              id: m.id,
              title: m.title,
              cover_url: m.cover_url,
              year: m.year,
              rating: m.rating,
              status: m.status,
              mediaType: m.media_type,
            }))
          setAnime(hits.filter((h) => h.mediaType === 'anime'))
          setManga(hits.filter((h) => h.mediaType === 'manga'))
          return
        }
        const [a, m] = await Promise.allSettled([
          jikanSearchAnime(q, 1, nsfwFilter),
          jikanSearchManga(q, 1, nsfwFilter),
        ])
        if (stale) return
        if (a.status === 'rejected' && m.status === 'rejected') throw a.reason
        const pick = (s: typeof a, type: Hit['mediaType']): Hit[] =>
          s.status === 'fulfilled'
            ? filterNsfwContent(s.value.results, (i) => i.genres, nsfwFilter, (i) => i.title)
                .slice(0, 10)
                .map((r) => ({ ...r, mediaType: type }))
            : []
        setAnime(pick(a, 'anime'))
        setManga(pick(m, 'manga'))
      } catch (err) {
        if (stale) return
        console.error('Search failed:', err)
        setError(errorCopy(err))
        setAnime([])
        setManga([])
      } finally {
        if (!stale) setLoading(false)
      }
    }, 300)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, nsfwFilter, isOpen, isOnline, retry])

  const select = (hit: Hit) => {
    if (query.trim()) {
      const next = [query.trim(), ...recent.filter((r) => r !== query.trim())].slice(0, 8)
      setRecent(next)
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    }
    setSelected(hit)
    onClose()
  }
  const clearRecent = () => {
    setRecent([])
    localStorage.removeItem(RECENT_KEY)
  }

  const groups = [
    { label: isOnline ? 'Anime' : 'In your library', items: scope === 'manga' ? [] : anime, type: 'anime' as const },
    { label: 'Manga', items: scope === 'anime' || !isOnline ? [] : manga, type: 'manga' as const },
  ].filter((g) => g.items.length > 0)
  // Offline results are a single "In your library" group (anime + manga together).
  const shown = isOnline
    ? groups
    : [{ label: 'In your library', items: [...anime, ...manga].filter((h) => scope === 'all' || h.mediaType === scope), type: 'anime' as const }].filter(
        (g) => g.items.length > 0
      )
  const q = query.trim()

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-[101] flex flex-col bg-[var(--color-bg-primary)] pt-[var(--sat)]">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" size={18} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search anime & manga..."
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="h-11 w-full rounded-full bg-[var(--color-glass-bg)] pl-10 pr-11 text-base text-white placeholder-[var(--color-text-muted)] focus:outline-none"
              />
              {loading ? (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--color-accent-primary)]" size={18} />
              ) : (
                query && (
                  <button
                    onClick={() => setQuery('')}
                    aria-label="Clear"
                    className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-[var(--color-text-secondary)]"
                  >
                    <X size={18} />
                  </button>
                )
              )}
            </div>
            <button onClick={onClose} className="min-h-[44px] px-2 text-sm font-semibold text-[var(--color-accent-light)]">
              Cancel
            </button>
          </div>

          {q && (
            <div className="mx-3 mb-2 flex gap-1 rounded-[var(--radius-lg)] bg-[var(--color-glass-bg)] p-1">
              {(['all', 'anime', 'manga'] as Scope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`min-h-[36px] flex-1 rounded-[var(--radius-md)] text-sm font-semibold capitalize ${
                    scope === s ? 'bg-[var(--color-accent-primary)] text-white' : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto pb-[var(--sab)]">
            {!isOnline && q && (
              <div className="mx-3 mb-2 flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-glass-bg)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                <WifiOff size={14} className="mt-0.5" />
                <span>
                  You’re offline.
                  <br />
                  Searching your library only.
                </span>
              </div>
            )}

            {!q ? (
              <div className="px-4 py-6">
                <p className="text-center text-sm text-[var(--color-text-secondary)]">Start typing to search anime & manga</p>
                {recent.length > 0 && (
                  <div className="mt-6">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">Recent</span>
                      <button onClick={clearRecent} className="min-h-[44px] px-2 text-sm text-[var(--color-accent-light)]">
                        Clear
                      </button>
                    </div>
                    {recent.map((r) => (
                      <button
                        key={r}
                        onClick={() => setQuery(r)}
                        className="flex min-h-[48px] w-full items-center gap-3 border-b border-[var(--color-glass-border)] text-left text-[15px] text-white"
                      >
                        <Search size={16} className="text-[var(--color-text-muted)]" />
                        {r}
                      </button>
                    ))}
                  </div>
                )}
                {isOnline && !trendingFailed && (
                  <div className="mt-6">
                    <span className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">Trending</span>
                    {trending === null
                      ? [0, 1, 2, 3].map((i) => (
                          <div key={i} className="h-12 animate-pulse border-b border-[var(--color-glass-border)] py-3">
                            <div className="h-full w-2/3 rounded bg-[var(--color-glass-bg)]" />
                          </div>
                        ))
                      : trending.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => select(t)}
                            className="flex min-h-[48px] w-full items-center gap-3 border-b border-[var(--color-glass-border)] text-left text-[15px] text-white"
                          >
                            <span className="line-clamp-1">{t.title}</span>
                          </button>
                        ))}
                  </div>
                )}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <p className="text-sm text-[var(--color-text-secondary)]">{error}</p>
                <button
                  onClick={() => setRetry((n) => n + 1)}
                  className="mt-4 min-h-[44px] rounded-full bg-[var(--color-accent-primary)] px-6 text-sm font-semibold text-white"
                >
                  Retry
                </button>
              </div>
            ) : shown.length > 0 ? (
              shown.map((g) => (
                <section key={g.label}>
                  <h2 className="px-4 py-2 text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                    {g.label} · {g.items.length}
                  </h2>
                  {g.items.map((r) => (
                    <button
                      key={`${r.mediaType}-${r.id}`}
                      onClick={() => select(r)}
                      className="flex min-h-[72px] w-full items-center gap-3 px-4 py-2 text-left active:bg-[var(--color-glass-bg-hover)]"
                    >
                      <div className="relative shrink-0">
                        {r.cover_url ? (
                          <img src={r.cover_url} alt="" className="h-16 w-12 rounded-md object-cover" />
                        ) : (
                          <div className="h-16 w-12 rounded-md bg-[var(--color-glass-bg)]" />
                        )}
                        <span
                          className={`absolute -right-1 -top-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${
                            r.mediaType === 'anime' ? 'bg-blue-500' : 'bg-purple-500'
                          }`}
                        >
                          {r.mediaType === 'anime' ? 'A' : 'M'}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-[15px] font-medium text-white">{r.title}</h3>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-[var(--color-text-secondary)]">
                          <span>{r.mediaType === 'anime' ? 'Anime' : 'Manga'}{r.year ? ` · ${r.year}` : ''}</span>
                          {r.rating ? <span className="text-amber-400">★ {r.rating.toFixed(1)}</span> : null}
                          {r.status && <span>{r.status}</span>}
                        </p>
                      </div>
                    </button>
                  ))}
                </section>
              ))
            ) : !loading ? (
              <div className="py-16 text-center text-[var(--color-text-secondary)]">
                <Search size={40} className="mx-auto mb-3 opacity-50" />
                <p>No results found for "{query}"</p>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {selected?.mediaType === 'anime' && (
        <MediaDetailModal
          media={selected}
          isOpen
          onClose={() => setSelected(null)}
          onMediaChange={(media) => setSelected(media ? { ...media, mediaType: 'anime' } : null)}
        />
      )}
      {selected?.mediaType === 'manga' && <MangaDetailModal manga={selected} onClose={() => setSelected(null)} />}
    </>
  )
}
