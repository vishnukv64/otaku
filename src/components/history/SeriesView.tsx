/**
 * SeriesView — Per-anime/manga card grid with expand.
 *
 * Uses IntersectionObserver for infinite scroll pagination.
 */

import { useRef, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { SeriesCard } from './SeriesCard'
import type { MediaHistorySummary, HistoryEntry as HistoryEntryType } from '@/utils/tauri-commands'

interface SeriesViewProps {
  summaries: MediaHistorySummary[]
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
  onEntryRemoved: (entry: HistoryEntryType) => void
}

export function SeriesView({ summaries, loading, hasMore, onLoadMore, onEntryRemoved }: SeriesViewProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  const handleIntersection = useCallback(
    (observerEntries: IntersectionObserverEntry[]) => {
      if (observerEntries[0]?.isIntersecting && hasMore && !loading) {
        onLoadMore()
      }
    },
    [hasMore, loading, onLoadMore],
  )

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(handleIntersection, {
      rootMargin: '200px',
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [handleIntersection])

  if (summaries.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-5xl mb-4">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--color-text-dim)]">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-[var(--color-text-secondary)] mb-1">
          No history yet
        </h3>
        <p className="text-sm text-[var(--color-text-muted)] text-center max-w-xs">
          Start watching or reading to see your activity here
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 gap-3">
        {summaries.map((summary) => (
          <SeriesCard
            key={`${summary.type}-${summary.media.id}`}
            summary={summary}
            onEntryRemoved={onEntryRemoved}
          />
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-1" />

      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
        </div>
      )}
    </div>
  )
}
