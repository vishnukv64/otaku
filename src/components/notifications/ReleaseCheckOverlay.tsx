/**
 * Release Check Progress Overlay
 *
 * Shows a subtle overlay in the bottom-left corner displaying
 * what anime/manga is currently being checked for new releases.
 * Auto-hides when the check is complete.
 */

import { useState, useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Loader2, Tv, BookOpen, X } from 'lucide-react'

interface ReleaseCheckProgress {
  current_index: number
  total_count: number
  media_title: string
  media_type: string // "anime" or "manga"
  is_complete: boolean
  status: 'checking' | 'success' | 'failed' | 'complete'
  error_message: string | null
}

export function ReleaseCheckOverlay() {
  const [progress, setProgress] = useState<ReleaseCheckProgress | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  // Track if user dismissed the overlay for this check session
  const isDismissedRef = useRef(false)

  const handleDismiss = () => {
    isDismissedRef.current = true
    setIsVisible(false)
  }

  useEffect(() => {
    let hideTimeout: ReturnType<typeof setTimeout> | null = null

    const setupListener = async () => {
      const unlisten = await listen<ReleaseCheckProgress>(
        'release_check_progress',
        (event) => {
          const data = event.payload

          if (data.is_complete) {
            // Reset dismissed state when check completes (for next check)
            isDismissedRef.current = false
            // Hide after a short delay when complete
            hideTimeout = setTimeout(() => {
              setIsVisible(false)
              // Clear progress after fade out
              setTimeout(() => setProgress(null), 300)
            }, 1000)
          } else if (data.status === 'checking') {
            // Only show items being actively checked (skip failed/success)
            if (hideTimeout) {
              clearTimeout(hideTimeout)
              hideTimeout = null
            }
            setProgress(data)
            // Only show if not dismissed by user
            if (!isDismissedRef.current) {
              setIsVisible(true)
            }
          }
        }
      )

      return unlisten
    }

    const unlistenPromise = setupListener()

    return () => {
      unlistenPromise.then((unlisten) => unlisten())
      if (hideTimeout) clearTimeout(hideTimeout)
    }
  }, [])

  if (!progress) return null

  return (
    <div
      className={`fixed bottom-4 left-4 z-50 transition-all duration-300 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-bg-secondary)] border border-[var(--color-bg-hover)] rounded-lg shadow-lg max-w-sm">
        {/* Spinner */}
        <div className="flex-shrink-0">
          <Loader2 className="w-5 h-5 text-[var(--color-accent-primary)] animate-spin" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Progress indicator */}
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mb-0.5">
            {progress.media_type === 'anime' ? (
              <Tv className="w-3 h-3" />
            ) : (
              <BookOpen className="w-3 h-3" />
            )}
            <span>
              Checking {progress.current_index}/{progress.total_count}
            </span>
          </div>

          {/* Media title */}
          <p className="text-sm text-[var(--color-text-primary)] truncate">
            {progress.media_title}
          </p>

          {/* Progress bar */}
          <div className="mt-1.5 h-1 bg-[var(--color-bg-hover)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent-primary)] rounded-full transition-all duration-300"
              style={{
                width: `${(progress.current_index / progress.total_count) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
