/**
 * PeakHoursHeatmap — GitHub-style yearly contribution graph.
 * Fetches its own data via getDailyActivity(365).
 * 7 rows (Mon–Sun) × ~52 columns (weeks), colored by activity intensity.
 */

import { useEffect, useRef, useState } from 'react'
import { getDailyActivity } from '@/utils/tauri-commands'

const GAP = 3
const DAY_LABEL_WIDTH = 36
const MIN_CELL = 10
const MAX_CELL = 20
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface DayCell {
  date: string       // YYYY-MM-DD
  minutes: number
  weekIdx: number
  dayIdx: number     // 0=Mon … 6=Sun
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return 'No activity'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function getCellColor(minutes: number, maxMinutes: number): string {
  if (minutes === 0 || maxMinutes === 0) return 'rgba(255, 255, 255, 0.04)'
  // 4-level quantized scale like GitHub
  const ratio = minutes / maxMinutes
  if (ratio < 0.25) return 'rgba(229, 9, 20, 0.2)'
  if (ratio < 0.5) return 'rgba(229, 9, 20, 0.4)'
  if (ratio < 0.75) return 'rgba(229, 9, 20, 0.65)'
  return 'rgba(229, 9, 20, 0.9)'
}

function buildYearGrid(activityMap: Map<string, number>): { cells: DayCell[]; weeks: number; monthLabels: { label: string; weekIdx: number }[] } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Find the start: go back ~365 days then back to the previous Monday
  const start = new Date(today)
  start.setDate(start.getDate() - 364)
  // Adjust to Monday (JS: 0=Sun, 1=Mon ... 6=Sat)
  const jsDay = start.getDay()
  const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay
  start.setDate(start.getDate() + mondayOffset)

  const cells: DayCell[] = []
  const monthLabels: { label: string; weekIdx: number }[] = []
  let lastMonth = -1

  const cursor = new Date(start)
  let weekIdx = 0

  while (cursor <= today) {
    const jsD = cursor.getDay()
    const dayIdx = jsD === 0 ? 6 : jsD - 1 // Convert to 0=Mon ... 6=Sun
    const dateStr = cursor.toISOString().slice(0, 10)
    const minutes = activityMap.get(dateStr) || 0

    // Track month labels at first Monday of each month
    const month = cursor.getMonth()
    if (month !== lastMonth && dayIdx === 0) {
      monthLabels.push({ label: MONTH_NAMES[month], weekIdx })
      lastMonth = month
    }

    cells.push({ date: dateStr, minutes, weekIdx, dayIdx })

    // Advance
    cursor.setDate(cursor.getDate() + 1)
    if (dayIdx === 6) weekIdx++ // End of week (Sunday)
  }

  return { cells, weeks: weekIdx + 1, monthLabels }
}

export function PeakHoursHeatmap() {
  const [activityMap, setActivityMap] = useState<Map<string, number> | null>(null)
  const [tooltip, setTooltip] = useState<{ date: string; minutes: number; x: number; y: number } | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Measure container width
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fetch data
  useEffect(() => {
    getDailyActivity(365)
      .then((data) => {
        const map = new Map<string, number>()
        for (const d of data) {
          map.set(d.date, (d.watch_minutes || 0) + (d.read_minutes || 0))
        }
        setActivityMap(map)
      })
      .catch((e) => console.error('Heatmap fetch failed:', e))
  }, [])

  if (!activityMap) {
    return (
      <div ref={containerRef} className="rounded-xl bg-[var(--color-surface-subtle)] p-8">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Activity</h2>
        <div className="h-32 flex items-center justify-center text-[var(--color-text-tertiary)] text-sm">
          Loading...
        </div>
      </div>
    )
  }

  const { cells, weeks, monthLabels } = buildYearGrid(activityMap)
  const maxMinutes = Math.max(...cells.map((c) => c.minutes), 1)
  const totalDays = cells.filter((c) => c.minutes > 0).length
  const totalMinutes = cells.reduce((sum, c) => sum + c.minutes, 0)

  // Dynamic cell size: fill available width
  const availableWidth = containerWidth - DAY_LABEL_WIDTH - 64 // 64 = p-8 padding (32 each side)
  const cell = containerWidth > 0
    ? Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor((availableWidth - (weeks - 1) * GAP) / weeks)))
    : 14
  const step = cell + GAP
  const gridWidth = weeks * step - GAP
  const gridHeight = 7 * step - GAP

  return (
    <div ref={containerRef} className="rounded-xl bg-[var(--color-surface-subtle)] p-8">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Activity</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
            {totalDays} active days in the last year
            {totalMinutes > 0 && (
              <span className="ml-2 text-[var(--color-text-muted)]">
                ({formatMinutes(totalMinutes)} total)
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-6 relative">
        {/* Month labels row */}
        <div className="flex mb-2" style={{ paddingLeft: DAY_LABEL_WIDTH }}>
          {monthLabels.map((m, i) => {
            const nextWeek = i < monthLabels.length - 1 ? monthLabels[i + 1].weekIdx : weeks
            const spanWeeks = nextWeek - m.weekIdx
            return (
              <div
                key={`${m.label}-${m.weekIdx}`}
                className="text-xs text-[var(--color-text-tertiary)]"
                style={{ width: spanWeeks * step, flexShrink: 0 }}
              >
                {spanWeeks >= 2 ? m.label : ''}
              </div>
            )
          })}
        </div>

        <div className="flex">
          {/* Day labels */}
          <div className="flex flex-col shrink-0" style={{ width: DAY_LABEL_WIDTH, gap: GAP }}>
            {DAY_LABELS.map((label, i) => (
              <div
                key={label}
                className="text-xs text-[var(--color-text-tertiary)] flex items-center"
                style={{ height: cell }}
              >
                {i % 2 === 0 ? label : ''}
              </div>
            ))}
          </div>

          {/* Grid */}
          <svg width={gridWidth} height={gridHeight} className="flex-1">
            {cells.map((c) => (
              <rect
                key={c.date}
                x={c.weekIdx * step}
                y={c.dayIdx * step}
                width={cell}
                height={cell}
                rx={3}
                fill={getCellColor(c.minutes, maxMinutes)}
                className="cursor-pointer"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const parent = e.currentTarget.closest('.relative')?.getBoundingClientRect()
                  if (parent) {
                    setTooltip({
                      date: c.date,
                      minutes: c.minutes,
                      x: rect.left - parent.left + rect.width / 2,
                      y: rect.top - parent.top - 8,
                    })
                  }
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}
          </svg>
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute z-10 pointer-events-none rounded-lg bg-[var(--color-surface-hover)] border border-[var(--color-border,rgba(255,255,255,0.08))] px-3 py-2 shadow-lg text-sm"
            style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
          >
            <p className="text-[var(--color-text-primary)] font-medium">{formatMinutes(tooltip.minutes)}</p>
            <p className="text-[var(--color-text-tertiary)] text-xs">{formatDate(tooltip.date)}</p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-2 mt-5 text-xs text-[var(--color-text-tertiary)]">
        <span>Less</span>
        <div className="flex gap-[3px]">
          {['rgba(255,255,255,0.04)', 'rgba(229,9,20,0.2)', 'rgba(229,9,20,0.4)', 'rgba(229,9,20,0.65)', 'rgba(229,9,20,0.9)'].map((color) => (
            <div key={color} className="rounded-[3px]" style={{ width: cell, height: cell, backgroundColor: color }} />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  )
}
