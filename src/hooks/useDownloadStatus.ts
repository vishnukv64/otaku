/**
 * Download Status Hook
 *
 * Tracks active downloads and provides toast notifications
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { listDownloads, type DownloadProgress } from '@/utils/tauri-commands'
import type { ToastProps } from '@/components/ui/Toast'

export function useDownloadStatus() {
  const [downloads, setDownloads] = useState<DownloadProgress[]>([])
  const [toasts, setToasts] = useState<ToastProps[]>([])
  const completedIdsRef = useRef(new Set<string>())
  const intervalRef = useRef<number | null>(null)
  const addToastRef = useRef<(toast: Omit<ToastProps, 'onClose'>) => void>()

  // Poll for download updates
  useEffect(() => {
    let isMounted = true
    let isFirstLoad = true

    const pollDownloads = async () => {
      try {
        const result = await listDownloads()

        if (!isMounted) return

        // On first load, populate completedIds with already-completed downloads
        // to prevent showing duplicate notifications
        if (isFirstLoad) {
          result.forEach((download) => {
            if (download.status === 'completed' || download.status === 'failed') {
              completedIdsRef.current?.add(download.id)
            }
          })
          isFirstLoad = false
        }

        // Check for newly completed downloads
        result.forEach((download) => {
          if (
            download.status === 'completed' &&
            !completedIdsRef.current?.has(download.id)
          ) {
            // Show success toast
            addToastRef.current?.({
              id: `completed-${download.id}`,
              type: 'success',
              title: 'Download Complete',
              message: download.filename,
              duration: 5000,
            })
            completedIdsRef.current?.add(download.id)
          }

          if (
            download.status === 'failed' &&
            !completedIdsRef.current?.has(download.id)
          ) {
            // Show error toast
            addToastRef.current?.({
              id: `failed-${download.id}`,
              type: 'error',
              title: 'Download Failed',
              message: download.filename,
              duration: 6000,
            })
            completedIdsRef.current?.add(download.id)
          }
        })

        setDownloads(result)

        // Check if there are any active downloads
        const hasActiveDownloads = result.some(
          d => d.status === 'downloading' || d.status === 'queued'
        )

        // Stop polling if no active downloads
        if (!hasActiveDownloads && intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      } catch (error) {
        console.error('Failed to poll downloads:', error)
      }
    }

    // Initial fetch
    pollDownloads()

    // Set up polling interval (will be stopped if no active downloads)
    intervalRef.current = setInterval(pollDownloads, 3000)

    return () => {
      isMounted = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [])

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
