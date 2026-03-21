/**
 * Shared proxy image cache for manga page preloading
 *
 * Module-level cache that stores blob URLs for proxied images.
 * Used by the MangaReader preloader to fetch upcoming pages ahead of time,
 * and by useProxiedImage to check for pre-cached images before fetching.
 *
 * Concurrency-limited: Only MAX_CONCURRENT requests run simultaneously.
 * This prevents bandwidth flooding when many pages are requested at once
 * (e.g., VerticalScrollView loading all visible pages). Queued requests
 * execute in FIFO order, so the nearest pages (requested first) load first.
 *
 * Lifecycle: cache is cleared when chapter changes (via clearProxyImageCache).
 */

import { proxyImageRequest } from '@/utils/tauri-commands'

/** url → blob URL */
const cache = new Map<string, string>()

/** url → in-flight promise (deduplicates concurrent requests) */
const inflight = new Map<string, Promise<string>>()

/** Concurrency limiter */
const MAX_CONCURRENT = 3
let activeCount = 0
const queue: Array<() => void> = []

function processQueue() {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift()!
    activeCount++
    next()
  }
}

/**
 * Fetch an image through the proxy and cache its blob URL.
 * Deduplicates concurrent requests for the same URL.
 * Respects concurrency limit to avoid bandwidth flooding.
 */
export async function preloadImage(url: string): Promise<string> {
  const cached = cache.get(url)
  if (cached) {
    console.log(`[preload] cache HIT for ${url.slice(-40)}`)
    return cached
  }

  const existing = inflight.get(url)
  if (existing) {
    console.log(`[preload] dedup (already in-flight) ${url.slice(-40)}`)
    return existing
  }

  const start = performance.now()
  const promise = new Promise<string>((resolve, reject) => {
    const execute = () => {
      console.log(`[preload] fetching ${url.slice(-40)} (active: ${activeCount}/${MAX_CONCURRENT}, queued: ${queue.length})`)
      proxyImageRequest(url)
        .then((buffer) => {
          const blob = new Blob([buffer])
          const blobUrl = URL.createObjectURL(blob)
          cache.set(url, blobUrl)
          inflight.delete(url)
          activeCount--
          console.log(`[preload] cached ${url.slice(-40)} (${Math.round(performance.now() - start)}ms, ${(buffer.byteLength / 1024).toFixed(0)}KB)`)
          processQueue()
          resolve(blobUrl)
        })
        .catch((err) => {
          inflight.delete(url)
          activeCount--
          console.error(`[preload] FAILED ${url.slice(-40)}`, err)
          processQueue()
          reject(err)
        })
    }

    if (activeCount < MAX_CONCURRENT) {
      activeCount++
      execute()
    } else {
      console.log(`[preload] queued ${url.slice(-40)} (position ${queue.length + 1})`)
      queue.push(execute)
    }
  })

  inflight.set(url, promise)
  return promise
}

/** Check if a URL has a cached blob URL */
export function getCachedImageUrl(url: string): string | null {
  return cache.get(url) ?? null
}

/** Check if a URL is currently being fetched */
export function isImageInFlight(url: string): boolean {
  return inflight.has(url)
}

/** Revoke all blob URLs and clear the cache. Call when changing chapters. */
export function clearProxyImageCache(): void {
  cache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl))
  cache.clear()
  inflight.clear()
  queue.length = 0
  activeCount = 0
}
