/**
 * useProxiedImage - Fetches images through the Rust backend proxy
 *
 * Manga image servers often require specific headers (Referer, etc.) that
 * can't be set from <img> tags in the webview. This hook fetches image
 * bytes through the Rust proxy (which sets proper headers) and creates
 * blob URLs for display.
 *
 * Local URLs (asset://, blob:, data:) are passed through directly.
 *
 * Supports a `skip` parameter for lazy loading - when true, the hook
 * defers fetching until skip becomes false. Once fetched, the blob URL
 * persists even if skip goes back to true (avoids re-fetching on scroll).
 */

import { useState, useEffect, useRef } from 'react'
import { proxyImageRequest } from '@/utils/tauri-commands'

function isLocalUrl(url: string): boolean {
  return (
    url.startsWith('asset://') ||
    url.startsWith('https://asset.localhost/') ||
    url.startsWith('http://asset.localhost/') ||
    url.startsWith('blob:') ||
    url.startsWith('data:')
  )
}

export function useProxiedImage(
  url: string,
  skip = false,
): {
  src: string | null
  loading: boolean
  error: boolean
} {
  const [src, setSrc] = useState<string | null>(() =>
    isLocalUrl(url) ? url : null,
  )
  const [loading, setLoading] = useState(() => !isLocalUrl(url) && !skip)
  const [error, setError] = useState(false)

  const blobUrlRef = useRef<string | null>(null)
  const [prevUrl, setPrevUrl] = useState(url)

  // Handle URL changes (render-time state adjustment — React 18 pattern)
  if (prevUrl !== url) {
    setPrevUrl(url)
    if (isLocalUrl(url)) {
      setSrc(url)
      setLoading(false)
      setError(false)
    } else {
      setSrc(null)
      setLoading(!skip)
      setError(false)
    }
  }

  // Revoke blob URL when source URL changes or on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [url])

  // Fetch image through proxy
  useEffect(() => {
    if (isLocalUrl(url)) return
    if (blobUrlRef.current) return // Already fetched for this URL
    if (skip) {
      setLoading(false) // eslint-disable-line react-hooks/set-state-in-effect -- not loading while skipped
      return
    }

    let cancelled = false
    setLoading(true)
    setError(false)

    proxyImageRequest(url)
      .then((buffer) => {
        if (cancelled) return
        const blob = new Blob([buffer])
        const blobUrl = URL.createObjectURL(blob)
        blobUrlRef.current = blobUrl
        setSrc(blobUrl)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [url, skip])

  return { src, loading, error }
}
