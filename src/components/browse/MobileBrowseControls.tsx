/**
 * Phone browse controls (mocks: anime.html, manga.html): nav chips, Filters + Sort buttons,
 * Filters bottom sheet (every sidebar filter) and Sort bottom sheet. Desktop uses BrowseSidebar/BrowseHeader.
 */
import { useState } from 'react'
import { SlidersHorizontal, ArrowUpDown, ChevronDown } from 'lucide-react'
import { BottomSheet, SheetOption } from '@/components/ui/BottomSheet'
import type { Tag } from '@/utils/tauri-commands'
import type { BrowseFilters, NavItem } from './BrowseSidebar'

const animeTypes = ['TV', 'Movie', 'OVA', 'ONA', 'Special', 'Music']
const mangaTypes = ['Manga', 'Manhwa', 'Manhua', 'One-shot', 'Novel', 'Doujin']
const animeStatuses = ['Airing', 'Complete', 'Upcoming']
const mangaStatuses = ['Publishing', 'Complete', 'Hiatus', 'Discontinued']
const sortOptions = [
  { value: 'popularity', label: 'Popularity' },
  { value: 'score', label: 'Score' },
  { value: 'title', label: 'Title' },
  { value: 'start_date', label: 'Newest' },
  { value: 'episodes', label: 'Episodes' },
]

interface Props {
  mediaType: 'anime' | 'manga'
  activeNav: NavItem
  onNavChange: (nav: NavItem) => void
  filters: BrowseFilters
  onFiltersChange: (f: BrowseFilters) => void
  onReset: () => void
  genres: Tag[]
  genresLoading?: boolean
  yearOptions: number[]
  resultCount?: number
}

const pill = (on: boolean) =>
  `min-h-[40px] rounded-full border px-4 text-sm ${
    on
      ? 'border-[var(--color-accent-mid)] bg-[rgba(229,9,20,0.15)] text-white'
      : 'border-[var(--color-glass-border)] text-[var(--color-text-secondary)]'
  }`

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-[0.65rem] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</p>
      {children}
    </div>
  )
}

export function MobileBrowseControls({
  mediaType,
  activeNav,
  onNavChange,
  filters,
  onFiltersChange,
  onReset,
  genres,
  genresLoading,
  yearOptions,
  resultCount,
}: Props) {
  const [sheet, setSheet] = useState<'filters' | 'sort' | null>(null)
  const [allGenres, setAllGenres] = useState(false)
  const types = mediaType === 'anime' ? animeTypes : mangaTypes
  const statuses = mediaType === 'anime' ? animeStatuses : mangaStatuses
  const nav: { key: NavItem; label: string }[] = [
    { key: 'browse', label: 'Browse' },
    { key: 'season', label: mediaType === 'anime' ? 'This Season' : 'Publishing' },
    { key: 'top-rated', label: 'Top Rated' },
    { key: 'genres', label: 'By Genre' },
  ]
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  const count =
    filters.types.length + filters.statuses.length + filters.genres.size + (filters.minScore > 0 ? 1 : 0) + (filters.nsfw ? 1 : 0) + (filters.year ? 1 : 0)
  const sortLabel = sortOptions.find((o) => o.value === (filters.orderBy || 'popularity'))?.label ?? 'Popularity'
  const shownGenres = allGenres ? genres : genres.slice(0, 12)

  return (
    <div className="mb-3">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-hide">
        {nav.map((n) => (
          <button key={n.key} onClick={() => onNavChange(n.key)} className={`${pill(activeNav === n.key)} shrink-0`}>
            {n.label}
          </button>
        ))}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <button
          onClick={() => setSheet('filters')}
          className="flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)] px-4 text-sm text-white"
        >
          <SlidersHorizontal size={16} /> Filters
          {count > 0 && (
            <span className="rounded-full bg-[var(--color-accent-primary)] px-1.5 text-xs font-semibold">{count}</span>
          )}
        </button>
        <button
          onClick={() => setSheet('sort')}
          className="flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)] px-4 text-sm text-white"
        >
          <ArrowUpDown size={16} /> {sortLabel}
        </button>
        {resultCount != null && resultCount > 0 && (
          <span className="ml-auto text-xs text-[var(--color-text-muted)]">{resultCount} results</span>
        )}
      </div>

      <BottomSheet isOpen={sheet === 'sort'} onClose={() => setSheet(null)} title="Sort by">
        {sortOptions.map((o) => (
          <SheetOption
            key={o.value}
            checked={(filters.orderBy || 'popularity') === o.value}
            onClick={() => {
              onFiltersChange({ ...filters, orderBy: o.value })
              setSheet(null)
            }}
          >
            {o.label}
          </SheetOption>
        ))}
      </BottomSheet>

      <BottomSheet isOpen={sheet === 'filters'} onClose={() => setSheet(null)} title="Filters">
        <div className="max-h-[65vh] overflow-y-auto px-4 pb-2">
          <Group label="Year">
            <select
              value={filters.year || ''}
              onChange={(e) => onFiltersChange({ ...filters, year: e.target.value ? Number(e.target.value) : undefined })}
              className="min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)] px-3 text-sm text-white"
            >
              <option value="">Any Year</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Group>
          <Group label="Type">
            <div className="flex flex-wrap gap-2">
              {types.map((t) => (
                <button key={t} onClick={() => onFiltersChange({ ...filters, types: toggle(filters.types, t) })} className={pill(filters.types.includes(t))}>
                  {t}
                </button>
              ))}
            </div>
          </Group>
          <Group label="Status">
            <div className="flex flex-wrap gap-2">
              {statuses.map((s) => (
                <button key={s} onClick={() => onFiltersChange({ ...filters, statuses: toggle(filters.statuses, s) })} className={pill(filters.statuses.includes(s))}>
                  {s}
                </button>
              ))}
            </div>
          </Group>
          <Group label="Rating">
            <button onClick={() => onFiltersChange({ ...filters, nsfw: !filters.nsfw })} className={pill(!!filters.nsfw)}>
              18+
            </button>
          </Group>
          <Group label="Min Score">
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={filters.minScore}
              onChange={(e) => onFiltersChange({ ...filters, minScore: Number(e.target.value) })}
              className="h-11 w-full accent-[var(--color-accent-primary)]"
            />
            <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
              <span>0</span>
              <span className="font-semibold text-[var(--color-gold)]">{filters.minScore}</span>
              <span>10</span>
            </div>
          </Group>
          <Group label="Genres">
            {genresLoading ? (
              <p className="text-xs text-[var(--color-text-muted)]">Loading genres...</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {shownGenres.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      const next = new Set(filters.genres)
                      if (!next.delete(g.id!)) next.add(g.id!)
                      onFiltersChange({ ...filters, genres: next })
                    }}
                    className={pill(filters.genres.has(g.id!))}
                  >
                    {g.name}
                  </button>
                ))}
                {genres.length > 12 && (
                  <button onClick={() => setAllGenres((v) => !v)} className="flex min-h-[40px] items-center gap-1 px-2 text-sm text-[var(--color-accent-light)]">
                    <ChevronDown size={14} className={allGenres ? 'rotate-180' : ''} />
                    {allGenres ? 'Show less' : `Show all ${genres.length}`}
                  </button>
                )}
              </div>
            )}
          </Group>
        </div>
        <div className="flex gap-3 border-t border-[var(--color-glass-border)] px-4 py-3">
          <button
            onClick={onReset}
            className="min-h-[44px] flex-1 rounded-full border border-[var(--color-glass-border)] text-sm text-[var(--color-text-secondary)]"
          >
            Reset
          </button>
          <button
            onClick={() => setSheet(null)}
            className="min-h-[44px] flex-1 rounded-full bg-[var(--color-accent-primary)] text-sm font-semibold text-white"
          >
            {resultCount ? `Show ${resultCount} results` : 'Done'}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
