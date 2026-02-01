/**
 * HeroSection Component
 *
 * Large featured content section with Netflix-style presentation
 * - 16:9 aspect ratio banner
 * - Gradient overlay
 * - Title, description, and metadata
 * - Primary action buttons (Play/Watch, More Info)
 */

import { Play, Info, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import type { SearchResult } from '@/types/extension'

interface HeroSectionProps {
  media: SearchResult
  onWatch: () => void
  onMoreInfo: () => void
  totalItems?: number
  currentIndex?: number
  onIndexChange?: (index: number) => void
}

export function HeroSection({
  media,
  onWatch,
  onMoreInfo,
  totalItems = 1,
  currentIndex = 0,
  onIndexChange
}: HeroSectionProps) {
  const autoplayTrailers = useSettingsStore((state) => state.autoplayTrailers)
  const [isMuted, setIsMuted] = useState(false)
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0)
  const [hasError, setHasError] = useState(false)

  const heroRef = useRef<HTMLDivElement>(null)

  // Extract all YouTube video IDs from trailer_url (comma-separated)
  const getVideoIds = (ids?: string): string[] => {
    if (!ids) return []
    return ids.split(',').filter(id => id.length === 11)
  }

  const videoIds = getVideoIds(media.trailer_url)
  const videoId = videoIds.length > 0 ? videoIds[currentVideoIndex] : null
  const hasTrailer = autoplayTrailers && videoId !== null && !hasError

  // Try next video when current one fails
  const handleVideoError = () => {
    console.log(`[HeroSection] Video ${videoId} failed, trying next...`)
    if (currentVideoIndex < videoIds.length - 1) {
      setCurrentVideoIndex(prev => prev + 1)
    } else {
      console.log('[HeroSection] All videos failed')
      setHasError(true)
    }
  }


  // Manual trailer navigation
  const handleNextTrailer = () => {
    if (currentVideoIndex < videoIds.length - 1) {
      setCurrentVideoIndex(prev => prev + 1)
    }
  }

  const handlePrevTrailer = () => {
    if (currentVideoIndex > 0) {
      setCurrentVideoIndex(prev => prev - 1)
    }
  }

  // Auto-mute when user scrolls past hero section
  useEffect(() => {
    if (!heroRef.current || !hasTrailer) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        // If hero section is less than 50% visible, mute
        if (entry.intersectionRatio < 0.5 && !isMuted) {
          console.log('[HeroSection] Scrolled out of view, muting')
          setIsMuted(true)
        }
        // If scrolled back into view, unmute
        else if (entry.intersectionRatio >= 0.5 && isMuted) {
          console.log('[HeroSection] Scrolled back into view, unmuting')
          setIsMuted(false)
        }
      },
      {
        threshold: [0.5], // Trigger when 50% visible/hidden
      }
    )

    observer.observe(heroRef.current)

    return () => {
      observer.disconnect()
    }
  }, [hasTrailer, isMuted])

  return (
    <div ref={heroRef} className="relative w-full aspect-[16/9] mb-8 rounded-lg overflow-hidden group">
      {/* Background - Trailer or Image */}
      {hasTrailer ? (
        <>
          <iframe
            key={`${videoId}-${isMuted}-${currentVideoIndex}`}
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${isMuted ? 1 : 0}&controls=0&loop=1&playlist=${videoId}&modestbranding=1&rel=0`}
            allow="autoplay; encrypted-media"
            onError={handleVideoError}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{
              transform: 'scale(1.5)',
              transformOrigin: 'center center',
              border: 'none'
            }}
          />
          {/* Trailer navigation (only if multiple trailers) */}
          {videoIds.length > 1 && (
            <>
              <button
                onClick={handlePrevTrailer}
                disabled={currentVideoIndex === 0}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm transition-all border border-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Previous trailer"
              >
                <ChevronLeft size={24} />
              </button>
              <button
                onClick={handleNextTrailer}
                disabled={currentVideoIndex === videoIds.length - 1}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm transition-all border border-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Next trailer"
              >
                <ChevronRight size={24} />
              </button>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-black/60 backdrop-blur-sm text-xs text-white/70 border border-white/20">
                Trailer {currentVideoIndex + 1} of {videoIds.length}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {/* Fallback Background Image */}
          {media.cover_url ? (
            <img
              src={media.cover_url}
              alt={media.title}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-[var(--color-bg-secondary)]" />
          )}
        </>
      )}

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-transparent z-10" />

      {/* Content */}
      <div className="absolute inset-0 flex items-center px-8 md:px-12 lg:px-16 z-10">
        <div className="max-w-2xl">
          {/* Title */}
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4 drop-shadow-lg">
            {media.title}
          </h1>

          {/* Metadata */}
          <div className="flex items-center gap-4 text-sm md:text-base mb-6">
            {media.rating && (
              <span className="flex items-center gap-1 text-yellow-400 font-bold text-lg">
                ★ {media.rating.toFixed(1)}
              </span>
            )}
            {media.year && (
              <>
                {media.rating && <span className="text-[var(--color-text-muted)]">•</span>}
                <span className="text-[var(--color-text-secondary)]">{media.year}</span>
              </>
            )}
            {media.status && media.status.toLowerCase() !== 'unknown' && (
              <>
                <span className="text-[var(--color-text-muted)]">•</span>
                <span className="text-[var(--color-text-secondary)] capitalize">
                  {media.status.toLowerCase()}
                </span>
              </>
            )}
          </div>

          {/* Description */}
          {media.description && (
            <p className="text-sm md:text-base text-[var(--color-text-secondary)] mb-8 line-clamp-3 max-w-xl">
              {media.description.replace(/<[^>]*>/g, '')} {/* Remove HTML tags */}
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-4">
            <button
              onClick={onWatch}
              className="flex items-center gap-2 px-6 py-3 bg-white text-black font-semibold rounded hover:bg-white/90 transition-colors"
            >
              <Play size={20} fill="currentColor" />
              <span>Watch Now</span>
            </button>

            <button
              onClick={onMoreInfo}
              className="flex items-center gap-2 px-6 py-3 bg-white/20 text-white font-semibold rounded hover:bg-white/30 transition-colors backdrop-blur-sm"
            >
              <Info size={20} />
              <span>More Info</span>
            </button>
          </div>
        </div>
      </div>

      {/* Carousel Indicators - Left Side Horizontal */}
      {totalItems > 1 && onIndexChange && (
        <div className="absolute left-8 md:left-12 lg:left-16 bottom-8 flex items-center gap-2 z-10">
          {Array.from({ length: totalItems }).map((_, index) => (
            <button
              key={index}
              onClick={() => onIndexChange(index)}
              className={`h-1 rounded-full transition-all ${
                index === currentIndex
                  ? 'w-12 bg-[var(--color-accent-primary)]'
                  : 'w-8 bg-white/40 hover:bg-white/60'
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
