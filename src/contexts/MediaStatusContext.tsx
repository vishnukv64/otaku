/**
 * MediaStatusContext
 *
 * Provides shared media status data (library, favorites, watch/read progress)
 * across all components. This ensures status badges update when users change
 * library status without needing a page refresh.
 */

import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
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

interface MediaStatusContextValue {
  /** Get status for a specific media ID */
  getStatus: (mediaId: string) => MediaStatus
  /** Whether data is still loading */
  loading: boolean
  /** Refresh the status data - call this after changing library status */
  refresh: () => Promise<void>
  /** Map of all library entries for direct access */
  libraryMap: Map<string, LibraryEntry>
}

const MediaStatusContext = createContext<MediaStatusContextValue | null>(null)

interface MediaStatusProviderProps {
  children: ReactNode
}

export function MediaStatusProvider({ children }: MediaStatusProviderProps) {
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

  const value = useMemo(() => ({
    getStatus,
    loading,
    refresh: fetchData,
    libraryMap,
  }), [getStatus, loading, fetchData, libraryMap])

  return (
    <MediaStatusContext.Provider value={value}>
      {children}
    </MediaStatusContext.Provider>
  )
}

/**
 * Hook to access media status from context
 * Must be used within a MediaStatusProvider
 */
export function useMediaStatusContext(): MediaStatusContextValue {
  const context = useContext(MediaStatusContext)
  if (!context) {
    throw new Error('useMediaStatusContext must be used within a MediaStatusProvider')
  }
  return context
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
