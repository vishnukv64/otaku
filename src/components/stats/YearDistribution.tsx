/**
 * YearDistribution — shows what era of anime/manga the user consumes,
 * grouped into decades with stacked horizontal bars.
 */

import type { YearDistEntry } from '@/utils/tauri-commands'

interface YearDistributionProps {
  data: YearDistEntry[] | null
}

interface DecadeBucket {
  label: string
  animeCount: number
  mangaCount: number
  total: number
}

const DECADE_THRESHOLD = 8 // show individual years if fewer unique years than this

function groupByDecade(entries: YearDistEntry[]): DecadeBucket[] {
  const map = new Map<number, { anime: number; manga: number }>()

  for (const e of entries) {
    const decade = Math.floor(e.year / 10) * 10
    const existing = map.get(decade) ?? { anime: 0, manga: 0 }
    existing.anime += e.anime_count
    existing.manga += e.manga_count
    map.set(decade, existing)
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([decade, counts]) => ({
      label: `${decade}s`,
      animeCount: counts.anime,
      mangaCount: counts.manga,
      total: counts.anime + counts.manga,
    }))
}

function groupByYear(entries: YearDistEntry[]): DecadeBucket[] {
  return entries
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((e) => ({
      label: String(e.year),
      animeCount: e.anime_count,
      mangaCount: e.manga_count,
      total: e.anime_count + e.manga_count,
    }))
}

export function YearDistribution({ data }: YearDistributionProps) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          Release Year Distribution
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          No release year data available yet. Add some anime or manga to your library.
        </p>
      </div>
    )
  }

  const uniqueYears = new Set(data.map((e) => e.year)).size
  const useDecades = uniqueYears >= DECADE_THRESHOLD
  const buckets = useDecades ? groupByDecade(data) : groupByYear(data)
  const maxTotal = Math.max(...buckets.map((b) => b.total), 1)

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
        Release Year Distribution
      </h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-5">
        {useDecades ? 'Grouped by decade' : 'By individual year'}
      </p>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: 'var(--color-accent-primary)' }}
          />
          <span className="text-xs text-[var(--color-text-secondary)]">Anime</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: 'var(--color-info)' }}
          />
          <span className="text-xs text-[var(--color-text-secondary)]">Manga</span>
        </div>
      </div>

      {/* Bars */}
      <div className="space-y-3">
        {buckets.map((bucket) => {
          const widthPct = (bucket.total / maxTotal) * 100
          const animePct = bucket.total > 0 ? (bucket.animeCount / bucket.total) * 100 : 0
          const mangaPct = bucket.total > 0 ? (bucket.mangaCount / bucket.total) * 100 : 0

          return (
            <div key={bucket.label} className="flex items-center gap-3">
              <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right shrink-0 tabular-nums">
                {bucket.label}
              </span>
              <div className="flex-1 flex items-center gap-2">
                <div
                  className="h-7 rounded-md flex overflow-hidden transition-all"
                  style={{ width: `${Math.max(widthPct, 2)}%` }}
                >
                  {bucket.animeCount > 0 && (
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${animePct}%`,
                        backgroundColor: 'var(--color-accent-primary)',
                        minWidth: bucket.animeCount > 0 ? '4px' : '0',
                      }}
                    />
                  )}
                  {bucket.mangaCount > 0 && (
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${mangaPct}%`,
                        backgroundColor: 'var(--color-info)',
                        minWidth: bucket.mangaCount > 0 ? '4px' : '0',
                      }}
                    />
                  )}
                </div>
                <span className="text-xs text-[var(--color-text-tertiary)] shrink-0 tabular-nums">
                  {bucket.total}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
