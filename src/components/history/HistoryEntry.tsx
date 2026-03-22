/**
 * HistoryEntry — Single timeline row showing cover, progress, and actions.
 *
 * Anime rows: "EP 4 · 14:32 / 23:45"
 * Manga rows: "Ch. 12.5 · Page 8/24"
 */

import { Play, X, Check } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useProxiedImage } from '@/hooks/useProxiedImage'
import {
  removeWatchHistoryEntry,
  removeReadingHistoryEntry,
  type HistoryEntry as HistoryEntryType,
} from '@/utils/tauri-commands'
import { notifySuccess, notifyError } from '@/utils/notify'

interface HistoryEntryProps {
  entry: HistoryEntryType
  onRemoved: (entry: HistoryEntryType) => void
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatChapterNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function relativeTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHrs = Math.floor(diffMin / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays === 1) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ` at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

export function HistoryEntry({ entry, onRemoved }: HistoryEntryProps) {
  const navigate = useNavigate()
  const { src: coverSrc } = useProxiedImage(entry.media.cover_url || '')

  const isAnime = entry.type === 'watch'
  const isCompleted = entry.completed

  // Progress calculation
  let progressPercent = 0
  let progressLabel = ''

  if (isAnime) {
    const epNum = entry.episode_number ?? 0
    const cur = entry.progress_seconds ?? 0
    const dur = entry.duration ?? 0
    progressLabel = `EP ${epNum}`
    if (dur > 0) {
      progressPercent = (cur / dur) * 100
      progressLabel += ` \u00b7 ${formatSeconds(cur)} / ${formatSeconds(dur)}`
    }
  } else {
    const chNum = entry.chapter_number ?? 0
    const curPage = entry.current_page ?? 0
    const totalPages = entry.total_pages ?? 0
    progressLabel = `Ch. ${formatChapterNumber(chNum)}`
    if (totalPages > 0) {
      progressPercent = (curPage / totalPages) * 100
      progressLabel += ` \u00b7 Page ${curPage}/${totalPages}`
    }
  }

  const handleResume = () => {
    if (isAnime) {
      navigate({
        to: '/watch',
        search: { malId: entry.media.id, episodeId: entry.episode_id ?? undefined },
      })
    } else {
      navigate({
        to: '/read',
        search: {
          extensionId: entry.media.extension_id || '',
          mangaId: entry.media.id,
          chapterId: entry.chapter_id ?? undefined,
          malId: entry.media.id,
        },
      })
    }
  }

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      if (isAnime && entry.episode_id) {
        await removeWatchHistoryEntry(entry.media.id, entry.episode_id)
      } else if (!isAnime && entry.chapter_id) {
        await removeReadingHistoryEntry(entry.media.id, entry.chapter_id)
      }
      onRemoved(entry)
      notifySuccess('Removed', `Removed "${entry.media.title}" entry from history`)
    } catch (err) {
      console.error('Failed to remove history entry:', err)
      notifyError('Error', 'Failed to remove history entry')
    }
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--color-glass-bg)] transition-colors group/entry">
      {/* Cover thumbnail */}
      <button
        onClick={handleResume}
        className="flex-shrink-0 w-12 h-16 rounded-[var(--radius-sm)] overflow-hidden bg-[var(--color-panel)] relative"
      >
        {coverSrc ? (
          <img src={coverSrc} alt={entry.media.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--color-text-dim)]">
            <Play size={16} />
          </div>
        )}
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {entry.media.title}
        </h4>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{progressLabel}</p>

        {/* Progress bar or checkmark */}
        {isCompleted ? (
          <div className="flex items-center gap-1 mt-1.5">
            <Check size={12} className="text-[var(--color-green)]" />
            <span className="text-[0.65rem] text-[var(--color-green)]">Completed</span>
          </div>
        ) : (
          <div className="mt-1.5 h-[3px] w-full max-w-[180px] rounded-full bg-[var(--color-glass-border)] overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(progressPercent, 100)}%`, background: 'var(--accent-gradient-h)' }}
            />
          </div>
        )}
      </div>

      {/* Timestamp */}
      <span className="hidden sm:block flex-shrink-0 text-[0.7rem] text-[var(--color-text-dim)] whitespace-nowrap">
        {relativeTimestamp(entry.timestamp)}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover/entry:opacity-100 transition-opacity">
        <button
          onClick={handleResume}
          className="p-1.5 rounded-full hover:bg-[var(--color-accent-primary)] text-[var(--color-text-secondary)] hover:text-white transition-colors"
          title="Resume"
        >
          <Play size={14} />
        </button>
        <button
          onClick={handleRemove}
          className="p-1.5 rounded-full hover:bg-red-600/80 text-[var(--color-text-secondary)] hover:text-white transition-colors"
          title="Remove"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
