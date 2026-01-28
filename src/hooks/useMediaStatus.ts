/**
 * useMediaStatus Hook
 *
 * Efficiently tracks media library status, favorites, and watch/read progress.
 * Fetches data once and provides O(1) lookup for any media ID.
 *
 * Status types:
 * - Library status: watching, reading, completed, on_hold, dropped, plan_to_watch, plan_to_read
 * - Favorite: boolean
 * - In Progress: currently watching (anime) or reading (manga)
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getLibraryByStatus,
  getContinueWatching,
  getContinueReading,
  type LibraryEntry,
  type LibraryStatus,
} from '@/utils/tauri-commands'

export interface MediaStatus {
  /** Whether the media is in the library */
  inLibrary: boolean
  /** Library status (watching, completed, etc.) */
  libraryStatus?: LibraryStatus
  /** Whether the media is favorited */
  isFavorite: boolean
  /** Whether currently watching (has recent watch progress) */
  isWatching: boolean
  /** Whether currently reading (has recent read progress) */
  isReading: boolean
}

interface UseMediaStatusReturn {
  /** Get status for a specific media ID */
  getStatus: (mediaId: string) => MediaStatus
  /** Whether data is still loading */
  loading: boolean
  /** Refresh the status data */
  refresh: () => Promise<void>
  /** Map of all library entries for direct access */
  libraryMap: Map<string, LibraryEntry>
}

/**
 * Hook to track media status across the app
 * Fetches library and watch/read history data for efficient lookup
 */
export function useMediaStatus(): UseMediaStatusReturn {
  const [libraryMap, setLibraryMap] = useState<Map<string, LibraryEntry>>(new Map())
  const [watchingSet, setWatchingSet] = useState<Set<string>>(new Set())
  const [readingSet, setReadingSet] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      // Fetch all data in parallel
      const [libraryEntries, continueWatching, continueReading] = await Promise.all([
        getLibraryByStatus(), // Gets ALL library entries
        getContinueWatching(100), // Get recent watching
        getContinueReading(100), // Get recent reading
      ])

      // Create library lookup map
      const libMap = new Map<string, LibraryEntry>()
      libraryEntries.forEach(entry => {
        libMap.set(entry.media_id, entry)
      })
      setLibraryMap(libMap)

      // Create watching set
      const watchSet = new Set<string>()
      continueWatching.forEach(entry => {
        watchSet.add(entry.media_id)
      })
      setWatchingSet(watchSet)

      // Create reading set
      const readSet = new Set<string>()
      continueReading.forEach(entry => {
        readSet.add(entry.media_id)
      })
      setReadingSet(readSet)
    } catch (error) {
      console.error('Failed to fetch media status:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Memoized getStatus function for O(1) lookup
  const getStatus = useCallback((mediaId: string): MediaStatus => {
    const libraryEntry = libraryMap.get(mediaId)

    return {
      inLibrary: !!libraryEntry,
      libraryStatus: libraryEntry?.status,
      isFavorite: libraryEntry?.favorite ?? false,
      isWatching: watchingSet.has(mediaId),
      isReading: readingSet.has(mediaId),
    }
  }, [libraryMap, watchingSet, readingSet])

  return useMemo(() => ({
    getStatus,
    loading,
    refresh: fetchData,
    libraryMap,
  }), [getStatus, loading, fetchData, libraryMap])
}

/**
 * Get a human-readable label for a library status
 */
export function getStatusLabel(status: LibraryStatus): string {
  const labels: Record<LibraryStatus, string> = {
    watching: 'Watching',
    reading: 'Reading',
    completed: 'Completed',
    on_hold: 'On Hold',
    dropped: 'Dropped',
    plan_to_watch: 'Plan to Watch',
    plan_to_read: 'Plan to Read',
  }
  return labels[status] || status
}

/**
 * Get a short label for a library status (for badges)
 */
export function getShortStatusLabel(status: LibraryStatus): string {
  const labels: Record<LibraryStatus, string> = {
    watching: 'Watching',
    reading: 'Reading',
    completed: 'Done',
    on_hold: 'Paused',
    dropped: 'Dropped',
    plan_to_watch: 'Planned',
    plan_to_read: 'Planned',
  }
  return labels[status] || status
}

/**
 * Get color class for a library status badge
 */
export function getStatusColor(status: LibraryStatus): string {
  const colors: Record<LibraryStatus, string> = {
    watching: 'bg-blue-500',
    reading: 'bg-blue-500',
    completed: 'bg-green-500',
    on_hold: 'bg-yellow-500',
    dropped: 'bg-red-500',
    plan_to_watch: 'bg-purple-500',
    plan_to_read: 'bg-purple-500',
  }
  return colors[status] || 'bg-gray-500'
}
