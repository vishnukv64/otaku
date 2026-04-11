/**
 * SeasonalTrends — shows which anime seasons the user watches from,
 * aggregated by season name with per-season+year breakdown.
 */

import { Snowflake, Flower2, Sun, Leaf } from 'lucide-react'
import type { SeasonEntry } from '@/utils/tauri-commands'

interface SeasonalTrendsProps {
  data: SeasonEntry[] | null
}

const SEASON_CONFIG = {
  winter: {
    icon: Snowflake,
    label: 'Winter',
    accent: 'var(--color-info)',
    bg: 'rgba(59, 130, 246, 0.08)',
  },
  spring: {
    icon: Flower2,
    label: 'Spring',
    accent: '#ec4899',
    bg: 'rgba(236, 72, 153, 0.08)',
  },
  summer: {
    icon: Sun,
    label: 'Summer',
    accent: 'var(--color-gold)',
    bg: 'rgba(234, 179, 8, 0.08)',
  },
  fall: {
    icon: Leaf,
    label: 'Fall',
    accent: 'var(--color-accent-primary)',
    bg: 'rgba(239, 68, 68, 0.08)',
  },
} as const

type SeasonKey = keyof typeof SEASON_CONFIG

function normalizeSeason(raw: string): SeasonKey | null {
  const lower = raw.toLowerCase().trim()
  if (lower === 'winter') return 'winter'
  if (lower === 'spring') return 'spring'
  if (lower === 'summer') return 'summer'
  if (lower === 'fall' || lower === 'autumn') return 'fall'
  return null
}

export function SeasonalTrends({ data }: SeasonalTrendsProps) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          Seasonal Trends
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          No seasonal data available yet. Start tracking anime to see your seasonal trends.
        </p>
      </div>
    )
  }

  // Aggregate by season name
  const seasonTotals: Record<SeasonKey, number> = { winter: 0, spring: 0, summer: 0, fall: 0 }
  for (const entry of data) {
    const key = normalizeSeason(entry.season)
    if (key) seasonTotals[key] += entry.count
  }

  // Sort entries by year desc, then by season order, take top 10
  const seasonOrder: SeasonKey[] = ['winter', 'spring', 'summer', 'fall']
  const sorted = [...data]
    .filter((e) => normalizeSeason(e.season) !== null)
    .sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year
      return seasonOrder.indexOf(normalizeSeason(a.season)!) - seasonOrder.indexOf(normalizeSeason(b.season)!)
    })
    .slice(0, 10)

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
        Seasonal Trends
      </h2>

      {/* Season cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {seasonOrder.map((key) => {
          const cfg = SEASON_CONFIG[key]
          const Icon = cfg.icon
          const total = seasonTotals[key]
          return (
            <div
              key={key}
              className="rounded-xl p-4 transition-colors"
              style={{ backgroundColor: cfg.bg }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={18} style={{ color: cfg.accent }} />
                <span className="text-sm font-medium text-[var(--color-text-secondary)]">
                  {cfg.label}
                </span>
              </div>
              <p className="text-2xl font-bold text-[var(--color-text-primary)]">{total}</p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                anime
              </p>
            </div>
          )
        })}
      </div>

      {/* Recent Seasons list */}
      {sorted.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">
            Recent Seasons
          </h3>
          <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
            {sorted.map((entry) => {
              const key = normalizeSeason(entry.season)!
              const cfg = SEASON_CONFIG[key]
              const Icon = cfg.icon
              return (
                <div
                  key={`${entry.season}-${entry.year}`}
                  className="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  <div className="flex items-center gap-2">
                    <Icon size={14} style={{ color: cfg.accent }} />
                    <span className="text-sm text-[var(--color-text-primary)]">
                      {cfg.label} {entry.year}
                    </span>
                  </div>
                  <span className="text-sm text-[var(--color-text-secondary)]">
                    {entry.count} anime
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
