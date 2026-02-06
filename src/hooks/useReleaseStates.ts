/**
 * useReleaseStates Hook
 *
 * Unified hook for managing release state across the application.
 * Provides a single source of truth for NEW badge display and release tracking.
 *
 * Key features:
 * - Batches multiple media ID queries for efficiency
 * - Caches results to avoid redundant API calls
 * - Provides acknowledge functionality for dismissing NEW badges
 * - Supports both individual and bulk queries
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  getMediaReleaseStates,
  acknowledgeNewReleases,
  MediaReleaseState,
} from '@/utils/tauri-commands'

// Cache for release states
const releaseStateCache = new Map<string, MediaReleaseState>()
const pendingRequests = new Map<string, Promise<MediaReleaseState | null>>()

// Batch request queue
let batchQueue: string[] = []
let batchTimeout: ReturnType<typeof setTimeout> | null = null
const BATCH_DELAY_MS = 50 // Wait 50ms to collect batch requests

/**
 * Fetch release states in batch
 */
async function fetchBatchReleaseStates(mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return

  try {
    const states = await getMediaReleaseStates(mediaIds)
    for (const state of states) {
      releaseStateCache.set(state.media_id, state)
    }
    // Mark missing IDs as having no tracking
    for (const id of mediaIds) {
      if (!releaseStateCache.has(id)) {
        releaseStateCache.set(id, {
          media_id: id,
          has_new_release: false,
          latest_number: null,
          notified_up_to: null,
          last_checked: null,
          normalized_status: 'unknown',
        })
      }
    }
  } catch (error) {
    console.error('Failed to fetch release states:', error)
  }
}

/**
 * Queue a media ID for batch fetching
 */
function queueForBatch(mediaId: string): Promise<MediaReleaseState | null> {
  // Check cache first
  if (releaseStateCache.has(mediaId)) {
    return Promise.resolve(releaseStateCache.get(mediaId)!)
  }

  // Check if already pending
  if (pendingRequests.has(mediaId)) {
    return pendingRequests.get(mediaId)!
  }

  // Add to batch queue
  batchQueue.push(mediaId)

  // Create promise for this request
  const promise = new Promise<MediaReleaseState | null>((resolve) => {
    // Schedule batch fetch
    if (batchTimeout) clearTimeout(batchTimeout)
    batchTimeout = setTimeout(async () => {
      const idsToFetch = [...batchQueue]
      batchQueue = []
      batchTimeout = null

      await fetchBatchReleaseStates(idsToFetch)

      // Resolve all pending requests
      for (const id of idsToFetch) {
        const state = releaseStateCache.get(id)
        pendingRequests.delete(id)
        if (id === mediaId) {
          resolve(state || null)
        }
      }
    }, BATCH_DELAY_MS)
  })

  pendingRequests.set(mediaId, promise)
  return promise
}

/**
 * Clear cache for a specific media ID or all media
 */
export function clearReleaseStateCache(mediaId?: string): void {
  if (mediaId) {
    releaseStateCache.delete(mediaId)
    pendingRequests.delete(mediaId)
  } else {
    releaseStateCache.clear()
    pendingRequests.clear()
  }
}

/**
 * Hook to get release state for a single media item
 */
export function useReleaseState(mediaId: string | undefined) {
  const [state, setState] = useState<MediaReleaseState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!mediaId) {
      setState(null)
      setLoading(false)
      return
    }

    setLoading(true)
    queueForBatch(mediaId).then((result) => {
      setState(result)
      setLoading(false)
    })
  }, [mediaId])

  // Listen for release check events to update state
  useEffect(() => {
    if (!mediaId) return

    const unlisten = listen<{ media_id: string }>('release_check_complete', (event) => {
      if (event.payload.media_id === mediaId) {
        clearReleaseStateCache(mediaId)
        queueForBatch(mediaId).then(setState)
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [mediaId])

  const hasNewRelease = state?.has_new_release ?? false

  const acknowledge = useCallback(async () => {
    if (!mediaId) return
    try {
      await acknowledgeNewReleases(mediaId)
      clearReleaseStateCache(mediaId)
      const newState = await queueForBatch(mediaId)
      setState(newState)
    } catch (error) {
      console.error('Failed to acknowledge releases:', error)
    }
  }, [mediaId])

  return {
    state,
    loading,
    hasNewRelease,
    acknowledge,
  }
}

/**
 * Hook to get release states for multiple media items
 */
export function useReleaseStates(mediaIds: string[]) {
  const [states, setStates] = useState<Map<string, MediaReleaseState>>(new Map())
  const [loading, setLoading] = useState(true)

  // Stable reference for media IDs
  const idsKey = useMemo(() => mediaIds.sort().join(','), [mediaIds])

  useEffect(() => {
    if (mediaIds.length === 0) {
      setStates(new Map())
      setLoading(false)
      return
    }

    setLoading(true)

    // Fetch all states
    Promise.all(mediaIds.map((id) => queueForBatch(id))).then((results) => {
      const newStates = new Map<string, MediaReleaseState>()
      for (let i = 0; i < mediaIds.length; i++) {
        const state = results[i]
        if (state) {
          newStates.set(mediaIds[i], state)
        }
      }
      setStates(newStates)
      setLoading(false)
    })
  }, [idsKey])

  /**
   * Get release state for a specific media ID
   */
  const getState = useCallback(
    (mediaId: string): MediaReleaseState | undefined => {
      return states.get(mediaId)
    },
    [states]
  )

  /**
   * Check if a specific media has new releases
   */
  const hasNewRelease = useCallback(
    (mediaId: string): boolean => {
      return states.get(mediaId)?.has_new_release ?? false
    },
    [states]
  )

  /**
   * Acknowledge releases for a specific media
   */
  const acknowledge = useCallback(
    async (mediaId: string) => {
      try {
        await acknowledgeNewReleases(mediaId)
        clearReleaseStateCache(mediaId)
        const newState = await queueForBatch(mediaId)
        if (newState) {
          setStates((prev) => {
            const next = new Map(prev)
            next.set(mediaId, newState)
            return next
          })
        }
      } catch (error) {
        console.error('Failed to acknowledge releases:', error)
      }
    },
    []
  )

  /**
   * Get all media IDs with new releases
   */
  const mediaWithNewReleases = useMemo(() => {
    return Array.from(states.entries())
      .filter(([, state]) => state.has_new_release)
      .map(([id]) => id)
  }, [states])

  return {
    states,
    loading,
    getState,
    hasNewRelease,
    acknowledge,
    mediaWithNewReleases,
  }
}

/**
 * Prefetch release states for a list of media IDs
 * Useful for preloading data before rendering
 */
export async function prefetchReleaseStates(mediaIds: string[]): Promise<void> {
  const uncachedIds = mediaIds.filter((id) => !releaseStateCache.has(id))
  if (uncachedIds.length > 0) {
    await fetchBatchReleaseStates(uncachedIds)
  }
}

/**
 * Hook to listen for new release events
 */
export function useNewReleaseListener(
  callback: (result: { media_id: string; new_releases: number }) => void
) {
  useEffect(() => {
    const unlisten = listen<{
      media_id: string
      new_releases: number
    }>('new_release_detected', (event) => {
      callback(event.payload)
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [callback])
}
