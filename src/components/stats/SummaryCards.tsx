/**
 * SummaryCards — 4 stat cards: Time Watched, Episodes Completed, Chapters Read, Series Completed
 */

import { Clock, Tv, BookOpen, Trophy } from 'lucide-react'
import type { WatchStatsSummary, ReadingStatsSummary } from '@/utils/tauri-commands'

interface SummaryCardsProps {
  watchStats: WatchStatsSummary | null
  readingStats: ReadingStatsSummary | null
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0m'
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)
  return parts.join(' ')
}

export function SummaryCards({ watchStats, readingStats }: SummaryCardsProps) {
  const cards = [
    {
      icon: <Clock size={20} />,
      label: 'Time Watched',
      value: watchStats ? formatDuration(watchStats.total_time_seconds) : '--',
    },
    {
      icon: <Tv size={20} />,
      label: 'Episodes Completed',
      value: watchStats ? watchStats.episodes_completed.toLocaleString() : '--',
    },
    {
      icon: <BookOpen size={20} />,
      label: 'Chapters Read',
      value: readingStats ? readingStats.total_chapters_completed.toLocaleString() : '--',
    },
    {
      icon: <Trophy size={20} />,
      label: 'Series Completed',
      value:
        watchStats && readingStats
          ? (watchStats.series_completed + readingStats.series_completed).toLocaleString()
          : watchStats
            ? watchStats.series_completed.toLocaleString()
            : readingStats
              ? readingStats.series_completed.toLocaleString()
              : '--',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="p-5 rounded-xl bg-[var(--color-surface-subtle)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[var(--color-text-tertiary)]">{card.icon}</div>
            <span className="text-sm font-medium text-[var(--color-text-secondary)]">
              {card.label}
            </span>
          </div>
          <p className="text-3xl font-bold text-[var(--color-text-primary)]">{card.value}</p>
        </div>
      ))}
    </div>
  )
}
