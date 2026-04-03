/**
 * StreaksAndFun — streak counters, binge records, fun stats
 */

import { Flame, Trophy, Calendar, Zap, Clock } from 'lucide-react'
import type { StreakStats, ActivityPatterns, BingeStats } from '@/utils/tauri-commands'

interface StreaksAndFunProps {
  streaks: StreakStats | null
  patterns: ActivityPatterns | null
  binge: BingeStats | null
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatDateRange(start: string, end: string): string {
  if (!start || !end) return ''
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${fmt(s)} - ${fmt(e)}`
}

interface TileProps {
  icon: React.ReactNode
  label: string
  value: string
  subtitle?: string
}

function Tile({ icon, label, value, subtitle }: TileProps) {
  return (
    <div className="p-5 rounded-xl bg-[var(--color-surface-subtle)] transition-colors hover:bg-[var(--color-surface-hover)]">
      <div className="flex items-center gap-2 mb-3">
        <div className="text-[var(--color-text-tertiary)]">{icon}</div>
        <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
      </div>
      <p className="text-xl font-bold text-[var(--color-text-primary)]">{value}</p>
      {subtitle && <p className="text-xs text-[var(--color-text-tertiary)] mt-1">{subtitle}</p>}
    </div>
  )
}

export function StreaksAndFun({ streaks, patterns, binge }: StreaksAndFunProps) {
  const currentStreak = streaks?.current_streak_days ?? 0
  const longestStreak = streaks?.longest_streak_days ?? 0

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
        Streaks & Fun Stats
      </h2>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Current Streak */}
        <Tile
          icon={currentStreak > 0 ? <Flame size={18} /> : <Calendar size={18} />}
          label="Current Streak"
          value={
            currentStreak > 0 ? `${currentStreak} day${currentStreak !== 1 ? 's' : ''}` : '0 days'
          }
          subtitle={currentStreak === 0 ? 'Watch or read something today!' : undefined}
        />

        {/* Longest Streak */}
        <Tile
          icon={<Trophy size={18} />}
          label="Longest Streak"
          value={`${longestStreak} day${longestStreak !== 1 ? 's' : ''}`}
          subtitle={
            longestStreak > 0 && streaks
              ? formatDateRange(streaks.longest_streak_start, streaks.longest_streak_end)
              : undefined
          }
        />

        {/* Most Active Day */}
        <Tile
          icon={<Calendar size={18} />}
          label="Most Active Day"
          value={patterns?.most_active_day || '--'}
          subtitle={
            patterns && patterns.avg_daily_minutes > 0
              ? `avg ${formatMinutes(patterns.avg_daily_minutes)}/day`
              : undefined
          }
        />

        {/* Binge Record - Anime */}
        {binge && binge.max_episodes_in_day > 0 && (
          <Tile
            icon={<Zap size={18} />}
            label="Anime Binge Record"
            value={`${binge.max_episodes_in_day} episodes`}
            subtitle={`${binge.max_episodes_anime_title} (${binge.max_episodes_date})`}
          />
        )}

        {/* Binge Record - Manga */}
        {binge && binge.max_chapters_in_day > 0 && (
          <Tile
            icon={<Zap size={18} />}
            label="Manga Binge Record"
            value={`${binge.max_chapters_in_day} chapters`}
            subtitle={`${binge.max_chapters_manga_title} (${binge.max_chapters_date})`}
          />
        )}

        {/* Average Daily Span */}
        {patterns && patterns.avg_daily_span_minutes > 0 && (
          <Tile
            icon={<Clock size={18} />}
            label="Avg Daily Span"
            value={formatMinutes(patterns.avg_daily_span_minutes)}
            subtitle="Time between first & last activity"
          />
        )}
      </div>
    </div>
  )
}
