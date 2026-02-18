import type { JikanStatistics } from '@/utils/tauri-commands'

interface ScoreDistributionProps {
  statistics: JikanStatistics
  loading?: boolean
  mediaType: 'anime' | 'manga'
}

export function ScoreDistribution({ statistics, loading, mediaType }: ScoreDistributionProps) {
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-6 h-5 bg-[var(--color-bg-hover)] rounded" />
            <div className="flex-1 h-5 bg-[var(--color-bg-hover)] rounded" />
            <div className="w-12 h-5 bg-[var(--color-bg-hover)] rounded" />
          </div>
        ))}
      </div>
    )
  }

  const scores = statistics.scores || []
  const maxVotes = Math.max(...scores.map(s => s.votes), 1)

  const aggregateStats = mediaType === 'anime'
    ? [
        { label: 'Watching', value: statistics.watching },
        { label: 'Completed', value: statistics.completed },
        { label: 'On Hold', value: statistics.on_hold },
        { label: 'Dropped', value: statistics.dropped },
        { label: 'Plan to Watch', value: statistics.plan_to_watch },
      ]
    : [
        { label: 'Reading', value: statistics.reading },
        { label: 'Completed', value: statistics.completed },
        { label: 'On Hold', value: statistics.on_hold },
        { label: 'Dropped', value: statistics.dropped },
        { label: 'Plan to Read', value: statistics.plan_to_read },
      ]

  const formatNumber = (n?: number | null) => {
    if (n == null) return '0'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
  }

  return (
    <div className="space-y-6">
      {/* Score Distribution Bars */}
      {scores.length > 0 && (
        <div className="space-y-1.5">
          {[...scores].reverse().map((entry) => (
            <div key={entry.score} className="flex items-center gap-2 sm:gap-3">
              <span className="text-xs sm:text-sm text-[var(--color-text-secondary)] w-4 sm:w-6 text-right shrink-0">
                {entry.score}
              </span>
              <div className="flex-1 bg-[var(--color-bg-secondary)] rounded-full h-5 sm:h-5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max((entry.votes / maxVotes) * 100, 1)}%`,
                    backgroundColor: getScoreColor(entry.score),
                  }}
                />
              </div>
              <span className="text-xs text-[var(--color-text-muted)] w-14 sm:w-20 text-right shrink-0">
                {entry.percentage.toFixed(1)}%
                <span className="hidden sm:inline ml-1">({formatNumber(entry.votes)})</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Aggregate Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 lg:gap-4">
        {aggregateStats.map((stat) => (
          <div
            key={stat.label}
            className="bg-[var(--color-bg-secondary)] rounded-lg p-3 text-center"
          >
            <p className="text-lg sm:text-xl font-bold text-[var(--color-text-primary)]">
              {formatNumber(stat.value)}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {stat.label}
            </p>
          </div>
        ))}
        {statistics.total != null && (
          <div className="bg-[var(--color-bg-secondary)] rounded-lg p-3 text-center">
            <p className="text-lg sm:text-xl font-bold text-[var(--color-accent-primary)]">
              {formatNumber(statistics.total)}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Total</p>
          </div>
        )}
      </div>
    </div>
  )
}

function getScoreColor(score: number): string {
  if (score >= 9) return '#22c55e'
  if (score >= 7) return '#84cc16'
  if (score >= 5) return '#eab308'
  if (score >= 3) return '#f97316'
  return '#ef4444'
}
