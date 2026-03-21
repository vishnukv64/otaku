import { useState, useEffect, useCallback, useRef } from 'react'
import { Calendar, Filter, Loader2 } from 'lucide-react'
import { jikanSchedules, getLibraryEntry } from '@/utils/tauri-commands'
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

function capitalizeDay(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1)
}

function getEmptyMessage(filterMode: FilterMode, activeDay: string): string {
  const dayName = capitalizeDay(activeDay)

  switch (filterMode) {
    case 'library':
      return `None of your library anime air on ${dayName}`
    case 'watching':
      return `No anime you're watching airs on ${dayName}`
    default:
      return `No anime scheduled for ${dayName}`
  }
}

export function SchedulePage(): JSX.Element {
  const [activeDay, setActiveDay] = useState<DayKey>(getTodayKey())
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [dayCache, setDayCache] = useState<Partial<Record<DayKey, DayData>>>({})
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedAnime, setSelectedAnime] = useState<SearchResult | null>(null)
  const abortRef = useRef(0)
  const nsfwFilter = useSettingsStore((s) => s.nsfwFilter)

  const fetchDay = useCallback(async (day: DayKey, page: number = 1) => {
    const token = ++abortRef.current
    if (page === 1) setLoading(true)
    else setLoadingMore(true)

    try {
      const data = await jikanSchedules(day, page, nsfwFilter)
      if (token !== abortRef.current) return

      const results = filterNsfwContent(
        data.results,
        (item) => item.genres ?? [],
        nsfwFilter,
        (item) => item.title
      )

      // Batch check library status
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

      if (token !== abortRef.current) return

      setDayCache((prev) => {
        const existing = prev[day]
        if (page === 1) {
          return { ...prev, [day]: { results, hasNextPage: data.has_next_page, page, libraryStatuses: statuses } }
        }
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
  }, [nsfwFilter])

  useEffect(() => {
    if (!dayCache[activeDay]) {
      fetchDay(activeDay)
    }
  }, [activeDay, fetchDay])

  const dayData = dayCache[activeDay]

  const filteredResults = (dayData?.results ?? []).filter((anime) => {
    if (filterMode === 'all') return true
    const status = dayData?.libraryStatuses[anime.id]
    if (filterMode === 'library') return status !== null
    if (filterMode === 'watching') return status === 'watching'
    return true
  })

  function handleLoadMore(): void {
    if (dayData?.hasNextPage) {
      fetchDay(activeDay, (dayData.page ?? 1) + 1)
    }
  }

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
              <h1 className="text-xl font-bold text-white border-l-[3px] border-[var(--color-accent-primary)] pl-3">Schedule</h1>
            </div>
            <div className="relative">
              <select
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value as FilterMode)}
                className="appearance-none bg-[rgba(255,255,255,0.06)] text-white text-sm pl-3 pr-8 py-1.5 rounded-lg border border-[rgba(255,255,255,0.1)] cursor-pointer focus:outline-none focus:border-[#e50914]"
              >
                <option value="all" className="bg-[#1a1a1a] text-white">All Anime</option>
                <option value="library" className="bg-[#1a1a1a] text-white">My Library</option>
                <option value="watching" className="bg-[#1a1a1a] text-white">Watching Only</option>
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
          <SkeletonGrid />
        ) : filteredResults.length === 0 ? (
          <EmptyState message={getEmptyMessage(filterMode, activeDay)} />
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
          media={selectedAnime}
          isOpen={true}
          onClose={() => setSelectedAnime(null)}
        />
      )}
    </div>
  )
}

function SkeletonGrid(): JSX.Element {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[2/3] rounded-xl bg-[rgba(255,255,255,0.06)]" />
          <div className="mt-2 h-3 rounded bg-[rgba(255,255,255,0.06)] w-3/4" />
          <div className="mt-1 h-2.5 rounded bg-[rgba(255,255,255,0.04)] w-1/2" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Calendar className="w-12 h-12 text-[rgba(255,255,255,0.15)] mb-4" />
      <p className="text-[rgba(255,255,255,0.5)] text-sm">{message}</p>
    </div>
  )
}
