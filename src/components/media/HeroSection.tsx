/**
 * HeroSection Component
 *
 * Large featured content section with Netflix-style presentation
 * - 16:9 aspect ratio banner
 * - Gradient overlay
 * - Title, description, and metadata
 * - Primary action buttons (Play/Watch, More Info)
 */

import { useState, useEffect } from 'react'
import { Play, Info, Film, X } from 'lucide-react'
import type { SearchResult } from '@/types/extension'

interface HeroSectionProps {
  media: SearchResult
  onWatch: () => void
  onMoreInfo: () => void
  totalItems?: number
  currentIndex?: number
  onIndexChange?: (index: number) => void
  onTrailerStateChange?: (playing: boolean) => void
}

export function HeroSection({
  media,
  onWatch,
  onMoreInfo,
  totalItems = 1,
  currentIndex = 0,
  onIndexChange,
  onTrailerStateChange
}: HeroSectionProps) {
  const [showTrailer, setShowTrailer] = useState(false)

  // Build embed URL with autoplay + mute for inline playback
  const trailerEmbedUrl = media.trailer_url
    ? media.trailer_url.includes('?')
      ? `${media.trailer_url}&mute=1`
      : `${media.trailer_url}?autoplay=1&mute=1`
    : null

  // Reset trailer when media changes (hero rotation)
  useEffect(() => {
    setShowTrailer(false)
  }, [media.id])

  // Notify parent when trailer state changes
  useEffect(() => {
    onTrailerStateChange?.(showTrailer)
  }, [showTrailer])

  return (
    <div className="relative w-full aspect-[16/9] mb-8 rounded-lg overflow-hidden group">
      {/* Background Image */}
      {media.cover_url ? (
        <img
          src={media.cover_url}
          alt={media.title}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${showTrailer ? 'opacity-0' : 'opacity-100'}`}
        />
      ) : (
        <div className="absolute inset-0 bg-[var(--color-bg-secondary)]" />
      )}

      {/* YouTube Trailer Embed (dev mode only) */}
      {showTrailer && trailerEmbedUrl && (
        <iframe
          src={trailerEmbedUrl}
          className="absolute inset-0 w-full h-full z-[5]"
          allow="autoplay; encrypted-media"
          allowFullScreen
          title={`${media.title} trailer`}
        />
      )}

      {/* Gradient Overlay (hidden during trailer) */}
      <div className={`absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-transparent z-10 transition-opacity duration-500 ${showTrailer ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} />

      {/* Content (hidden during trailer) */}
      <div className={`absolute inset-0 flex items-center px-8 md:px-12 lg:px-16 z-10 transition-opacity duration-500 ${showTrailer ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
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

            {trailerEmbedUrl && import.meta.env.DEV && (
              <button
                onClick={() => setShowTrailer(true)}
                className="flex items-center gap-2 px-6 py-3 bg-white/20 text-white font-semibold rounded hover:bg-white/30 transition-colors backdrop-blur-sm"
              >
                <Film size={20} />
                <span>Trailer</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Close Trailer Button */}
      {showTrailer && (
        <button
          onClick={() => setShowTrailer(false)}
          className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-black/70 hover:bg-black/90 flex items-center justify-center transition-colors"
          aria-label="Close trailer"
        >
          <X size={20} />
        </button>
      )}

      {/* Carousel Indicators - Left Side Horizontal */}
      {totalItems > 1 && onIndexChange && !showTrailer && (
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
