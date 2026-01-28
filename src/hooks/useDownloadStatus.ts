/**
 * Download Status Hook
 *
 * Tracks active downloads and provides toast notifications.
 * Uses Tauri events for real-time updates instead of polling.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { listDownloads, type DownloadProgress } from '@/utils/tauri-commands'
import type { ToastProps } from '@/components/ui/Toast'

const DOWNLOAD_PROGRESS_EVENT = 'download-progress'

export function useDownloadStatus() {
  const [downloads, setDownloads] = useState<DownloadProgress[]>([])
  const [toasts, setToasts] = useState<ToastProps[]>([])
  const downloadsRef = useRef<Map<string, DownloadProgress>>(new Map())
  const completedIdsRef = useRef(new Set<string>())
  const failedIdsRef = useRef(new Set<string>())
  const addToastRef = useRef<(toast: Omit<ToastProps, 'onClose'>) => void>()

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((toast: Omit<ToastProps, 'onClose'>) => {
    setToasts((prev) => [
      ...prev,
      { ...toast, onClose: removeToast } as ToastProps,
    ])
  }, [removeToast])

  // Update ref when addToast changes
  useEffect(() => {
    addToastRef.current = addToast
  }, [addToast])

  // Listen for download events
  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    let isMounted = true

    const setupListener = async () => {
      // Initial fetch to populate existing downloads and mark completed ones
      try {
        const existingDownloads = await listDownloads()
        if (!isMounted) return

        existingDownloads.forEach((download) => {
          downloadsRef.current.set(download.id, download)
          // Mark already completed/failed downloads to avoid duplicate toasts
          if (download.status === 'completed') {
            completedIdsRef.current.add(download.id)
          }
          if (download.status === 'failed') {
            failedIdsRef.current.add(download.id)
          }
        })
        setDownloads(existingDownloads)
      } catch (error) {
        console.error('Failed to fetch initial downloads:', error)
      }

      // Listen for real-time updates
      unlisten = await listen<DownloadProgress>(DOWNLOAD_PROGRESS_EVENT, (event) => {
        if (!isMounted) return

        const progress = event.payload
        downloadsRef.current.set(progress.id, progress)

        // Show toast for newly completed downloads
        if (progress.status === 'completed' && !completedIdsRef.current.has(progress.id)) {
          completedIdsRef.current.add(progress.id)
          addToastRef.current?.({
            id: `completed-${progress.id}`,
            type: 'success',
            title: 'Download Complete',
            message: `Episode ${progress.episode_number} downloaded`,
            duration: 5000,
          })
        }

        // Show toast for newly failed downloads
        if (progress.status === 'failed' && !failedIdsRef.current.has(progress.id)) {
          failedIdsRef.current.add(progress.id)
          addToastRef.current?.({
            id: `failed-${progress.id}`,
            type: 'error',
            title: 'Download Failed',
            message: `Episode ${progress.episode_number}: ${progress.error_message || 'Unknown error'}`,
            duration: 6000,
          })
        }

        // Update state with all downloads
        setDownloads(Array.from(downloadsRef.current.values()))
      })
    }

    setupListener()

    return () => {
      isMounted = false
      if (unlisten) {
        unlisten()
      }
    }
  }, [])

  const activeDownloads = downloads.filter(
    (d) => d.status === 'downloading' || d.status === 'queued'
  )

  const activeCount = activeDownloads.length

  return {
    downloads,
    activeCount,
    toasts,
    addToast,
    removeToast,
  }
}
