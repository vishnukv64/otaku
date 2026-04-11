/**
 * CompletionFunnel — Shows how many series users start vs complete (finish rate)
 * with horizontal progress bars for anime and manga.
 */

import type { CompletionRateStats } from '@/utils/tauri-commands'

interface CompletionFunnelProps {
  data: CompletionRateStats | null
}

function FunnelBar({
  label,
  started,
  completed,
  rate,
  color,
}: {
  label: string
  started: number
  completed: number
  rate: number
  color: string
}) {
  const isEmpty = started === 0 && completed === 0

  return (
    <div className="flex-1 min-w-0">
      <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">{label}</h3>

      {isEmpty ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">
          {label === 'Anime' ? 'Start watching to track!' : 'Start reading to track!'}
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-bold text-[var(--color-text-primary)]">
              {Math.round(rate)}%
            </span>
            <span className="text-sm text-[var(--color-text-tertiary)]">finish rate</span>
          </div>

          <div className="h-3 rounded-full bg-[var(--color-surface-hover)] overflow-hidden mb-2">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${Math.max(rate, 2)}%`,
                backgroundColor: color,
              }}
            />
          </div>

          <p className="text-xs text-[var(--color-text-tertiary)]">
            {started} started → {completed} completed
          </p>
        </>
      )}
    </div>
  )
}

export function CompletionFunnel({ data }: CompletionFunnelProps) {
  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">
        Completion Rate
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        <FunnelBar
          label="Anime"
          started={data?.anime_started ?? 0}
          completed={data?.anime_completed ?? 0}
          rate={data?.anime_rate ?? 0}
          color="rgba(229, 9, 20, 0.9)"
        />
        <FunnelBar
          label="Manga"
          started={data?.manga_started ?? 0}
          completed={data?.manga_completed ?? 0}
          rate={data?.manga_rate ?? 0}
          color="rgba(59, 130, 246, 0.9)"
        />
      </div>
    </div>
  )
}
