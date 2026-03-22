/**
 * SeriesCard — Expandable aggregate card for the Series view.
 *
 * Shows cover, title, progress summary ("12/24 episodes watched"),
 * progress bar, last activity. Expands inline to show individual entries.
 */

import { useState } from 'react'
import { ChevronDown, Play, Clock } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useProxiedImage } from '@/hooks/useProxiedImage'
import {
  getAllHistory,
  type MediaHistorySummary,
  type HistoryEntry as HistoryEntryType,
} from '@/utils/tauri-commands'
import { HistoryEntry } from './HistoryEntry'

interface SeriesCardProps {
  summary: MediaHistorySummary
  onEntryRemoved: (entry: HistoryEntryType) => void
}

function formatTimeShort(seconds: number): string {
  if (seconds < 60) return '<1m'
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function relativeTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHrs = Math.floor(diffMin / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function SeriesCard({ summary, onEntryRemoved }: SeriesCardProps) {
  const navigate = useNavigate()
  const { src: coverSrc } = useProxiedImage(summary.media.cover_url || '')
  const [expanded, setExpanded] = useState(false)
  const [entries, setEntries] = useState<HistoryEntryType[]>([])
  const [loadingEntries, setLoadingEntries] = useState(false)

  const isAnime = summary.type === 'anime'
  const progressText = isAnime
    ? `${summary.items_completed}${summary.total_items ? `/${summary.total_items}` : ''} episodes watched`
    : `${summary.items_completed}${summary.total_items ? `/${summary.total_items}` : ''} chapters read`

  const progressPercent = summary.total_items && summary.total_items > 0
    ? (summary.items_completed / summary.total_items) * 100
    : 0

  const handleToggle = async () => {
    if (!expanded && entries.length === 0) {
      setLoadingEntries(true)
      try {
        // Fetch entries for this specific media (search by exact title)
        const results = await getAllHistory(1, 200, isAnime ? 'anime' : 'manga', summary.media.title)
        // Filter to only entries matching this media id
        setEntries(results.filter((e) => e.media.id === summary.media.id))
      } catch (err) {
        console.error('Failed to load entries for series:', err)
      } finally {
        setLoadingEntries(false)
      }
    }
    setExpanded(!expanded)
  }

  const handleResume = () => {
    if (isAnime) {
      navigate({ to: '/watch', search: { malId: summary.media.id } })
    } else {
      navigate({
        to: '/read',
        search: {
          extensionId: summary.media.extension_id || '',
          mangaId: summary.media.id,
          malId: summary.media.id,
        },
      })
    }
  }

  const handleEntryRemoved = (entry: HistoryEntryType) => {
    setEntries((prev) => prev.filter((e) => {
      if (entry.type === 'watch') return !(e.type === 'watch' && e.episode_id === entry.episode_id && e.media.id === entry.media.id)
      return !(e.type === 'read' && e.chapter_id === entry.chapter_id && e.media.id === entry.media.id)
    }))
    onEntryRemoved(entry)
  }

  return (
    <div className="rounded-[var(--radius-lg)] bg-[var(--color-card)] border border-[var(--color-glass-border)] overflow-hidden shadow-[var(--shadow-card)] transition-all">
      {/* Card header */}
      <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[var(--color-glass-bg)] transition-colors" onClick={handleToggle}>
        {/* Cover */}
        <div className="flex-shrink-0 w-14 h-20 rounded-[var(--radius-sm)] overflow-hidden bg-[var(--color-panel)]">
          {coverSrc ? (
            <img src={coverSrc} alt={summary.media.title} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[var(--color-text-dim)]">
              <Play size={18} />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
            {summary.media.title}
          </h3>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{progressText}</p>

          {/* Progress bar */}
          {summary.total_items && summary.total_items > 0 && (
            <div className="mt-2 h-[3px] w-full max-w-[200px] rounded-full bg-[var(--color-glass-border)] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(progressPercent, 100)}%`, background: 'var(--accent-gradient-h)' }}
              />
            </div>
          )}

          {/* Metadata row */}
          <div className="flex items-center gap-3 mt-1.5">
            {isAnime && summary.total_time_seconds > 0 && (
              <span className="flex items-center gap-1 text-[0.65rem] text-[var(--color-text-dim)]">
                <Clock size={10} />
                {formatTimeShort(summary.total_time_seconds)}
              </span>
            )}
            <span className="text-[0.65rem] text-[var(--color-text-dim)]">
              {relativeTime(summary.last_activity)}
            </span>
          </div>
        </div>

        {/* Resume button */}
        <button
          onClick={(e) => { e.stopPropagation(); handleResume() }}
          className="flex-shrink-0 p-2 rounded-full hover:bg-[var(--color-accent-primary)] text-[var(--color-text-secondary)] hover:text-white transition-colors"
          title="Resume"
        >
          <Play size={16} />
        </button>

        {/* Expand chevron */}
        <ChevronDown
          size={16}
          className={`flex-shrink-0 text-[var(--color-text-dim)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </div>

      {/* Expanded entries */}
      {expanded && (
        <div className="border-t border-[var(--color-glass-border)] bg-[var(--color-surface-subtle)] px-2 py-1">
          {loadingEntries ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-[var(--color-accent-primary)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-3">No entries found</p>
          ) : (
            <div className="space-y-0.5 max-h-80 overflow-y-auto">
              {entries.map((entry) => {
                const key = entry.type === 'watch'
                  ? `w-${entry.media.id}-${entry.episode_id}`
                  : `r-${entry.media.id}-${entry.chapter_id}`
                return (
                  <HistoryEntry key={key} entry={entry} onRemoved={handleEntryRemoved} />
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
