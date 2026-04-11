/**
 * ScoreDistribution — vertical bar chart histogram of user ratings (1-10)
 */

import type { ScoreDistribution as ScoreDistributionData } from '@/utils/tauri-commands'

interface ScoreDistributionProps {
  data: ScoreDistributionData | null
}

export function ScoreDistribution({ data }: ScoreDistributionProps) {
  if (!data) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">
          Your Ratings
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">No rating data available yet.</p>
      </div>
    )
  }

  // Build a lookup from entries, filling all 10 score slots
  const countByScore = new Map(data.entries.map((e) => [e.score, e.count]))
  const scores = Array.from({ length: 10 }, (_, i) => {
    const score = i + 1
    return { score, count: countByScore.get(score) ?? 0 }
  })

  const maxCount = Math.max(...scores.map((s) => s.count), 1)

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">Your Ratings</h2>

      {/* Bar chart */}
      <div className="flex items-end justify-between gap-2" style={{ height: 180 }}>
        {scores.map(({ score, count }) => {
          const heightPct = maxCount > 0 ? (count / maxCount) * 100 : 0
          // Opacity ranges from 0.3 (lowest count) to 1.0 (highest)
          const opacity = count === 0 ? 0.15 : 0.3 + (count / maxCount) * 0.7

          return (
            <div key={score} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
              {/* Count label above bar */}
              <span className="text-xs font-medium text-[var(--color-text-tertiary)]">
                {count > 0 ? count : ''}
              </span>

              {/* Bar */}
              <div
                className="w-full rounded-t-md transition-all duration-300"
                style={{
                  height: `${Math.max(heightPct, count > 0 ? 4 : 1)}%`,
                  backgroundColor: `rgba(229, 9, 20, ${opacity})`,
                  minHeight: 4,
                }}
              />

              {/* Score label below bar */}
              <span className="text-xs font-medium text-[var(--color-text-secondary)] mt-1">
                {score}
              </span>
            </div>
          )
        })}
      </div>

      {/* Summary row */}
      <div className="flex items-center justify-between mt-5 pt-4 border-t border-[var(--color-surface-hover)]">
        <span className="text-sm text-[var(--color-text-secondary)]">
          Average:{' '}
          <span className="font-semibold text-[var(--color-text-primary)]">
            {data.average_score.toFixed(1)}
          </span>
        </span>
        <span className="text-sm text-[var(--color-text-secondary)]">
          Total Rated:{' '}
          <span className="font-semibold text-[var(--color-text-primary)]">
            {data.total_rated.toLocaleString()}
          </span>
        </span>
      </div>
    </div>
  )
}
