/**
 * VerticalScrollView - Smooth vertical scroll mode for manga reading
 * Optimized to prevent layout shifts and provide buttery-smooth scrolling
 *
 * Webtoon mode (gap=0): Images are stacked seamlessly with consistent width
 * Vertical mode (gap>0): Images are displayed with gaps between them
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Loader2, ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChapterImage } from '@/types/extension'
import { FitMode } from '@/store/readerStore'

interface VerticalScrollViewProps {
  images: ChapterImage[]
  fitMode: FitMode
  zoom: number
  onPageChange: (page: number) => void
  initialPage?: number
  preloadCount?: number
  gap?: number
  className?: string
}

// Max width for webtoon mode to ensure consistent image widths
const WEBTOON_MAX_WIDTH = 800

interface ImageState {
  loaded: boolean
  error: boolean
}

export function VerticalScrollView({
  images,
  fitMode,
  zoom,
  onPageChange,
  initialPage = 1,
  preloadCount = 5,
  gap = 0,
  className,
}: VerticalScrollViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const [imageStates, setImageStates] = useState<Map<number, ImageState>>(new Map())

  // Use refs for scroll tracking to avoid re-renders during scroll
  const visiblePageRef = useRef(initialPage)
  const hasScrolledToInitial = useRef(false)
  const onPageChangeRef = useRef(onPageChange)

  // Keep onPageChange ref updated
  useEffect(() => {
    onPageChangeRef.current = onPageChange
  }, [onPageChange])

  // State for triggering preload range updates (throttled)
  const [preloadCenter, setPreloadCenter] = useState(initialPage)

  // Scroll to initial page only once on mount
  useEffect(() => {
    if (initialPage > 1 && !hasScrolledToInitial.current && containerRef.current) {
      const timer = setTimeout(() => {
        const targetRef = imageRefs.current.get(initialPage)
        if (targetRef) {
          targetRef.scrollIntoView({ behavior: 'auto', block: 'start' })
          hasScrolledToInitial.current = true
        }
      }, 100)
      return () => clearTimeout(timer)
    } else {
      hasScrolledToInitial.current = true
    }
  }, [initialPage]) // Re-run when initialPage changes

  // Track visible page using Intersection Observer - no state updates during scroll
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0
        let mostVisiblePage = visiblePageRef.current

        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            const page = parseInt(entry.target.getAttribute('data-page') || '1', 10)
            maxRatio = entry.intersectionRatio
            mostVisiblePage = page
          }
        })

        // Only call onPageChange if page actually changed
        if (mostVisiblePage !== visiblePageRef.current && maxRatio > 0.2) {
          visiblePageRef.current = mostVisiblePage
          // Use ref to call without causing dependency changes
          onPageChangeRef.current(mostVisiblePage)
        }
      },
      {
        root: containerRef.current,
        rootMargin: '-30% 0px -30% 0px', // Consider middle 40% of viewport
        threshold: [0, 0.1, 0.2, 0.3, 0.5],
      }
    )

    // Observe all image containers
    imageRefs.current.forEach((ref) => {
      observer.observe(ref)
    })

    return () => observer.disconnect()
  }, [images.length]) // Only recreate observer when images change

  // Throttled preload center update (every 500ms max)
  useEffect(() => {
    const updatePreloadCenter = () => {
      if (visiblePageRef.current !== preloadCenter) {
        setPreloadCenter(visiblePageRef.current)
      }
    }

    // Use a slower interval to update preload range
    const intervalId = setInterval(updatePreloadCenter, 500)

    return () => {
      clearInterval(intervalId)
    }
  }, [preloadCenter])

  const handleImageLoad = useCallback((page: number) => {
    setImageStates(prev => {
      const newMap = new Map(prev)
      newMap.set(page, { loaded: true, error: false })
      return newMap
    })
  }, [])

  const handleImageError = useCallback((page: number) => {
    setImageStates(prev => {
      const newMap = new Map(prev)
      newMap.set(page, { loaded: true, error: true })
      return newMap
    })
  }, [])

  // Memoize shouldLoadImage check
  const shouldLoadImage = useCallback((page: number): boolean => {
    return Math.abs(page - preloadCenter) <= preloadCount
  }, [preloadCenter, preloadCount])

  // Check if we're in seamless webtoon mode (no gap between images)
  const isWebtoonMode = gap === 0

  // Memoize image style
  const imageStyle = useMemo((): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      transform: zoom !== 1 ? `scale(${zoom})` : undefined,
      transformOrigin: 'top center',
    }

    // In webtoon mode, force consistent width for seamless stacking
    if (isWebtoonMode) {
      return {
        ...baseStyle,
        width: '100%',
        height: 'auto',
        display: 'block', // Remove any inline spacing
      }
    }

    switch (fitMode) {
      case 'width':
        return { ...baseStyle, width: '100%', height: 'auto' }
      case 'height':
        return { ...baseStyle, maxHeight: '100vh', width: 'auto' }
      case 'original':
        return { ...baseStyle }
      case 'contain':
      default:
        return { ...baseStyle, maxWidth: '100%', height: 'auto' }
    }
  }, [fitMode, zoom, isWebtoonMode])

  return (
    <div
      ref={containerRef}
      className={cn(
        'w-full h-full overflow-y-auto overflow-x-hidden',
        className
      )}
      style={{
        WebkitOverflowScrolling: 'touch', // Smooth momentum scrolling on iOS/macOS
        overscrollBehavior: 'contain', // Prevent scroll chaining
        scrollBehavior: 'smooth', // Smooth scroll for better UX
      }}
    >
      {/*
        Webtoon mode: Use a fixed-width centered container so all images align perfectly
        Vertical mode: Use full width with centered images
      */}
      <div
        className={cn(
          'flex flex-col w-full',
          isWebtoonMode ? 'mx-auto' : 'items-center'
        )}
        style={{
          gap: `${gap}px`,
          maxWidth: isWebtoonMode ? `${WEBTOON_MAX_WIDTH}px` : undefined,
        }}
      >
        {images.map((image) => {
          const state = imageStates.get(image.page)
          const isLoaded = state?.loaded ?? false
          const hasError = state?.error ?? false
          const shouldLoad = shouldLoadImage(image.page)

          return (
            <div
              key={image.page}
              ref={(el) => {
                if (el) {
                  imageRefs.current.set(image.page, el)
                  el.setAttribute('data-page', String(image.page))
                }
              }}
              className={cn(
                'relative',
                isWebtoonMode ? 'w-full' : 'w-full flex justify-center'
              )}
            >
              {/* Error state */}
              {hasError && (
                <div className="flex flex-col items-center justify-center py-20 text-[var(--color-text-muted)]">
                  <ImageOff className="w-12 h-12 mb-2" />
                  <p className="text-sm">Failed to load page {image.page}</p>
                </div>
              )}

              {/* Image with loading indicator overlay */}
              {shouldLoad && !hasError && (
                <div className={cn('relative', isWebtoonMode && 'w-full')}>
                  {/* Loading spinner - shown while image loads */}
                  {!isLoaded && (
                    <div
                      className="flex items-center justify-center bg-[var(--color-bg-secondary)]/30"
                      style={{ minHeight: isWebtoonMode ? '300px' : '50vh', width: '100%' }}
                    >
                      <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
                    </div>
                  )}
                  <img
                    src={image.url}
                    alt={`Page ${image.page}`}
                    onLoad={() => handleImageLoad(image.page)}
                    onError={() => handleImageError(image.page)}
                    style={{
                      ...imageStyle,
                      display: isLoaded ? 'block' : 'none', // Hide until loaded to prevent layout shift
                    }}
                    className={cn('select-none', isWebtoonMode && 'w-full')}
                    loading="eager"
                    decoding="async"
                    draggable={false}
                  />
                </div>
              )}

              {/* Placeholder for images not yet in preload range */}
              {!shouldLoad && !isLoaded && (
                <div
                  className="w-full flex items-center justify-center bg-[var(--color-bg-secondary)]/20"
                  style={{
                    aspectRatio: isWebtoonMode ? '3/4' : '2/3',
                    maxHeight: isWebtoonMode ? '400px' : '100vh',
                  }}
                >
                  <span className="text-sm text-[var(--color-text-muted)]">Page {image.page}</span>
                </div>
              )}

              {/* If image was loaded before but now out of preload range, keep showing it */}
              {!shouldLoad && isLoaded && !hasError && (
                <img
                  src={image.url}
                  alt={`Page ${image.page}`}
                  style={imageStyle}
                  className={cn('block select-none', isWebtoonMode && 'w-full')}
                  draggable={false}
                />
              )}
            </div>
          )
        })}

        {/* Bottom padding for last page visibility */}
        <div className="h-[20vh]" />
      </div>
    </div>
  )
}
