/**
 * TimelineView — Date-grouped chronological list with infinite scroll.
 *
 * Groups entries by: "Today", "Yesterday", then "March 20, 2026" etc.
 * Uses IntersectionObserver at the bottom sentinel for pagination.
 */

import { useRef, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { HistoryEntry } from './HistoryEntry'
import type { HistoryEntry as HistoryEntryType } from '@/utils/tauri-commands'

interface TimelineViewProps {
  entries: HistoryEntryType[]
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
  onEntryRemoved: (entry: HistoryEntryType) => void
}

function groupByDate(entries: HistoryEntryType[]): Map<string, HistoryEntryType[]> {
  const groups = new Map<string, HistoryEntryType[]>()
  const now = new Date()
  const todayStr = now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toDateString()

  for (const entry of entries) {
    const entryDate = new Date(entry.timestamp)
    const dateStr = entryDate.toDateString()

    let label: string
    if (dateStr === todayStr) {
      label = 'Today'
    } else if (dateStr === yesterdayStr) {
      label = 'Yesterday'
    } else {
      label = entryDate.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    }

    const group = groups.get(label) ?? []
    group.push(entry)
    groups.set(label, group)
  }

  return groups
}

export function TimelineView({ entries, loading, hasMore, onLoadMore, onEntryRemoved }: TimelineViewProps) {
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

  if (entries.length === 0 && !loading) {
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

  const dateGroups = groupByDate(entries)

  return (
    <div className="space-y-6">
      {Array.from(dateGroups.entries()).map(([label, groupEntries]) => (
        <div key={label}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2 px-3">
            {label}
          </h3>
          <div className="space-y-0.5">
            {groupEntries.map((entry) => {
              const key = entry.type === 'watch'
                ? `w-${entry.media.id}-${entry.episode_id}`
                : `r-${entry.media.id}-${entry.chapter_id}`
              return (
                <HistoryEntry
                  key={key}
                  entry={entry}
                  onRemoved={onEntryRemoved}
                />
              )
            })}
          </div>
        </div>
      ))}

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
