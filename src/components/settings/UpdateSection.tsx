/**
 * Update Section Component
 *
 * Displays update status and controls in the Settings page.
 * Handles: checking for updates, download progress, changelog display, and restart.
 */

import { useState, useRef, useEffect } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { useUpdater } from '@/hooks/useUpdater'
import { SettingSection } from './SettingSection'
import {
  RefreshCw,
  Download,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react'

export function UpdateSection() {
  const {
    status,
    error,
    updateInfo,
    progress,
    checkForUpdates,
    downloadAndInstall,
    restartApp,
    reset,
  } = useUpdater()

  const [showChangelog, setShowChangelog] = useState(false)
  const updateRef = useRef<Update | null>(null)
  const autoCheckTriggeredRef = useRef(false)

  // If status is 'available' but we don't have the Update object
  // (e.g., when navigating from notification after auto-check),
  // automatically re-check to get the Update object for downloading
  useEffect(() => {
    if (status === 'available' && !updateRef.current && !autoCheckTriggeredRef.current) {
      autoCheckTriggeredRef.current = true
      checkForUpdates()
        .then((update) => {
          updateRef.current = update
        })
        .catch((err) => {
          console.error('Failed to re-check for updates:', err)
        })
    }
  }, [status, checkForUpdates])

  const handleCheckForUpdates = async () => {
    try {
      const update = await checkForUpdates()
      updateRef.current = update
    } catch (err) {
      console.error('Failed to check for updates:', err)
    }
  }

  const handleDownloadAndInstall = async () => {
    if (!updateRef.current) return
    try {
      await downloadAndInstall(updateRef.current)
    } catch (err) {
      console.error('Failed to download update:', err)
    }
  }

  const handleRestart = async () => {
    try {
      await restartApp()
    } catch (err) {
      console.error('Failed to restart:', err)
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  const renderContent = () => {
    switch (status) {
      case 'idle':
        return (
          <button
            onClick={handleCheckForUpdates}
            className="
              flex items-center gap-2
              bg-[var(--color-accent)]
              hover:bg-[var(--color-accent-hover)]
              text-white
              rounded-lg
              px-4
              py-2
              font-medium
              transition-colors
            "
          >
            <RefreshCw size={16} />
            Check for Updates
          </button>
        )

      case 'checking':
        return (
          <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
            <Loader2 size={16} className="animate-spin" />
            <span>Checking for updates...</span>
          </div>
        )

      case 'up-to-date':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-500">
              <CheckCircle2 size={16} />
              <span>You're running the latest version (v{updateInfo?.currentVersion})</span>
            </div>
            <button
              onClick={handleCheckForUpdates}
              className="
                flex items-center gap-2
                bg-[var(--color-surface-subtle)]
                hover:bg-[var(--color-surface-hover)]
                text-[var(--color-text-primary)]
                rounded-lg
                px-3
                py-1.5
                text-sm
                font-medium
                transition-colors
              "
            >
              <RefreshCw size={14} />
              Check Again
            </button>
          </div>
        )

      case 'available':
        return (
          <div className="space-y-4">
            {/* Version info */}
            <div className="bg-[var(--color-surface-subtle)] rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[var(--color-text-primary)] font-medium">
                  v{updateInfo?.version} available
                </span>
                <span className="text-sm text-[var(--color-text-secondary)]">
                  Current: v{updateInfo?.currentVersion}
                </span>
              </div>

              {updateInfo?.date && (
                <div className="text-sm text-[var(--color-text-secondary)] mb-3">
                  Released: {new Date(updateInfo.date).toLocaleDateString()}
                </div>
              )}

              {/* Changelog toggle */}
              {updateInfo?.body && (
                <button
                  onClick={() => setShowChangelog(!showChangelog)}
                  className="
                    flex items-center gap-1
                    text-sm
                    text-[var(--color-accent)]
                    hover:text-[var(--color-accent-hover)]
                    transition-colors
                  "
                >
                  {showChangelog ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showChangelog ? 'Hide' : 'Show'} Release Notes
                </button>
              )}

              {/* Changelog content */}
              {showChangelog && updateInfo?.body && (
                <div className="mt-3 p-3 bg-[var(--color-background)] rounded-md">
                  <pre className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap font-sans">
                    {updateInfo.body}
                  </pre>
                </div>
              )}
            </div>

            {/* Download button */}
            <button
              onClick={handleDownloadAndInstall}
              className="
                flex items-center gap-2
                bg-[var(--color-accent)]
                hover:bg-[var(--color-accent-hover)]
                text-white
                rounded-lg
                px-4
                py-2
                font-medium
                transition-colors
              "
            >
              <Download size={16} />
              Download & Install
            </button>
          </div>
        )

      case 'downloading':
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-text-primary)]">
                Downloading v{updateInfo?.version}...
              </span>
              <span className="text-[var(--color-text-secondary)]">
                {progress.total
                  ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
                  : formatBytes(progress.downloaded)}
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-[var(--color-surface-subtle)] rounded-full h-2 overflow-hidden">
              <div
                className="bg-[var(--color-accent)] h-full transition-all duration-300"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>

            <div className="text-sm text-[var(--color-text-secondary)]">
              {progress.percentage}% complete
            </div>
          </div>
        )

      case 'ready':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-500">
              <CheckCircle2 size={16} />
              <span>Update downloaded and ready to install</span>
            </div>

            <button
              onClick={handleRestart}
              className="
                flex items-center gap-2
                bg-green-600
                hover:bg-green-700
                text-white
                rounded-lg
                px-4
                py-2
                font-medium
                transition-colors
              "
            >
              <RotateCcw size={16} />
              Restart Now
            </button>

            <p className="text-xs text-[var(--color-text-secondary)]">
              The update will be applied when the application restarts.
            </p>
          </div>
        )

      case 'error':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-red-500">
              <AlertCircle size={16} />
              <span>{error || 'An error occurred'}</span>
            </div>

            <button
              onClick={() => {
                reset()
                handleCheckForUpdates()
              }}
              className="
                flex items-center gap-2
                bg-[var(--color-surface-subtle)]
                hover:bg-[var(--color-surface-hover)]
                text-[var(--color-text-primary)]
                rounded-lg
                px-3
                py-1.5
                text-sm
                font-medium
                transition-colors
              "
            >
              <RefreshCw size={14} />
              Try Again
            </button>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <SettingSection
      title="Updates"
      description="Check for and install application updates"
    >
      <div className="py-2">{renderContent()}</div>
    </SettingSection>
  )
}
