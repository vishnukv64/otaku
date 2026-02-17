/**
 * useJikanQuery — Stale-While-Revalidate hook for Jikan API data
 *
 * Shows cached data instantly, refreshes in the background when stale.
 * Uses SQLite discover_cache with per-key TTL for freshness checks.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  getDiscoverCacheWithFreshness,
  saveDiscoverCacheWithTtl,
} from '@/utils/tauri-commands'
import type { SearchResult, SearchResults } from '@/types/extension'

// TTL presets (seconds) — use these as ttlSeconds values
export const CACHE_TTL = {
  TRENDING: 15 * 60,             // 15 min — changes frequently
  AIRING: 30 * 60,               // 30 min — current season
  POPULAR: 2 * 60 * 60,          // 2 hours — stable
  TOP_RATED: 4 * 60 * 60,        // 4 hours — very stable
  UPCOMING: 60 * 60,             // 1 hour
  SEASON_ARCHIVE: 24 * 60 * 60,  // 24 hours — historical, frozen
}

// Module-level request deduplication map
// Prevents duplicate API calls from React strict mode double-mount or fast tab switching
const inflightRequests = new Map<string, Promise<SearchResults>>()

interface UseJikanQueryOptions {
  cacheKey: string
  fetcher: () => Promise<SearchResults>
  ttlSeconds: number
  mediaType: 'anime' | 'manga' | 'mixed'
  deduplicate?: boolean  // Remove duplicate IDs (default true)
  enabled?: boolean      // Conditional fetching (default true)
}

interface UseJikanQueryResult {
  data: SearchResult[]
  loading: boolean         // True ONLY on initial load with empty cache
  isRevalidating: boolean  // Background fetch in progress
  error: string | null
  hasNextPage: boolean
  refetch: () => Promise<void>
}

function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  return results.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export function useJikanQuery(options: UseJikanQueryOptions): UseJikanQueryResult {
  const {
    cacheKey,
    fetcher,
    ttlSeconds,
    mediaType,
    deduplicate = true,
    enabled = true,
  } = options

  const [data, setData] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [isRevalidating, setIsRevalidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasNextPage, setHasNextPage] = useState(false)

  // Track whether this instance has been cancelled (unmounted or cacheKey changed)
  const cancelledRef = useRef(false)
  // Track the current cacheKey to detect changes
  const currentKeyRef = useRef(cacheKey)

  const fetchAndUpdate = useCallback(async (isBackground: boolean) => {
    if (isBackground) {
      setIsRevalidating(true)
    }

    // Deduplicate in-flight requests for the same cache key
    let promise = inflightRequests.get(cacheKey)
    if (!promise) {
      promise = fetcher()
      inflightRequests.set(cacheKey, promise)
      // Clean up after resolution
      promise.finally(() => {
        inflightRequests.delete(cacheKey)
      })
    }

    try {
      const results = await promise

      // Don't update state if cancelled (unmounted or key changed)
      if (cancelledRef.current || currentKeyRef.current !== cacheKey) return

      const processed = deduplicate
        ? deduplicateResults(results.results)
        : results.results

      setData(processed)
      setHasNextPage(results.has_next_page)
      setError(null)
      setLoading(false)
      setIsRevalidating(false)

      // Save to cache in background (fire-and-forget)
      saveDiscoverCacheWithTtl(
        cacheKey,
        JSON.stringify(processed),
        mediaType,
        ttlSeconds
      ).catch(() => {})
    } catch (err) {
      if (cancelledRef.current || currentKeyRef.current !== cacheKey) return

      // On background revalidation failure with existing data — silent fail
      if (isBackground && data.length > 0) {
        setIsRevalidating(false)
        return
      }

      // On initial load failure with no data — show error
      setError(err instanceof Error ? err.message : 'Failed to load')
      setLoading(false)
      setIsRevalidating(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, fetcher, ttlSeconds, mediaType, deduplicate])

  const refetch = useCallback(async () => {
    await fetchAndUpdate(false)
  }, [fetchAndUpdate])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }

    cancelledRef.current = false
    currentKeyRef.current = cacheKey

    const run = async () => {
      try {
        // Step 1: Check cache
        const cached = await getDiscoverCacheWithFreshness(cacheKey)

        if (cancelledRef.current) return

        if (cached) {
          // We have cached data — show it immediately
          const cachedResults: SearchResult[] = JSON.parse(cached.data)
          if (cachedResults.length > 0) {
            setData(cachedResults)
            setLoading(false) // No spinner — we have data
            setError(null)

            if (cached.is_fresh) {
              // Cache is fresh — done, no API call needed
              return
            }

            // Cache is stale — revalidate in background
            fetchAndUpdate(true)
            return
          }
        }

        // No cache or empty cache — initial load with spinner
        setLoading(true)
        fetchAndUpdate(false)
      } catch {
        // Cache read failed — fall through to API
        if (cancelledRef.current) return
        setLoading(true)
        fetchAndUpdate(false)
      }
    }

    run()

    return () => {
      cancelledRef.current = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, enabled])

  return { data, loading, isRevalidating, error, hasNextPage, refetch }
}
