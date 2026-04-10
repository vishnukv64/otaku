import { useState, useMemo } from 'react'
import { SlidersHorizontal, X, ChevronDown, ChevronUp } from 'lucide-react'
import type { Tag } from '@/utils/tauri-commands'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { isMobile } from '@/utils/platform'

/** Number of genre chips to show before collapsing on desktop */
const COLLAPSED_GENRE_COUNT = 18

interface FilterState {
  orderBy: string
  sort: string
  status: string
  type: string
}

interface GenreFilterBarProps {
  genres: Tag[]
  selectedGenreIds: Set<number>
  onToggleGenre: (id: number) => void
  filters: FilterState
  onFilterChange: (filters: FilterState) => void
  mediaType: 'anime' | 'manga'
  loading?: boolean
}

const ANIME_STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'airing', label: 'Airing' },
  { value: 'complete', label: 'Complete' },
  { value: 'upcoming', label: 'Upcoming' },
]

const MANGA_STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'publishing', label: 'Publishing' },
  { value: 'complete', label: 'Complete' },
  { value: 'hiatus', label: 'Hiatus' },
]

const ANIME_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'tv', label: 'TV' },
  { value: 'movie', label: 'Movie' },
  { value: 'ova', label: 'OVA' },
  { value: 'ona', label: 'ONA' },
  { value: 'special', label: 'Special' },
  { value: 'music', label: 'Music' },
]

const MANGA_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'manga', label: 'Manga' },
  { value: 'novel', label: 'Novel' },
  { value: 'lightnovel', label: 'Light Novel' },
  { value: 'oneshot', label: 'One-shot' },
  { value: 'manhwa', label: 'Manhwa' },
  { value: 'manhua', label: 'Manhua' },
]

const ORDER_BY_OPTIONS = [
  { value: 'score', label: 'Score' },
  { value: 'popularity', label: 'Popularity' },
  { value: 'rank', label: 'Rank' },
  { value: 'members', label: 'Members' },
  { value: 'title', label: 'Title' },
  { value: 'start_date', label: 'Start Date' },
]

const SORT_OPTIONS = [
  { value: 'desc', label: 'Descending' },
  { value: 'asc', label: 'Ascending' },
]

export function GenreFilterBar({
  genres,
  selectedGenreIds,
  onToggleGenre,
  filters,
  onFilterChange,
  mediaType,
  loading,
}: GenreFilterBarProps) {
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const [showAllGenres, setShowAllGenres] = useState(false)
  const mobile = isMobile()

  // Deduplicate genres by name (Jikan returns genres from multiple categories
  // like genres, explicit_genres, themes, demographics — some names overlap).
  // Keep the entry with the lowest ID (the primary genre category).
  const dedupedGenres = useMemo(() => {
    const seen = new Map<string, Tag>()
    for (const genre of genres) {
      const name = genre.name.toLowerCase()
      const existing = seen.get(name)
      if (!existing || (genre.id != null && (existing.id == null || genre.id < existing.id))) {
        seen.set(name, genre)
      }
    }
    return Array.from(seen.values())
  }, [genres])

  const statusOptions = mediaType === 'anime' ? ANIME_STATUS_OPTIONS : MANGA_STATUS_OPTIONS
  const typeOptions = mediaType === 'anime' ? ANIME_TYPE_OPTIONS : MANGA_TYPE_OPTIONS

  const activeFilterCount = [
    filters.orderBy,
    filters.sort !== 'desc' ? filters.sort : '',
    filters.status,
    filters.type,
  ].filter(Boolean).length

  const handleClearAll = () => {
    onFilterChange({ orderBy: '', sort: 'desc', status: '', type: '' })
  }

  const selectClasses = "bg-[var(--color-bg-secondary)] border border-[var(--color-bg-hover)] rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]"

  const filterDropdowns = (
    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
      <select
        value={filters.orderBy}
        onChange={(e) => onFilterChange({ ...filters, orderBy: e.target.value })}
        className={selectClasses}
      >
        <option value="">Order By</option>
        {ORDER_BY_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        value={filters.sort}
        onChange={(e) => onFilterChange({ ...filters, sort: e.target.value })}
        className={selectClasses}
      >
        {SORT_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        value={filters.status}
        onChange={(e) => onFilterChange({ ...filters, status: e.target.value })}
        className={selectClasses}
      >
        {statusOptions.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        value={filters.type}
        onChange={(e) => onFilterChange({ ...filters, type: e.target.value })}
        className={selectClasses}
      >
        {typeOptions.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {activeFilterCount > 0 && (
        <button
          onClick={handleClearAll}
          className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors whitespace-nowrap"
        >
          Clear filters
        </button>
      )}
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Genre Chips */}
      {(() => {
        const visibleGenres = mobile || showAllGenres
          ? dedupedGenres
          : dedupedGenres.slice(0, COLLAPSED_GENRE_COUNT)
        const hasMore = !mobile && dedupedGenres.length > COLLAPSED_GENRE_COUNT

        return (
          <>
            <div
              className={
                mobile
                  ? 'flex gap-2 overflow-x-auto whitespace-nowrap pb-2 -mx-4 px-4 scrollbar-hide'
                  : 'flex flex-wrap gap-2'
              }
              style={mobile ? { WebkitOverflowScrolling: 'touch' } : undefined}
            >
              {loading ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-8 w-20 rounded-full bg-[var(--color-bg-secondary)] animate-pulse shrink-0"
                  />
                ))
              ) : (
                visibleGenres.map((genre) => {
                  const isSelected = genre.id != null && selectedGenreIds.has(genre.id)
                  return (
                    <button
                      key={genre.id ?? genre.slug}
                      onClick={() => genre.id != null && onToggleGenre(genre.id)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        mobile ? 'min-h-[44px] flex items-center' : ''
                      } ${
                        isSelected
                          ? 'bg-[var(--color-accent-primary)] text-white'
                          : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                      }`}
                    >
                      {genre.name}
                    </button>
                  )
                })
              )}
            </div>
            {hasMore && !loading && (
              <button
                onClick={() => setShowAllGenres(!showAllGenres)}
                className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                {showAllGenres ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    {dedupedGenres.length - COLLAPSED_GENRE_COUNT} more genres
                  </>
                )}
              </button>
            )}
          </>
        )
      })()}

      {/* Filter Controls */}
      {mobile ? (
        <>
          <button
            onClick={() => setShowMobileFilters(true)}
            className="w-full py-3 px-4 bg-[var(--color-bg-secondary)] border border-[var(--color-bg-hover)] rounded-lg text-sm text-[var(--color-text-primary)] flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4" />
              Filters
            </span>
            {activeFilterCount > 0 && (
              <span className="bg-[var(--color-accent-primary)] text-white text-xs px-2 py-0.5 rounded-full">
                {activeFilterCount}
              </span>
            )}
          </button>

          <BottomSheet
            isOpen={showMobileFilters}
            onClose={() => setShowMobileFilters(false)}
          >
            <div className="p-4 space-y-4" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold">Filters</h3>
                <button onClick={() => setShowMobileFilters(false)}>
                  <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
                </button>
              </div>
              {filterDropdowns}
            </div>
          </BottomSheet>
        </>
      ) : (
        filterDropdowns
      )}
    </div>
  )
}
