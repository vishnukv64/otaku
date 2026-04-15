/**
 * ContentTypeBreakdown — SVG donut chart showing TV vs Movie vs OVA vs Special distribution.
 */

import type { ContentTypeEntry } from '@/utils/tauri-commands'

interface ContentTypeBreakdownProps {
  data: ContentTypeEntry[] | null
}

const TYPE_COLORS: Record<string, string> = {
  TV: 'rgba(229, 9, 20, 0.9)',
  Movie: 'rgba(59, 130, 246, 0.9)',
  OVA: 'rgba(245, 197, 24, 0.9)',
  Special: 'rgba(70, 211, 105, 0.9)',
  ONA: 'rgba(168, 85, 247, 0.9)',
}

const FALLBACK_COLOR = 'rgba(255, 255, 255, 0.25)'

function getColor(type: string): string {
  return TYPE_COLORS[type] ?? FALLBACK_COLOR
}

export function ContentTypeBreakdown({ data }: ContentTypeBreakdownProps) {
  const entries = data?.filter((e) => e.count > 0) ?? []
  const total = entries.reduce((sum, e) => sum + e.count, 0)
  const isEmpty = entries.length === 0

  const size = 160
  const strokeWidth = 16
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  // Precompute each segment's length and its starting offset so we never
  // mutate a variable during render (react-hooks/immutability).
  const segLengths = entries.map((e) => (e.count / total) * circumference)
  const segments = entries.map((entry, i) => ({
    entry,
    segLength: segLengths[i],
    offset: circumference - segLengths.slice(0, i).reduce((sum, len) => sum + len, 0),
  }))

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">
        Content Types
      </h2>

      {isEmpty ? (
        <p className="text-center text-sm text-[var(--color-text-tertiary)]">
          Add anime to your library to see content type breakdown
        </p>
      ) : (
        <div className="flex flex-col items-center gap-4">
          {/* Donut chart */}
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
              {segments.map(({ entry, segLength, offset }) => (
                <circle
                  key={entry.content_type}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={getColor(entry.content_type)}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${segLength} ${circumference - segLength}`}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  className="transition-all duration-500"
                />
              ))}
            </svg>
            {/* Center total */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-[var(--color-text-primary)]">{total}</span>
              <span className="text-xs text-[var(--color-text-tertiary)]">total</span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
            {entries.map((entry) => (
              <div key={entry.content_type} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: getColor(entry.content_type) }}
                />
                <span className="text-[var(--color-text-secondary)]">
                  {entry.content_type}: {entry.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
