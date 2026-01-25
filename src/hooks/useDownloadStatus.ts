/**
 * Download Status Hook
 *
 * Tracks active downloads and provides toast notifications
 */

import { useEffect, useState, useCallback } from 'react'
import { listDownloads, type DownloadProgress } from '@/utils/tauri-commands'
import type { ToastProps } from '@/components/ui/Toast'

export function useDownloadStatus() {
  const [downloads, setDownloads] = useState<DownloadProgress[]>([])
  const [toasts, setToasts] = useState<ToastProps[]>([])
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())

  // Poll for download updates
  useEffect(() => {
    const pollDownloads = async () => {
      try {
        const result = await listDownloads()

        // Check for newly completed downloads
        result.forEach((download) => {
          if (
            download.status === 'completed' &&
            !completedIds.has(download.id)
          ) {
            // Show success toast
            addToast({
              id: `completed-${download.id}`,
              type: 'success',
              title: 'Download Complete',
              message: download.filename,
              duration: 5000,
            })
            setCompletedIds((prev) => new Set(prev).add(download.id))
          }

          if (
            download.status === 'failed' &&
            !completedIds.has(download.id)
          ) {
            // Show error toast
            addToast({
              id: `failed-${download.id}`,
              type: 'error',
              title: 'Download Failed',
              message: download.filename,
              duration: 6000,
            })
            setCompletedIds((prev) => new Set(prev).add(download.id))
          }
        })

        setDownloads(result)
      } catch (error) {
        console.error('Failed to poll downloads:', error)
      }
    }

    // Initial fetch
    pollDownloads()

    // Poll every second
    const interval = setInterval(pollDownloads, 1000)
    return () => clearInterval(interval)
  }, [completedIds])

  const addToast = useCallback((toast: Omit<ToastProps, 'onClose'>) => {
    setToasts((prev) => [
      ...prev,
      { ...toast, onClose: removeToast } as ToastProps,
    ])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
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
