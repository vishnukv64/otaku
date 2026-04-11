/**
 * RatingComparison — table showing where user ratings diverge most from public consensus
 */

import { ArrowUp, ArrowDown } from 'lucide-react'
import type { RatingComparisonEntry } from '@/utils/tauri-commands'

interface RatingComparisonProps {
  data: RatingComparisonEntry[] | null
}

/** Normalize a rating to 0-10 scale (handles APIs that return 0-100) */
function normalizeRating(value: number): number {
  return value > 10 ? value / 10 : value
}

export function RatingComparison({ data }: RatingComparisonProps) {
  if (!data) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
          You vs The Crowd
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">No comparison data available yet.</p>
      </div>
    )
  }

  const entries = data.filter((e) => e.difference !== 0).slice(0, 10)

  if (entries.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
          You vs The Crowd
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mt-2">
          Your ratings match the crowd!
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          You vs The Crowd
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
          Where your taste diverges the most
        </p>
      </div>

      <div className="space-y-2">
        {entries.map((entry) => {
          const isPositive = entry.difference > 0
          const displayPublic = normalizeRating(entry.public_rating)
          const absDiff = Math.abs(entry.difference)

          return (
            <div
              key={entry.title}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              {/* Cover image */}
              {entry.cover_url ? (
                <img
                  src={entry.cover_url}
                  alt=""
                  className="w-8 h-11 rounded object-cover shrink-0"
                />
              ) : (
                <div className="w-8 h-11 rounded bg-[var(--color-surface-hover)] shrink-0" />
              )}

              {/* Title */}
              <span className="flex-1 text-sm text-[var(--color-text-primary)] truncate">
                {entry.title}
              </span>

              {/* User score */}
              <span className="text-sm font-medium text-[var(--color-text-secondary)] w-10 text-right shrink-0">
                {entry.user_score.toFixed(1)}
              </span>

              {/* vs label */}
              <span className="text-xs text-[var(--color-text-muted)] shrink-0">vs</span>

              {/* Public rating */}
              <span className="text-sm font-medium text-[var(--color-text-secondary)] w-10 text-right shrink-0">
                {displayPublic.toFixed(1)}
              </span>

              {/* Difference badge */}
              <div
                className="flex items-center gap-0.5 shrink-0 w-16 justify-end"
                style={{
                  color: isPositive ? 'var(--color-green)' : 'var(--color-accent-primary)',
                }}
              >
                {isPositive ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                <span className="text-sm font-semibold">
                  {isPositive ? '+' : '-'}
                  {absDiff.toFixed(1)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
