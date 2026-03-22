/**
 * ActivityChart — recharts AreaChart with period toggle (7D/30D/90D/All)
 */

import { useState, useEffect, useCallback } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { getDailyActivity } from '@/utils/tauri-commands'
import type { DailyActivity } from '@/utils/tauri-commands'

const periods = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: 'All', days: 0 },
] as const

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string }>
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !label) return null
  return (
    <div className="rounded-lg bg-[var(--color-surface-hover)] p-3 shadow-lg text-sm">
      <p className="text-[var(--color-text-secondary)] mb-1">{formatDateLabel(label)}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-[var(--color-text-primary)]">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full mr-2"
            style={{ backgroundColor: entry.dataKey === 'watch_minutes' ? 'var(--color-accent-primary)' : 'rgba(229,9,20,0.5)' }}
          />
          {entry.dataKey === 'watch_minutes' ? 'Anime' : 'Manga'}:{' '}
          {Math.round(entry.value)} min
          {entry.dataKey === 'read_minutes' ? ' (estimated)' : ''}
        </p>
      ))}
    </div>
  )
}

interface ActivityChartProps {
  /** Pre-fetched 30-day data from StatsPage to avoid SQLite pool contention on mount.
   *  null = still loading, undefined = not provided (fallback to self-fetch). */
  initialData?: DailyActivity[] | null
}

export function ActivityChart({ initialData }: ActivityChartProps) {
  const [selectedPeriod, setSelectedPeriod] = useState(1) // 30D default
  const [data, setData] = useState<DailyActivity[]>([])
  const [loading, setLoading] = useState(false)

  const fetchData = useCallback(async (days: number) => {
    setLoading(true)
    try {
      // Race against a timeout so a hung invoke never causes a perpetual spinner
      const result = await Promise.race([
        getDailyActivity(days),
        new Promise<DailyActivity[]>((_, reject) =>
          setTimeout(() => reject(new Error('Activity fetch timed out')), 10_000)
        ),
      ])
      setData(result)
    } catch (err) {
      console.error('Failed to fetch daily activity:', err)
      setData([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Seed data from parent-provided initial batch (30D), avoiding an extra DB call
  useEffect(() => {
    if (initialData != null && selectedPeriod === 1) {
      setData(initialData)
    }
  }, [initialData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch when user changes period, or when no initial data was provided
  useEffect(() => {
    // If parent already gave us 30D data, skip the redundant fetch
    if (selectedPeriod === 1 && initialData != null) return
    fetchData(periods[selectedPeriod].days)
  }, [selectedPeriod, fetchData, initialData])

  const isEmpty = !data || data.length === 0 || data.every((d) => d.watch_minutes === 0 && d.read_minutes === 0)

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Activity</h2>
        <div className="flex gap-1 rounded-lg bg-[var(--color-surface-hover)] p-1">
          {periods.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setSelectedPeriod(i)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                selectedPeriod === i
                  ? 'bg-[var(--color-accent-primary)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[var(--color-accent-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : isEmpty ? (
        <div className="h-64 flex items-center justify-center text-[var(--color-text-tertiary)]">
          Start watching or reading to see your activity trend
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data!} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <defs>
                <linearGradient id="colorAnime" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="rgba(229,9,20,0.8)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="rgba(229,9,20,0.8)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorManga" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="rgba(229,9,20,0.4)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="rgba(229,9,20,0.4)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={formatDateLabel}
                tick={{ fontSize: 12, fill: 'var(--color-text-tertiary)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: 'var(--color-text-tertiary)' }}
                axisLine={false}
                tickLine={false}
                width={40}
                tickFormatter={(v: number) => `${Math.round(v)}m`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="watch_minutes"
                stroke="rgba(229,9,20,0.9)"
                fill="url(#colorAnime)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="read_minutes"
                stroke="rgba(229,9,20,0.45)"
                fill="url(#colorManga)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Legend */}
      {!isEmpty && !loading && (
        <div className="flex items-center gap-6 mt-4 text-sm text-[var(--color-text-secondary)]">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[var(--color-accent-primary)]" />
            Anime
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[rgba(229,9,20,0.45)]" />
            Manga (estimated)
          </div>
        </div>
      )}
    </div>
  )
}
