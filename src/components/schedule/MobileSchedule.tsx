/**
 * Phone schedule (mock: design/files/schedule.html). Desktop keeps SchedulePage.
 * The page title/back live in MobileAppBar, so this renders only the segment, filter, day strip and list.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, BellOff, ChevronDown, Loader2, CalendarX, WifiOff, Play } from 'lucide-react'
import { jikanSchedules, getLibraryEntry } from '@/utils/tauri-commands'
import type { SearchResult } from '@/types/extension'
import { DayTabs, getTodayKey, type DayKey } from './DayTabs'
import { getNextBroadcastDate, formatCountdown } from './ScheduleCard'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { AnimeSegment } from '@/components/browse/AnimeSegment'
import { BottomSheet, SheetOption } from '@/components/ui/BottomSheet'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import { useSettingsStore } from '@/store/settingsStore'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { useProxiedImage } from '@/hooks/useProxiedImage'

type FilterMode = 'all' | 'library' | 'watching'

const FILTER_LABELS: Record<FilterMode, string> = {
  all: 'All Anime',
  library: 'My Library',
  watching: 'Watching Only',
}

const STATUS_LABELS: Record<string, string> = {
  watching: 'Watching',
  plan_to_watch: 'Plan to Watch',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
}

interface DayData {
  results: SearchResult[]
  hasNextPage: boolean
  page: number
  libraryStatuses: Record<string, string | null>
}

const NOTIFY_KEY = 'otaku.schedule.notify'

function loadNotify(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTIFY_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function emptyMessage(mode: FilterMode, day: DayKey): string {
  const name = day.charAt(0).toUpperCase() + day.slice(1)
  if (mode === 'library') return `None of your library anime air on ${name}`
  if (mode === 'watching') return `No anime you're watching airs on ${name}`
  return `No anime scheduled for ${name}`
}

function localTimeLine(a: SearchResult, next: Date | null): string | null {
  if (!next || !a.broadcast_time) return null
  const t = next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${t} local · JST ${a.broadcast_time}`
}

export function MobileSchedule(): JSX.Element {
  const [activeDay, setActiveDay] = useState<DayKey>(getTodayKey())
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [dayCache, setDayCache] = useState<Partial<Record<DayKey, DayData>>>({})
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<SearchResult | null>(null)
  const [notify, setNotify] = useState<Set<string>>(loadNotify)
  const token = useRef(0)
  const nsfwFilter = useSettingsStore((s) => s.nsfwFilter)
  const { isOnline } = useNetworkStatus()

  const fetchDay = useCallback(
    async (day: DayKey, page = 1) => {
      const t = ++token.current
      if (page === 1) setLoading(true)
      else setLoadingMore(true)
      setError(false)
      try {
        const data = await jikanSchedules(day, page, nsfwFilter)
        if (t !== token.current) return
        const results = filterNsfwContent(data.results, (i) => i.genres ?? [], nsfwFilter, (i) => i.title)
        const statuses: Record<string, string | null> = {}
        await Promise.all(
          results.map(async (a) => {
            try {
              statuses[a.id] = (await getLibraryEntry(a.id))?.status ?? null
            } catch {
              statuses[a.id] = null
            }
          })
        )
        if (t !== token.current) return
        setDayCache((prev) => {
          const old = prev[day]
          return {
            ...prev,
            [day]: {
              results: page === 1 ? results : [...(old?.results ?? []), ...results],
              hasNextPage: data.has_next_page,
              page,
              libraryStatuses: { ...(page === 1 ? {} : old?.libraryStatuses), ...statuses },
            },
          }
        })
      } catch (err) {
        console.error(`Failed to fetch schedule for ${day}:`, err)
        if (t === token.current) setError(true)
      } finally {
        if (t === token.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [nsfwFilter]
  )

  useEffect(() => {
    if (!dayCache[activeDay]) fetchDay(activeDay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDay, fetchDay])

  const toggleNotify = (id: string) => {
    setNotify((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      localStorage.setItem(NOTIFY_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const dayData = dayCache[activeDay]
  const items = (dayData?.results ?? []).filter((a) => {
    const s = dayData?.libraryStatuses[a.id]
    if (filterMode === 'library') return !!s
    if (filterMode === 'watching') return s === 'watching'
    return true
  })
  const counts: Partial<Record<DayKey, number>> = {}
  for (const [d, v] of Object.entries(dayCache)) counts[d as DayKey] = v.results.length

  return (
    <div className="pb-6">
      <AnimeSegment active="schedule" />
      <div className="mb-1 flex items-center justify-end px-4">
        <button
          onClick={() => setFilterOpen(true)}
          className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)] px-4 text-sm text-white"
        >
          {FILTER_LABELS[filterMode]}
          <ChevronDown size={14} />
        </button>
      </div>
      <DayTabs activeDay={activeDay} onDayChange={setActiveDay} counts={counts} />

      {!isOnline && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-glass-bg)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          <WifiOff size={14} /> You are offline. Showing saved schedule.
        </div>
      )}

      <div className="px-4 pt-3">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[2/3] rounded-xl bg-[var(--color-glass-bg)]" />
                <div className="mt-2 h-3 w-3/4 rounded bg-[var(--color-glass-bg)]" />
              </div>
            ))}
          </div>
        ) : error && !dayData ? (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="font-semibold text-white">Could not load the schedule</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Check your connection and try again.</p>
            <button
              onClick={() => fetchDay(activeDay)}
              className="mt-4 min-h-[44px] rounded-full bg-[var(--color-accent-primary)] px-6 text-sm font-semibold text-white"
            >
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <CalendarX className="mb-3 h-10 w-10 text-[var(--color-text-muted)]" />
            <p className="text-sm text-[var(--color-text-secondary)]">{emptyMessage(filterMode, activeDay)}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {items.map((a) => (
                <AiringCard
                  key={a.id}
                  anime={a}
                  status={dayData?.libraryStatuses[a.id]}
                  notify={notify.has(a.id)}
                  onNotify={() => toggleNotify(a.id)}
                  onOpen={() => setSelected(a)}
                />
              ))}
            </div>
            {dayData?.hasNextPage && filterMode === 'all' && (
              <div className="mt-5 flex justify-center">
                <button
                  onClick={() => fetchDay(activeDay, dayData.page + 1)}
                  disabled={loadingMore}
                  className="min-h-[44px] rounded-full bg-[var(--color-glass-bg)] px-8 text-sm text-white disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <BottomSheet isOpen={filterOpen} onClose={() => setFilterOpen(false)} title="Filter">
        {(Object.keys(FILTER_LABELS) as FilterMode[]).map((m) => (
          <SheetOption
            key={m}
            checked={filterMode === m}
            onClick={() => {
              setFilterMode(m)
              setFilterOpen(false)
            }}
          >
            {FILTER_LABELS[m]}
          </SheetOption>
        ))}
      </BottomSheet>

      {selected && <MediaDetailModal media={selected} isOpen onClose={() => setSelected(null)} />}
    </div>
  )
}

function AiringCard({
  anime,
  status,
  notify,
  onNotify,
  onOpen,
}: {
  anime: SearchResult
  status?: string | null
  notify: boolean
  onNotify: () => void
  onOpen: () => void
}) {
  const { src } = useProxiedImage(anime.cover_url || '')
  const next = getNextBroadcastDate(anime.broadcast_day, anime.broadcast_time)
  const cd = formatCountdown(next)
  const line = localTimeLine(anime, next)
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)]">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-[2/3] overflow-hidden">
          {src && <img src={src} alt={anime.title} className="h-full w-full object-cover" loading="lazy" />}
          {status && STATUS_LABELS[status] && (
            <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
              {STATUS_LABELS[status]}
            </span>
          )}
          {anime.media_type && (
            <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/80">
              {anime.media_type}
            </span>
          )}
          {cd.text && (
            <span
              className={`absolute inset-x-0 bottom-0 px-2 py-1.5 text-xs font-medium ${
                cd.isAiring
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : cd.isPast
                    ? 'bg-black/70 text-white/50'
                    : 'bg-black/70 text-green-400'
              }`}
            >
              {cd.isAiring && <Play className="mr-1 inline h-3 w-3 fill-current" />}
              {cd.text}
            </span>
          )}
        </div>
        <div className="space-y-1 p-2.5 pr-12">
          <h3 className="line-clamp-2 text-sm font-medium leading-tight text-white">{anime.title}</h3>
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            {anime.latest_episode ? <span>EP {anime.latest_episode}</span> : anime.available_episodes ? <span>{anime.available_episodes} EP</span> : null}
            {anime.rating ? <span className="text-amber-400">★ {anime.rating.toFixed(2)}</span> : null}
          </div>
          {line && <p className="truncate text-[11px] text-[var(--color-text-muted)]">{line}</p>}
        </div>
      </button>
      <button
        onClick={onNotify}
        aria-label={notify ? 'Turn off airing notification' : 'Notify me before airing'}
        aria-pressed={notify}
        className={`absolute bottom-1 right-1 flex h-11 w-11 items-center justify-center ${
          notify ? 'text-[var(--color-accent-light)]' : 'text-[var(--color-text-muted)]'
        }`}
      >
        {notify ? <Bell size={18} className="fill-current" /> : <BellOff size={18} />}
      </button>
    </div>
  )
}
