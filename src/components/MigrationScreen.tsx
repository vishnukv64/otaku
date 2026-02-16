/**
 * MigrationScreen - Fullscreen overlay shown during AllAnime → Jikan data migration
 *
 * Displays migration progress as the backend resolves AllAnime IDs to MAL IDs
 * and rewrites all database references. Auto-dismisses on completion.
 */

import { useState, useEffect, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Loader2, CheckCircle2, AlertTriangle, Database } from 'lucide-react'
import { startMigration } from '@/utils/tauri-commands'

interface MigrationProgress {
  total: number
  processed: number
  matched: number
  archived: number
  failed: number
  current_title: string
  status: string // "pending" | "running" | "completed" | "error"
}

interface MigrationScreenProps {
  onComplete: () => void
}

export function MigrationScreen({ onComplete }: MigrationScreenProps) {
  const [progress, setProgress] = useState<MigrationProgress>({
    total: 0,
    processed: 0,
    matched: 0,
    archived: 0,
    failed: 0,
    current_title: '',
    status: 'pending',
  })
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Start migration on mount
  const beginMigration = useCallback(async () => {
    if (started) return
    setStarted(true)
    try {
      await startMigration()
    } catch (err) {
      setError(String(err))
    }
  }, [started])

  useEffect(() => {
    beginMigration()
  }, [beginMigration])

  // Listen for progress events
  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen<MigrationProgress>(
        'migration_progress',
        (event) => {
          const data = event.payload
          setProgress(data)

          if (data.status === 'completed') {
            // Auto-dismiss after a brief pause to show completion
            setTimeout(() => {
              onComplete()
            }, 1500)
          }

          if (data.status === 'error') {
            setError(`Migration encountered errors. ${data.failed} entries could not be migrated.`)
          }
        }
      )
      return unlisten
    }

    const unlistenPromise = setupListener()
    return () => {
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [onComplete])

  const percentage =
    progress.total > 0 ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : 0

  const isComplete = progress.status === 'completed'
  const isError = progress.status === 'error'
  const isRunning = progress.status === 'running'

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--color-bg-primary)]">
      <div className="max-w-md w-full mx-4 text-center">
        {/* Icon */}
        <div className="mb-6 flex justify-center">
          {isComplete ? (
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
          ) : isError ? (
            <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-yellow-500" />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-full bg-[var(--color-accent-primary)]/10 flex items-center justify-center">
              <Database className="w-8 h-8 text-[var(--color-accent-primary)]" />
            </div>
          )}
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
          {isComplete
            ? 'Upgrade Complete'
            : isError
              ? 'Upgrade Finished'
              : 'Upgrading Your Library'}
        </h1>

        {/* Description */}
        <p className="text-[var(--color-text-secondary)] mb-8">
          {isComplete
            ? 'Your library has been successfully upgraded.'
            : isError
              ? error
              : 'This is a one-time process. Your watch history, library, and reading progress are being migrated.'}
        </p>

        {/* Progress bar */}
        {(isRunning || isComplete) && progress.total > 0 && (
          <div className="mb-6">
            <div className="h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  isComplete ? 'bg-green-500' : 'bg-[var(--color-accent-primary)]'
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="mt-2 text-sm text-[var(--color-text-muted)]">
              {progress.processed} / {progress.total} entries ({percentage}%)
            </div>
          </div>
        )}

        {/* Current title being migrated */}
        {isRunning && progress.current_title && (
          <div className="mb-6 flex items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            <span className="truncate max-w-[280px]">{progress.current_title}</span>
          </div>
        )}

        {/* Loading spinner for pending state */}
        {progress.status === 'pending' && !error && (
          <div className="flex justify-center">
            <Loader2 className="w-6 h-6 text-[var(--color-accent-primary)] animate-spin" />
          </div>
        )}

        {/* Stats */}
        {progress.processed > 0 && (
          <div className="flex justify-center gap-6 text-sm">
            <div>
              <div className="text-[var(--color-text-primary)] font-medium">{progress.matched}</div>
              <div className="text-[var(--color-text-muted)]">Migrated</div>
            </div>
            <div>
              <div className="text-[var(--color-text-primary)] font-medium">{progress.archived}</div>
              <div className="text-[var(--color-text-muted)]">Archived</div>
            </div>
            {progress.failed > 0 && (
              <div>
                <div className="text-yellow-500 font-medium">{progress.failed}</div>
                <div className="text-[var(--color-text-muted)]">Failed</div>
              </div>
            )}
          </div>
        )}

        {/* Error with no internet hint */}
        {error && !isRunning && !isComplete && (
          <button
            onClick={() => {
              setError(null)
              setStarted(false)
            }}
            className="mt-6 px-6 py-2 rounded-lg bg-[var(--color-accent-primary)] text-white hover:bg-[var(--color-accent-primary)]/90 transition-colors"
          >
            Retry
          </button>
        )}

        {/* Completion button (auto-dismiss backup) */}
        {isComplete && (
          <button
            onClick={onComplete}
            className="mt-6 px-6 py-2 rounded-lg bg-[var(--color-accent-primary)] text-white hover:bg-[var(--color-accent-primary)]/90 transition-colors"
          >
            Continue
          </button>
        )}

        {/* Error completion — allow user to proceed */}
        {isError && (
          <button
            onClick={onComplete}
            className="mt-4 px-6 py-2 rounded-lg bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]/80 transition-colors"
          >
            Continue Anyway
          </button>
        )}
      </div>
    </div>
  )
}
