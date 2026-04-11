/**
 * WatchCompletionRate — circular progress ring showing average episode
 * completion percentage, plus supporting stats.
 */

import type { WatchCompletionRateStats } from '@/utils/tauri-commands'

interface WatchCompletionRateProps {
  data: WatchCompletionRateStats | null
}

function ProgressRing({ percent }: { percent: number }) {
  const size = 140
  const strokeWidth = 12
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (percent / 100) * circumference
  const gap = circumference - filled

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-surface-hover)"
          strokeWidth={strokeWidth}
        />
        {/* Filled arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-green)"
          strokeWidth={strokeWidth}
          strokeDasharray={`${filled} ${gap}`}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-[var(--color-text-primary)]">
          {Math.round(percent)}%
        </span>
      </div>
    </div>
  )
}

export function WatchCompletionRate({ data }: WatchCompletionRateProps) {
  const avgCompletion = data?.avg_completion_percent ?? null
  const fullyWatched = data?.fully_watched_percent ?? null
  const totalEpisodes = data?.total_episodes ?? null

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">
        Episode Completion
      </h2>

      <div className="flex flex-col items-center gap-4">
        <ProgressRing percent={avgCompletion ?? 0} />

        <div className="text-center space-y-1.5">
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">
            Avg Episode Completion
          </p>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            {fullyWatched !== null ? `${Math.round(fullyWatched)}%` : '--'} of episodes fully
            watched
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            Based on {totalEpisodes !== null ? totalEpisodes.toLocaleString() : '--'} episodes
          </p>
        </div>
      </div>
    </div>
  )
}
