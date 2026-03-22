/**
 * ActivityChart — recharts AreaChart with period toggle (7D/30D/90D/All)
 */

import { useState, useEffect, useCallback } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { getDailyActivity } from '@/utils/tauri-commands'
import type { DailyActivity } from '@/utils/tauri-commands'
import { BarChart3 } from 'lucide-react'

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
    <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-3 shadow-lg text-sm">
      <p className="text-[var(--color-text-secondary)] mb-1">{formatDateLabel(label)}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-[var(--color-text-primary)]">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full mr-2"
            style={{ backgroundColor: entry.dataKey === 'watch_minutes' ? '#3b82f6' : '#8b5cf6' }}
          />
          {entry.dataKey === 'watch_minutes' ? 'Anime' : 'Manga'}:{' '}
          {Math.round(entry.value)} min
          {entry.dataKey === 'read_minutes' ? ' (estimated)' : ''}
        </p>
      ))}
    </div>
  )
}

export function ActivityChart() {
  const [selectedPeriod, setSelectedPeriod] = useState(1) // 30D default
  const [data, setData] = useState<DailyActivity[] | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async (days: number) => {
    setLoading(true)
    try {
      const result = await getDailyActivity(days)
      setData(result)
    } catch (err) {
      console.error('Failed to fetch daily activity:', err)
      setData([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(periods[selectedPeriod].days)
  }, [selectedPeriod, fetchData])

  const isEmpty = !data || data.length === 0 || data.every((d) => d.watch_minutes === 0 && d.read_minutes === 0)

  return (
    <div className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: '#3b82f620' }}>
            <BarChart3 size={20} className="text-blue-500" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Activity</h2>
        </div>
        <div className="flex gap-1 rounded-lg bg-[var(--color-surface-subtle)] p-1">
          {periods.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setSelectedPeriod(i)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                selectedPeriod === i
                  ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
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
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
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
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorManga" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
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
                stroke="#3b82f6"
                fill="url(#colorAnime)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="read_minutes"
                stroke="#8b5cf6"
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
            <span className="w-3 h-3 rounded-full bg-blue-500" />
            Anime
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-purple-500" />
            Manga (estimated)
          </div>
        </div>
      )}
    </div>
  )
}
