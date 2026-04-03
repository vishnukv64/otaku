/**
 * CompletionRings — SVG donut ring charts for anime/manga library status
 */

import type { CompletionStats, CompletionStatsCategory } from '@/utils/tauri-commands'

interface CompletionRingsProps {
  data: CompletionStats | null
}

interface RingSegment {
  label: string
  value: number
  color: string
}

function getSegments(cat: CompletionStatsCategory, hue: 'red' | 'indigo' = 'red'): RingSegment[] {
  const colors =
    hue === 'indigo'
      ? { completed: 'rgba(99, 102, 241, 0.9)', watching: 'rgba(99, 102, 241, 0.55)' }
      : { completed: 'rgba(229, 9, 20, 0.9)', watching: 'rgba(229, 9, 20, 0.55)' }

  return [
    { label: 'Completed', value: cat.completed, color: colors.completed },
    { label: 'Watching', value: cat.watching, color: colors.watching },
    { label: 'On Hold', value: cat.on_hold, color: 'rgba(255, 255, 255, 0.25)' },
    { label: 'Dropped', value: cat.dropped, color: 'rgba(255, 255, 255, 0.12)' },
    { label: 'Plan to Watch', value: cat.plan_to_watch, color: 'rgba(255, 255, 255, 0.06)' },
  ]
}

function DonutRing({
  title,
  segments,
  total,
}: {
  title: string
  segments: RingSegment[]
  total: number
}) {
  const size = 160
  const strokeWidth = 16
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  let cumulativeOffset = 0

  return (
    <div className="flex flex-col items-center gap-4">
      <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">{title}</h3>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-surface-hover)"
            strokeWidth={strokeWidth}
          />
          {/* Segments */}
          {total > 0 &&
            segments.map((seg) => {
              if (seg.value === 0) return null
              const segLength = (seg.value / total) * circumference
              const offset = circumference - cumulativeOffset
              cumulativeOffset += segLength
              return (
                <circle
                  key={seg.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${segLength} ${circumference - segLength}`}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  className="transition-all duration-500"
                />
              )
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-[var(--color-text-primary)]">{total}</span>
          <span className="text-xs text-[var(--color-text-tertiary)]">total</span>
        </div>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-[var(--color-text-secondary)]">
              {seg.label}: {seg.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CompletionRings({ data }: CompletionRingsProps) {
  const animeSegments = data
    ? getSegments(data.anime)
    : getSegments({ watching: 0, completed: 0, on_hold: 0, dropped: 0, plan_to_watch: 0 })
  const mangaSegments = data
    ? getSegments(
        {
          watching: data.manga.watching,
          completed: data.manga.completed,
          on_hold: data.manga.on_hold,
          dropped: data.manga.dropped,
          plan_to_watch: data.manga.plan_to_watch,
        },
        'indigo'
      )
    : getSegments({ watching: 0, completed: 0, on_hold: 0, dropped: 0, plan_to_watch: 0 }, 'indigo')

  // Relabel for manga
  const mangaLabeled = mangaSegments.map((s) => ({
    ...s,
    label:
      s.label === 'Watching' ? 'Reading' : s.label === 'Plan to Watch' ? 'Plan to Read' : s.label,
  }))

  const animeTotal = animeSegments.reduce((sum, s) => sum + s.value, 0)
  const mangaTotal = mangaLabeled.reduce((sum, s) => sum + s.value, 0)

  const isEmpty = animeTotal === 0 && mangaTotal === 0

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">
        Library Status
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 justify-items-center">
        <DonutRing title="Anime" segments={animeSegments} total={animeTotal} />
        <DonutRing title="Manga" segments={mangaLabeled} total={mangaTotal} />
      </div>

      {isEmpty && (
        <p className="text-center text-sm text-[var(--color-text-tertiary)] mt-4">
          Add anime or manga to your library to track progress
        </p>
      )}
    </div>
  )
}
