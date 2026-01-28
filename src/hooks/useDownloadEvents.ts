/**
 * Download Events Hook
 *
 * Listens to Tauri events for real-time download progress updates.
 * Uses SSE-style push events instead of polling for better performance.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { DownloadProgress } from '@/utils/tauri-commands'

const DOWNLOAD_PROGRESS_EVENT = 'download-progress'

interface UseDownloadEventsOptions {
  /** Only track downloads for a specific media ID */
  mediaId?: string
  /** Callback when a download completes */
  onComplete?: (download: DownloadProgress) => void
  /** Callback when a download fails */
  onFailed?: (download: DownloadProgress) => void
}

interface UseDownloadEventsReturn {
  /** Map of episode number to download progress (for quick lookup) */
  downloadingEpisodes: Map<number, DownloadProgress>
  /** All tracked downloads */
  downloads: DownloadProgress[]
  /** Number of active downloads (downloading or queued) */
  activeCount: number
}

export function useDownloadEvents(
  options: UseDownloadEventsOptions = {}
): UseDownloadEventsReturn {
  const { mediaId, onComplete, onFailed } = options

  // Use a ref for the downloads map to avoid re-renders on every update
  // but use state for the actual values to trigger re-renders when needed
  const downloadsRef = useRef<Map<string, DownloadProgress>>(new Map())
  const [downloads, setDownloads] = useState<DownloadProgress[]>([])
  const [downloadingEpisodes, setDownloadingEpisodes] = useState<Map<number, DownloadProgress>>(new Map())

  // Track completed IDs to avoid duplicate callbacks
  const completedIdsRef = useRef<Set<string>>(new Set())
  const failedIdsRef = useRef<Set<string>>(new Set())

  const updateState = useCallback(() => {
    const allDownloads = Array.from(downloadsRef.current.values())

    // Filter by mediaId if provided
    const filteredDownloads = mediaId
      ? allDownloads.filter(d => d.media_id === mediaId)
      : allDownloads

    setDownloads(filteredDownloads)

    // Build downloading episodes map (only for the filtered media)
    const downloading = new Map<number, DownloadProgress>()
    filteredDownloads
      .filter(d => d.status === 'downloading' || d.status === 'queued')
      .forEach(d => downloading.set(d.episode_number, d))
    setDownloadingEpisodes(downloading)
  }, [mediaId])

  useEffect(() => {
    let unlisten: UnlistenFn | null = null

    const setupListener = async () => {
      unlisten = await listen<DownloadProgress>(DOWNLOAD_PROGRESS_EVENT, (event) => {
        const progress = event.payload

        // Update the downloads map
        downloadsRef.current.set(progress.id, progress)

        // Handle completion callback
        if (progress.status === 'completed' && !completedIdsRef.current.has(progress.id)) {
          completedIdsRef.current.add(progress.id)
          onComplete?.(progress)
        }

        // Handle failure callback
        if (progress.status === 'failed' && !failedIdsRef.current.has(progress.id)) {
          failedIdsRef.current.add(progress.id)
          onFailed?.(progress)
        }

        // Update React state
        updateState()
      })
    }

    setupListener()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [onComplete, onFailed, updateState])

  const activeCount = downloads.filter(
    d => d.status === 'downloading' || d.status === 'queued'
  ).length

  return {
    downloadingEpisodes,
    downloads,
    activeCount,
  }
}
