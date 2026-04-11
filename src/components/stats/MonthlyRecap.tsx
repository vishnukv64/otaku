/**
 * MonthlyRecap — this month's activity summary, styled consistently
 * with the rest of the stats page.
 */

import { Tv, BookOpen, Clock, Plus, Trophy, Tag, CalendarDays } from 'lucide-react'
import type { MonthlyRecap as MonthlyRecapData } from '@/utils/tauri-commands'

interface MonthlyRecapProps {
  data: MonthlyRecapData | null
}

function formatTime(seconds: number): string {
  if (seconds <= 0) return '0m'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.round((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 || parts.length === 0) parts.push(`${m}m`)
  return parts.join(' ')
}

function formatMonthTitle(month: string): string {
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [year, mon] = month.split('-')
    const date = new Date(Number(year), Number(mon) - 1)
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  return month
}

interface StatTileProps {
  icon: React.ReactNode
  value: string
  label: string
  iconColor?: string
}

function StatTile({ icon, value, label, iconColor }: StatTileProps) {
  return (
    <div className="p-3 rounded-lg bg-[var(--color-surface-hover)] transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <div className={iconColor || 'text-[var(--color-text-tertiary)]'}>{icon}</div>
        <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      </div>
      <span className="text-lg font-bold text-[var(--color-text-primary)]">{value}</span>
    </div>
  )
}

export function MonthlyRecap({ data }: MonthlyRecapProps) {
  if (!data) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Monthly Recap</h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-2">No recap data available yet.</p>
      </div>
    )
  }

  const isEmpty =
    data.episodes_watched === 0 &&
    data.chapters_read === 0 &&
    data.time_watched_seconds === 0 &&
    data.new_series_started === 0 &&
    data.series_completed === 0

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="text-[var(--color-info)]">
          <CalendarDays size={20} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {formatMonthTitle(data.month)}
          </h2>
          <p className="text-xs text-[var(--color-text-muted)]">This month&apos;s activity</p>
        </div>
      </div>

      {/* Content */}
      {isEmpty ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          No activity this month yet — start watching!
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatTile
            icon={<Tv size={15} />}
            value={data.episodes_watched.toLocaleString()}
            label="Episodes"
            iconColor="text-[var(--color-accent-primary)]"
          />
          <StatTile
            icon={<BookOpen size={15} />}
            value={data.chapters_read.toLocaleString()}
            label="Chapters"
            iconColor="text-[var(--color-green)]"
          />
          <StatTile
            icon={<Clock size={15} />}
            value={formatTime(data.time_watched_seconds)}
            label="Time"
            iconColor="text-[var(--color-info)]"
          />
          <StatTile
            icon={<Plus size={15} />}
            value={data.new_series_started.toLocaleString()}
            label="New Series"
          />
          <StatTile
            icon={<Trophy size={15} />}
            value={data.series_completed.toLocaleString()}
            label="Completed"
            iconColor="text-[var(--color-gold)]"
          />
          {data.top_genre && (
            <StatTile
              icon={<Tag size={15} />}
              value={data.top_genre}
              label="Top Genre"
            />
          )}
        </div>
      )}
    </div>
  )
}
