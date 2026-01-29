/**
 * Download Status Hook
 *
 * Tracks active downloads count for UI indicators.
 * Toast notifications are handled by the notification system (useNotificationEvents).
 */

import { useEffect, useState, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { listDownloads, type DownloadProgress } from '@/utils/tauri-commands'

const DOWNLOAD_PROGRESS_EVENT = 'download-progress'

export function useDownloadStatus() {
  const [downloads, setDownloads] = useState<DownloadProgress[]>([])
  const downloadsRef = useRef<Map<string, DownloadProgress>>(new Map())

  // Listen for download events
  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    let isMounted = true

    const setupListener = async () => {
      // Initial fetch to populate existing downloads
      try {
        const existingDownloads = await listDownloads()
        if (!isMounted) return

        existingDownloads.forEach((download) => {
          downloadsRef.current.set(download.id, download)
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

  const activeCount = downloads.filter(
    (d) => d.status === 'downloading' || d.status === 'queued'
  ).length

  return {
    downloads,
    activeCount,
  }
}
