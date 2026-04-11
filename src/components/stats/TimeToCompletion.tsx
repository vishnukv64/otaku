/**
 * TimeToCompletion — shows how long it takes the user to finish a series,
 * with average, fastest, and slowest stats.
 */

import { Clock, Zap, Timer } from 'lucide-react'
import type { TimeToCompletion as TimeToCompletionData } from '@/utils/tauri-commands'

interface TimeToCompletionProps {
  data: TimeToCompletionData | null
}

function formatDays(days: number): string {
  if (days <= 0) return '< 1 day'
  if (days > 365) {
    const years = Math.floor(days / 365)
    const remainder = Math.round(days % 365)
    if (remainder === 0) return `${years} year${years !== 1 ? 's' : ''}`
    const months = Math.round(remainder / 30)
    if (months > 0) return `${years}y ${months}mo`
    return `${years} year${years !== 1 ? 's' : ''}`
  }
  if (days > 30) {
    const months = Math.round(days / 30)
    return `${months} month${months !== 1 ? 's' : ''}`
  }
  return `${Math.round(days)} day${Math.round(days) !== 1 ? 's' : ''}`
}

function truncateTitle(title: string, max: number = 28): string {
  if (title.length <= max) return title
  return title.slice(0, max - 1).trimEnd() + '\u2026'
}

export function TimeToCompletion({ data }: TimeToCompletionProps) {
  if (!data || data.total_completed === 0) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          Time to Complete
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          No completion data yet. Finish a series to see how fast you go.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
        Time to Complete
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Average */}
        <div className="p-5 rounded-xl bg-[var(--color-surface-subtle)] transition-colors hover:bg-[var(--color-surface-hover)]">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[var(--color-text-tertiary)]">
              <Clock size={18} />
            </div>
            <span className="text-sm text-[var(--color-text-secondary)]">Average</span>
          </div>
          <p className="text-xl font-bold text-[var(--color-text-primary)]">
            {formatDays(data.avg_days)}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">per series</p>
        </div>

        {/* Fastest */}
        <div className="p-5 rounded-xl bg-[var(--color-surface-subtle)] transition-colors hover:bg-[var(--color-surface-hover)]">
          <div className="flex items-center gap-2 mb-3">
            <div style={{ color: 'var(--color-green)' }}>
              <Zap size={18} />
            </div>
            <span className="text-sm text-[var(--color-text-secondary)]">Fastest</span>
          </div>
          <p className="text-xl font-bold text-[var(--color-text-primary)]">
            {formatDays(data.fastest_days)}
          </p>
          {data.fastest_title && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1" title={data.fastest_title}>
              {truncateTitle(data.fastest_title)}
            </p>
          )}
        </div>

        {/* Slowest */}
        <div className="p-5 rounded-xl bg-[var(--color-surface-subtle)] transition-colors hover:bg-[var(--color-surface-hover)]">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[var(--color-text-muted)]">
              <Timer size={18} />
            </div>
            <span className="text-sm text-[var(--color-text-secondary)]">Slowest</span>
          </div>
          <p className="text-xl font-bold text-[var(--color-text-primary)]">
            {formatDays(data.slowest_days)}
          </p>
          {data.slowest_title && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1" title={data.slowest_title}>
              {truncateTitle(data.slowest_title)}
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-[var(--color-text-muted)] mt-4">
        Based on {data.total_completed} completed series
      </p>
    </div>
  )
}
