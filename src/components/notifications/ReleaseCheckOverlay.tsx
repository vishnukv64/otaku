/**
 * Release Check Progress Overlay
 *
 * Shows a subtle overlay in the bottom-left corner displaying
 * what anime/manga is currently being checked for new releases.
 * Auto-hides when the check is complete.
 *
 * Features:
 * - Dismiss: Hides the overlay but lets the check continue in background
 * - Stop: Completely stops the release check operation
 */

import { useState, useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Loader2, Tv, BookOpen, X, Square } from 'lucide-react'
import { stopReleaseCheck } from '@/utils/tauri-commands'
import { isMobile } from '@/utils/platform'
import { appInBackground, sendMobileNotification } from '@/utils/notify'

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
  const [isStopping, setIsStopping] = useState(false)
  // Track if user dismissed the overlay for this check session
  const isDismissedRef = useRef(false)
  const mobile = isMobile()

  const handleDismiss = () => {
    isDismissedRef.current = true
    setIsVisible(false)
  }

  const handleStop = async () => {
    setIsStopping(true)
    try {
      await stopReleaseCheck()
      // Hide overlay after stopping
      setIsVisible(false)
      setProgress(null)
      isDismissedRef.current = true
    } catch (error) {
      console.error('Failed to stop release check:', error)
    } finally {
      setIsStopping(false)
    }
  }

  useEffect(() => {
    let hideTimeout: ReturnType<typeof setTimeout> | null = null
    let staleTimeout: ReturnType<typeof setTimeout> | null = null

    const resetStaleTimer = () => {
      if (staleTimeout) clearTimeout(staleTimeout)
      staleTimeout = setTimeout(() => {
        setIsVisible(false)
        setTimeout(() => setProgress(null), 300)
        isDismissedRef.current = false
      }, 120_000) // 2 minutes with no progress → assume stuck, auto-hide
    }

    const setupListener = async () => {
      const unlisten = await listen<ReleaseCheckProgress>('release_check_progress', (event) => {
        const data = event.payload

        if (mobile) {
          // Phones: no progress chatter. Found releases notify through the normal
          // notification path; this only reports completion, and only when backgrounded.
          if (data.is_complete && appInBackground()) {
            void sendMobileNotification(
              'Release Check Complete',
              `Checked ${data.total_count} items for new releases`
            )
          }
          return
        }

        if (data.is_complete) {
          isDismissedRef.current = false
          if (staleTimeout) clearTimeout(staleTimeout)
          hideTimeout = setTimeout(() => {
            setIsVisible(false)
            setTimeout(() => setProgress(null), 300)
          }, 1000)
        } else if (data.status === 'checking') {
          if (hideTimeout) {
            clearTimeout(hideTimeout)
            hideTimeout = null
          }
          setProgress(data)
          if (!isDismissedRef.current) {
            setIsVisible(true)
          }
          resetStaleTimer()
        } else if (data.status === 'failed') {
          resetStaleTimer()
        }
      })

      return unlisten
    }

    const unlistenPromise = setupListener()

    return () => {
      unlistenPromise.then((unlisten) => unlisten())
      if (hideTimeout) clearTimeout(hideTimeout)
      if (staleTimeout) clearTimeout(staleTimeout)
    }
  }, [mobile])

  // On mobile, the effect handles native notifications — don't render the overlay UI
  if (mobile || !progress) return null

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

        {/* Action buttons */}
        <div className="flex-shrink-0 flex items-center gap-1">
          {/* Stop button - stops the check entirely */}
          <button
            onClick={handleStop}
            disabled={isStopping}
            className="p-1.5 rounded-md text-red-400 hover:text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            title="Stop checking"
          >
            {isStopping ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Square className="w-4 h-4 fill-current" />
            )}
          </button>

          {/* Dismiss button - hides overlay but continues check */}
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            title="Dismiss (check continues in background)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
