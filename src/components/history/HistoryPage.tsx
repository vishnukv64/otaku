/**
 * HistoryPage — Main history page with view toggle, type filter, search, and data loading.
 *
 * View toggle: "Timeline" | "Series" (pill switcher)
 * Type filter: "All" | "Anime" | "Manga" tabs
 * Search: debounced 300ms input
 * Clear All: confirmation dialog
 * Infinite scroll pagination (50 items per page)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Trash2, Clock, Loader2, LayoutList, LayoutGrid } from 'lucide-react'
import {
  getAllHistory,
  getHistoryGroupedByMedia,
  clearAllWatchHistory,
  clearAllReadingHistory,
  type HistoryEntry,
  type MediaHistorySummary,
} from '@/utils/tauri-commands'
import { useSettingsStore } from '@/store/settingsStore'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import { notifySuccess, notifyError } from '@/utils/notify'
import { TimelineView } from './TimelineView'
import { SeriesView } from './SeriesView'

type ViewMode = 'timeline' | 'series'
type TypeFilter = 'all' | 'anime' | 'manga'

const PAGE_SIZE = 50

export function HistoryPage() {
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)

  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Timeline state
  const [timelineEntries, setTimelineEntries] = useState<HistoryEntry[]>([])
  const [timelinePage, setTimelinePage] = useState(1)
  const [timelineHasMore, setTimelineHasMore] = useState(true)
  const [timelineLoading, setTimelineLoading] = useState(false)

  // Series state
  const [seriesSummaries, setSeriesSummaries] = useState<MediaHistorySummary[]>([])
  const [seriesPage, setSeriesPage] = useState(1)
  const [seriesHasMore, setSeriesHasMore] = useState(true)
  const [seriesLoading, setSeriesLoading] = useState(false)

  const [initialLoading, setInitialLoading] = useState(true)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // Debounce search
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [searchQuery])

  // Map type filter to backend param
  const mediaTypeParam = typeFilter === 'all' ? undefined : typeFilter
  const searchParam = debouncedSearch.trim() || undefined

  // Load timeline data
  const loadTimeline = useCallback(
    async (page: number, append: boolean) => {
      if (page === 1) setInitialLoading(true)
      setTimelineLoading(true)
      try {
        const results = await getAllHistory(page, PAGE_SIZE, mediaTypeParam, searchParam)
        const filtered = filterNsfwContent(
          results,
          (e) => e.media.genres,
          nsfwFilter,
          (e) => e.media.title,
        )
        if (append) {
          setTimelineEntries((prev) => [...prev, ...filtered])
        } else {
          setTimelineEntries(filtered)
        }
        setTimelineHasMore(results.length === PAGE_SIZE)
      } catch (err) {
        console.error('Failed to load history:', err)
        notifyError('Error', 'Failed to load history')
      } finally {
        setTimelineLoading(false)
        setInitialLoading(false)
      }
    },
    [mediaTypeParam, searchParam, nsfwFilter],
  )

  // Load series data
  const loadSeries = useCallback(
    async (page: number, append: boolean) => {
      if (page === 1) setInitialLoading(true)
      setSeriesLoading(true)
      try {
        const results = await getHistoryGroupedByMedia(page, PAGE_SIZE, mediaTypeParam, searchParam)
        const filtered = filterNsfwContent(
          results,
          (s) => s.media.genres,
          nsfwFilter,
          (s) => s.media.title,
        )
        if (append) {
          setSeriesSummaries((prev) => [...prev, ...filtered])
        } else {
          setSeriesSummaries(filtered)
        }
        setSeriesHasMore(results.length === PAGE_SIZE)
      } catch (err) {
        console.error('Failed to load series history:', err)
        notifyError('Error', 'Failed to load series history')
      } finally {
        setSeriesLoading(false)
        setInitialLoading(false)
      }
    },
    [mediaTypeParam, searchParam, nsfwFilter],
  )

  // Reset and reload when filters/search/view change
  useEffect(() => {
    setTimelinePage(1)
    setSeriesPage(1)
    if (viewMode === 'timeline') {
      loadTimeline(1, false)
    } else {
      loadSeries(1, false)
    }
  }, [viewMode, typeFilter, debouncedSearch, nsfwFilter, loadTimeline, loadSeries])

  // Infinite scroll handlers
  const handleTimelineLoadMore = useCallback(() => {
    const nextPage = timelinePage + 1
    setTimelinePage(nextPage)
    loadTimeline(nextPage, true)
  }, [timelinePage, loadTimeline])

  const handleSeriesLoadMore = useCallback(() => {
    const nextPage = seriesPage + 1
    setSeriesPage(nextPage)
    loadSeries(nextPage, true)
  }, [seriesPage, loadSeries])

  // Entry removed handler
  const handleEntryRemoved = useCallback((entry: HistoryEntry) => {
    // Remove from timeline
    setTimelineEntries((prev) =>
      prev.filter((e) => {
        if (entry.type === 'watch') return !(e.type === 'watch' && e.episode_id === entry.episode_id && e.media.id === entry.media.id)
        return !(e.type === 'read' && e.chapter_id === entry.chapter_id && e.media.id === entry.media.id)
      }),
    )
  }, [])

  // Clear all history
  const handleClearAll = async () => {
    try {
      await Promise.all([clearAllWatchHistory(), clearAllReadingHistory()])
      setTimelineEntries([])
      setSeriesSummaries([])
      setShowClearConfirm(false)
      notifySuccess('Cleared', 'All history has been cleared')
    } catch (err) {
      console.error('Failed to clear history:', err)
      notifyError('Error', 'Failed to clear history')
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 sm:px-6 lg:px-8 3xl:px-12 py-8 max-w-4k mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-[2.5rem] font-extrabold font-display mb-1.5 bg-gradient-to-br from-[var(--color-text-primary)] to-[var(--color-text-secondary)] bg-clip-text text-transparent flex items-center gap-3">
          <Clock className="w-8 h-8 text-[var(--color-accent-primary)]" />
          History
        </h1>
        <p className="text-[var(--color-text-muted)] text-[0.9375rem]">
          Your watch and reading activity
        </p>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* View toggle */}
        <div className="flex gap-1 p-1 bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-[var(--radius-lg)]">
          <button
            onClick={() => setViewMode('timeline')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-sm font-medium transition-all ${
              viewMode === 'timeline'
                ? 'bg-[var(--color-accent-primary)] text-white shadow-[0_0_16px_var(--color-accent-glow)]'
                : 'bg-transparent text-[var(--color-text-secondary)]'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" />
            Timeline
          </button>
          <button
            onClick={() => setViewMode('series')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-sm font-medium transition-all ${
              viewMode === 'series'
                ? 'bg-[var(--color-accent-primary)] text-white shadow-[0_0_16px_var(--color-accent-glow)]'
                : 'bg-transparent text-[var(--color-text-secondary)]'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Series
          </button>
        </div>

        {/* Type filter tabs */}
        <div className="flex gap-1 p-1 bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-[var(--radius-lg)]">
          {(['all', 'anime', 'manga'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-3 py-1.5 rounded-[var(--radius-md)] text-sm font-medium transition-all capitalize ${
                typeFilter === type
                  ? 'bg-[var(--color-accent-primary)] text-white shadow-[0_0_16px_var(--color-accent-glow)]'
                  : 'bg-transparent text-[var(--color-text-secondary)]'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-dim)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search history..."
            className="w-full pl-9 pr-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
          />
        </div>

        {/* Clear All */}
        <button
          onClick={() => setShowClearConfirm(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-md)] text-sm font-medium text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Clear all history"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline">Clear All</span>
        </button>
      </div>

      {/* Content */}
      {initialLoading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-12 h-12 animate-spin text-[var(--color-accent-primary)] mb-4" />
          <p className="text-lg text-[var(--color-text-secondary)]">Loading history...</p>
        </div>
      ) : viewMode === 'timeline' ? (
        <TimelineView
          entries={timelineEntries}
          loading={timelineLoading}
          hasMore={timelineHasMore}
          onLoadMore={handleTimelineLoadMore}
          onEntryRemoved={handleEntryRemoved}
        />
      ) : (
        <SeriesView
          summaries={seriesSummaries}
          loading={seriesLoading}
          hasMore={seriesHasMore}
          onLoadMore={handleSeriesLoadMore}
          onEntryRemoved={handleEntryRemoved}
        />
      )}

      {/* Clear Confirmation Dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--color-card)] border border-[var(--color-glass-border)] rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">
              Clear All History?
            </h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">
              This will permanently delete all your watch and reading history. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 rounded-[var(--radius-md)] text-sm font-medium bg-[var(--color-glass-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                className="px-4 py-2 rounded-[var(--radius-md)] text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
