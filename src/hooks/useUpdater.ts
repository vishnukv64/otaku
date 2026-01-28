/**
 * Updater Hook
 *
 * Provides update functionality using Tauri's plugin-updater.
 * Handles checking for updates, downloading, and restarting.
 */

import { useCallback } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { useUpdateStore } from '@/store/updateStore'

export function useUpdater() {
  const {
    status,
    error,
    updateInfo,
    progress,
    lastChecked,
    setStatus,
    setError,
    setUpdateInfo,
    setProgress,
    setLastChecked,
    reset,
  } = useUpdateStore()

  /**
   * Check for available updates
   */
  const checkForUpdates = useCallback(async () => {
    try {
      reset()
      setStatus('checking')

      const currentVersion = await getVersion()
      const update = await check()
      setLastChecked(Date.now())

      if (update) {
        setUpdateInfo({
          version: update.version,
          currentVersion,
          date: update.date,
          body: update.body,
        })
        setStatus('available')
        return update
      } else {
        setUpdateInfo({
          version: currentVersion,
          currentVersion,
        })
        setStatus('up-to-date')
        return null
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check for updates'
      setError(message)
      throw err
    }
  }, [reset, setStatus, setLastChecked, setUpdateInfo, setError])

  /**
   * Download and install the update
   */
  const downloadAndInstall = useCallback(
    async (update: Update) => {
      try {
        setStatus('downloading')
        setProgress({ downloaded: 0, total: null, percentage: 0 })

        let downloaded = 0

        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              setProgress({
                total: event.data.contentLength ?? null,
                downloaded: 0,
                percentage: 0,
              })
              break
            case 'Progress':
              downloaded += event.data.chunkLength
              const total = useUpdateStore.getState().progress.total
              const percentage = total ? Math.round((downloaded / total) * 100) : 0
              setProgress({
                downloaded,
                percentage,
              })
              break
            case 'Finished':
              setProgress({ percentage: 100 })
              setStatus('ready')
              break
          }
        })

        setStatus('ready')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to download update'
        setError(message)
        throw err
      }
    },
    [setStatus, setProgress, setError]
  )

  /**
   * Restart the application to apply the update
   */
  const restartApp = useCallback(async () => {
    try {
      await relaunch()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restart application'
      setError(message)
      throw err
    }
  }, [setError])

  return {
    // State
    status,
    error,
    updateInfo,
    progress,
    lastChecked,
    // Actions
    checkForUpdates,
    downloadAndInstall,
    restartApp,
    reset,
  }
}
