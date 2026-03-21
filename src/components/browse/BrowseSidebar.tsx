/**
 * BrowseSidebar Component
 *
 * Sticky collapsible sidebar with navigation tabs, year dropdown,
 * type/status filter pills, score slider, and genre checkboxes.
 * Shared between anime and manga browse pages.
 */

import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import type { Tag } from '@/utils/tauri-commands'

export interface BrowseFilters {
  year?: number
  types: string[]
  statuses: string[]
  minScore: number
  genres: Set<number>
  orderBy: string
  sort: string
  nsfw?: boolean
}

export type NavItem = 'browse' | 'season' | 'top-rated' | 'genres'

interface BrowseSidebarProps {
  collapsed: boolean
  onToggle: () => void
  activeNav: NavItem
  onNavChange: (nav: NavItem) => void
  filters: BrowseFilters
  onFiltersChange: (filters: BrowseFilters) => void
  onReset?: () => void
  mediaType: 'anime' | 'manga'
  genres: Tag[]
  genresLoading?: boolean
  yearOptions: number[]
}

const animeTypes = ['TV', 'Movie', 'OVA', 'ONA', 'Special', 'Music']
const mangaTypes = ['Manga', 'Manhwa', 'Manhua', 'One-shot', 'Novel', 'Doujin']
const animeStatuses = ['Airing', 'Complete', 'Upcoming']
const mangaStatuses = ['Publishing', 'Complete', 'Hiatus', 'Discontinued']

export function BrowseSidebar({
  collapsed,
  onToggle,
  activeNav,
  onNavChange,
  filters,
  onFiltersChange,
  onReset,
  mediaType,
  genres,
  genresLoading,
  yearOptions,
}: BrowseSidebarProps) {
  const [genresExpanded, setGenresExpanded] = useState(false)
  const types = mediaType === 'anime' ? animeTypes : mangaTypes
  const statuses = mediaType === 'anime' ? animeStatuses : mangaStatuses

  const navItems: { key: NavItem; label: string }[] = [
    { key: 'browse', label: 'Browse' },
    { key: 'season', label: mediaType === 'anime' ? 'This Season' : 'Publishing' },
    { key: 'top-rated', label: 'Top Rated' },
    { key: 'genres', label: 'By Genre' },
  ]

  const toggleType = (type: string) => {
    const next = filters.types.includes(type)
      ? filters.types.filter((t) => t !== type)
      : [...filters.types, type]
    onFiltersChange({ ...filters, types: next })
  }

  const toggleStatus = (status: string) => {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status]
    onFiltersChange({ ...filters, statuses: next })
  }

  const toggleGenre = (id: number) => {
    const next = new Set(filters.genres)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onFiltersChange({ ...filters, genres: next })
  }

  const visibleGenres = genresExpanded ? genres : genres.slice(0, 7)

  return (
    <aside
      className={`relative flex-shrink-0 transition-all duration-300 border-r border-[var(--color-glass-border)] ${
        collapsed ? 'w-0 min-w-0' : 'w-[240px]'
      }`}
    >
      {/* Collapse Toggle */}
      <button
        onClick={onToggle}
        className="absolute -right-4 top-6 z-10 w-4 h-12 flex items-center justify-center rounded-r-lg bg-[var(--color-panel)] border border-l-0 border-[var(--color-glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      <div className={`sticky top-[var(--nav-height)] h-[calc(100vh-var(--nav-height))] overflow-y-auto scrollbar-hide py-6 px-4 ${collapsed ? 'invisible' : ''}`}>
        {/* Navigation */}
        <nav className="mb-6">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => onNavChange(item.key)}
              className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-all duration-150 ${
                activeNav === item.key
                  ? 'text-white bg-[rgba(229,9,20,0.12)] border-l-[3px] border-[var(--color-accent-mid)]'
                  : 'text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-glass-bg)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Filters */}
        <div className="space-y-5">
            {/* Year */}
            <div>
              <label className="block text-[0.65rem] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 after:content-[''] after:block after:mt-1.5 after:h-px after:bg-[var(--color-glass-border)]">
                Year
              </label>
              <select
                value={filters.year || ''}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    year: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                className="w-full px-3 py-2 text-sm bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-[var(--radius-md)] text-white focus:outline-none focus:border-[var(--color-accent-primary)]"
              >
                <option value="">Any Year</option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            {/* Type Pills */}
            <div>
              <label className="block text-[0.65rem] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 after:content-[''] after:block after:mt-1.5 after:h-px after:bg-[var(--color-glass-border)]">
                Type
              </label>
              <div className="flex flex-wrap gap-1.5">
                {types.map((type) => (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-all duration-150 ${
                      filters.types.includes(type)
                        ? 'bg-[rgba(229,9,20,0.15)] border-[var(--color-accent-mid)] text-white shadow-[0_0_8px_rgba(229,9,20,0.2)]'
                        : 'bg-transparent border-[var(--color-glass-border)] text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-glass-border-hover)]'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Status Pills */}
            <div>
              <label className="block text-[0.65rem] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 after:content-[''] after:block after:mt-1.5 after:h-px after:bg-[var(--color-glass-border)]">
                Status
              </label>
              <div className="flex flex-wrap gap-1.5">
                {statuses.map((status) => (
                  <button
                    key={status}
                    onClick={() => toggleStatus(status)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-all duration-150 ${
                      filters.statuses.includes(status)
                        ? 'bg-[rgba(229,9,20,0.15)] border-[var(--color-accent-mid)] text-white shadow-[0_0_8px_rgba(229,9,20,0.2)]'
                        : 'bg-transparent border-[var(--color-glass-border)] text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-glass-border-hover)]'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            {/* 18+ Content */}
            <div>
              <label className="block text-[0.65rem] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 after:content-[''] after:block after:mt-1.5 after:h-px after:bg-[var(--color-glass-border)]">
                Rating
              </label>
              <button
                onClick={() => onFiltersChange({ ...filters, nsfw: !filters.nsfw })}
                className={`px-2.5 py-1 text-xs rounded-full border transition-all duration-150 ${
                  filters.nsfw
                    ? 'bg-[rgba(229,9,20,0.15)] border-[var(--color-accent-mid)] text-white shadow-[0_0_8px_rgba(229,9,20,0.2)]'
                    : 'bg-transparent border-[var(--color-glass-border)] text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-glass-border-hover)]'
                }`}
              >
                18+
              </button>
            </div>

            {/* Score Slider */}
            <div>
              <label className="block text-[0.65rem] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 after:content-[''] after:block after:mt-1.5 after:h-px after:bg-[var(--color-glass-border)]">
                Min Score
              </label>
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={filters.minScore}
                onChange={(e) =>
                  onFiltersChange({ ...filters, minScore: Number(e.target.value) })
                }
                className="w-full accent-[var(--color-accent-primary)]"
              />
              <div className="flex justify-between text-xs text-[var(--color-text-muted)] mt-1">
                <span>0</span>
                <span className="text-[var(--color-gold)] font-semibold">{filters.minScore}</span>
                <span>10</span>
              </div>
            </div>

            {/* Genre Checkboxes */}
            <div>
              <label className="block text-[0.65rem] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 after:content-[''] after:block after:mt-1.5 after:h-px after:bg-[var(--color-glass-border)]">
                Genres
              </label>
              {genresLoading ? (
                <div className="text-xs text-[var(--color-text-muted)] py-2">Loading genres...</div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {visibleGenres.map((genre) => (
                    <button
                      key={genre.id!}
                      onClick={() => toggleGenre(genre.id!)}
                      className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded-md transition-all duration-150 ${
                        filters.genres.has(genre.id!)
                          ? 'bg-[rgba(229,9,20,0.12)] text-white'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-glass-bg)]'
                      }`}
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors ${
                          filters.genres.has(genre.id!)
                            ? 'bg-[var(--color-accent-primary)] border-[var(--color-accent-primary)]'
                            : 'border-[var(--color-glass-border)]'
                        }`}
                      >
                        {filters.genres.has(genre.id!) && (
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      {genre.name}
                    </button>
                  ))}
                  {genres.length > 7 && (
                    <button
                      onClick={() => setGenresExpanded(!genresExpanded)}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs text-[var(--color-accent-light)] hover:text-[var(--color-accent-mid)] transition-colors"
                    >
                      <ChevronDown
                        size={12}
                        className={`transition-transform ${genresExpanded ? 'rotate-180' : ''}`}
                      />
                      {genresExpanded ? 'Show less' : `Show all ${genres.length}`}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

        {/* Reset Filters */}
        {onReset && (
          <button
            onClick={onReset}
            className="w-full mt-4 px-3 py-2 text-sm rounded-[var(--radius-md)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] hover:text-white hover:border-[var(--color-glass-border-hover)] transition-all"
          >
            Reset Filters
          </button>
        )}
      </div>
    </aside>
  )
}
