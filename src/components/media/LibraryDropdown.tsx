/**
 * LibraryDropdown Component
 *
 * Glass-styled dropdown for managing library status.
 * Shows current status when in library, or "Add to Library" button with dropdown.
 * Reusable across MediaDetailModal and MangaDetailModal.
 */

import { useState, useRef, useEffect } from 'react'
import {
  Plus,
  Check,
  Loader2,
  Tv,
  Clock,
  XCircle,
  BookOpen,
  Bookmark,
  CheckCircle,
  ChevronDown,
  Trash2,
} from 'lucide-react'
import type { LibraryStatus } from '@/utils/tauri-commands'

interface LibraryDropdownProps {
  inLibrary: boolean
  currentStatus: LibraryStatus | null
  loading: boolean
  onAdd: (status: LibraryStatus) => void
  onRemove: () => void
  /** Optional display status override (e.g., smart "Watching" when partially watched) */
  displayStatus?: LibraryStatus | null
  /** Show "On Track" variant for caught-up airing shows */
  isOnTrack?: boolean
  /** Media type for label customization */
  mediaType?: 'anime' | 'manga'
}

const animeStatuses: { status: LibraryStatus; label: string; icon: typeof Tv }[] = [
  { status: 'watching', label: 'Watching', icon: Tv },
  { status: 'plan_to_watch', label: 'Plan to Watch', icon: Bookmark },
  { status: 'completed', label: 'Completed', icon: Check },
  { status: 'on_hold', label: 'On Hold', icon: Clock },
  { status: 'dropped', label: 'Dropped', icon: XCircle },
]

const mangaStatuses: { status: LibraryStatus; label: string; icon: typeof Tv }[] = [
  { status: 'reading', label: 'Reading', icon: BookOpen },
  { status: 'plan_to_read', label: 'Plan to Read', icon: Bookmark },
  { status: 'completed', label: 'Completed', icon: Check },
  { status: 'on_hold', label: 'On Hold', icon: Clock },
  { status: 'dropped', label: 'Dropped', icon: XCircle },
]

const statusLabels: Record<string, string> = {
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
  plan_to_watch: 'Plan to Watch',
  reading: 'Reading',
  plan_to_read: 'Plan to Read',
}

export function LibraryDropdown({
  inLibrary,
  currentStatus,
  loading,
  onAdd,
  onRemove,
  displayStatus,
  isOnTrack = false,
  mediaType = 'anime',
}: LibraryDropdownProps) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const statuses = mediaType === 'manga' ? mangaStatuses : animeStatuses
  const shownStatus = displayStatus ?? currentStatus

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  if (inLibrary) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(!open)}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-[var(--radius-md)] transition-all duration-150 border disabled:opacity-50 disabled:cursor-not-allowed ${
            isOnTrack
              ? 'bg-[rgba(34,197,94,0.15)] border-[var(--color-green)] text-[var(--color-green)]'
              : 'bg-[rgba(229,9,20,0.12)] border-[var(--color-accent-mid)] text-white'
          }`}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : isOnTrack ? (
            <CheckCircle size={16} />
          ) : (
            <Check size={16} />
          )}
          <span>{isOnTrack ? 'On Track' : shownStatus ? statusLabels[shownStatus] || 'In Library' : 'In Library'}</span>
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[200px] glass rounded-[var(--radius-md)] border border-[var(--color-glass-border)] shadow-[var(--shadow-lg)] overflow-hidden">
            {statuses.map((item) => {
              const Icon = item.icon
              const isActive = currentStatus === item.status
              return (
                <button
                  key={item.status}
                  onClick={() => {
                    onAdd(item.status)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-[rgba(229,9,20,0.12)] text-white'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-glass-bg-hover)] hover:text-white'
                  }`}
                >
                  <Icon size={15} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {isActive && <Check size={14} className="text-[var(--color-accent-light)]" />}
                </button>
              )
            })}

            <div className="border-t border-[var(--color-glass-border)]">
              <button
                onClick={() => {
                  onRemove()
                  setOpen(false)
                }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-[rgba(239,68,68,0.1)] hover:text-red-300 transition-colors"
              >
                <Trash2 size={15} />
                <span>Remove from Library</span>
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Not in library — show "Add to Library" with dropdown
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-[var(--radius-md)] transition-all duration-150 border glass text-white hover:bg-[var(--color-glass-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Plus size={16} />
        )}
        <span>My List</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[200px] glass rounded-[var(--radius-md)] border border-[var(--color-glass-border)] shadow-[var(--shadow-lg)] overflow-hidden">
          {statuses.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.status}
                onClick={() => {
                  onAdd(item.status)
                  setOpen(false)
                }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-glass-bg-hover)] hover:text-white transition-colors"
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
