/**
 * Milestones — achievement badges showing user progress milestones.
 * Achieved milestones appear first with a gold accent; unachieved are dimmed.
 */

import { Tv, BookOpen, Trophy, Compass, CheckCircle } from 'lucide-react'
import type { MilestoneStats, Milestone } from '@/utils/tauri-commands'

interface MilestonesProps {
  data: MilestoneStats | null
}

function iconForMilestone(id: string) {
  if (id.startsWith('ep_')) return <Tv size={20} />
  if (id.startsWith('ch_')) return <BookOpen size={20} />
  if (id.startsWith('series_')) return <Trophy size={20} />
  if (id.startsWith('genre_')) return <Compass size={20} />
  return <Trophy size={20} />
}

function MilestoneCard({ milestone }: { milestone: Milestone }) {
  const progressPct = Math.min(milestone.progress * 100, 100)
  const { achieved } = milestone

  return (
    <div
      className="relative rounded-xl p-5 transition-all duration-300"
      style={{
        backgroundColor: achieved
          ? 'color-mix(in srgb, var(--color-gold) 8%, var(--color-surface-subtle))'
          : 'var(--color-surface-subtle)',
        boxShadow: achieved ? '0 0 20px rgba(255, 193, 7, 0.08)' : 'none',
      }}
    >
      {/* Achieved checkmark overlay */}
      {achieved && (
        <div className="absolute top-3 right-3 text-[var(--color-gold)]">
          <CheckCircle size={18} />
        </div>
      )}

      {/* Icon + Title row */}
      <div className="flex items-center gap-3 mb-2">
        <div
          className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg"
          style={{
            backgroundColor: achieved
              ? 'color-mix(in srgb, var(--color-gold) 18%, transparent)'
              : 'var(--color-surface-hover)',
            color: achieved ? 'var(--color-gold)' : 'var(--color-text-tertiary)',
          }}
        >
          {iconForMilestone(milestone.id)}
        </div>
        <div className="min-w-0">
          <p
            className="text-sm font-semibold truncate"
            style={{
              color: achieved ? 'var(--color-gold)' : 'var(--color-text-primary)',
            }}
          >
            {milestone.title}
          </p>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-[var(--color-text-tertiary)] mb-3 line-clamp-2">
        {milestone.description}
      </p>

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full bg-[var(--color-surface-hover)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progressPct}%`,
            backgroundColor: achieved ? 'var(--color-gold)' : 'var(--color-accent-primary)',
          }}
        />
      </div>

      {/* Progress text */}
      <p
        className="text-xs mt-2"
        style={{
          color: achieved ? 'var(--color-gold)' : 'var(--color-text-muted)',
        }}
      >
        {achieved ? 'Achieved!' : `${milestone.current.toLocaleString()} / ${milestone.target.toLocaleString()}`}
      </p>
    </div>
  )
}

export function Milestones({ data }: MilestonesProps) {
  if (!data) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Achievements</h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-2">No milestone data available yet.</p>
      </div>
    )
  }

  const sorted = [...data.milestones].sort((a, b) => {
    // Achieved first
    if (a.achieved !== b.achieved) return a.achieved ? -1 : 1
    // Then by progress descending
    return b.progress - a.progress
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Achievements</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
          {data.total_achieved} of {data.milestones.length} unlocked
        </p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((m) => (
          <MilestoneCard key={m.id} milestone={m} />
        ))}
      </div>
    </div>
  )
}
