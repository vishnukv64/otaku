/**
 * HeroSection Component
 *
 * Large featured content section with Netflix-style presentation
 * - 16:9 aspect ratio banner
 * - Gradient overlay
 * - Title, description, and metadata
 * - Primary action buttons (Play/Watch, More Info)
 */

import { Play, Info } from 'lucide-react'
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
  return (
    <div className="relative w-full aspect-[16/9] mb-8 rounded-lg overflow-hidden">
      {/* Background Image */}
      {media.cover_url ? (
        <img
          src={media.cover_url}
          alt={media.title}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-[var(--color-bg-secondary)]" />
      )}

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 flex items-center px-8 md:px-12 lg:px-16">
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
            {media.status && (
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
        <div className="absolute left-8 md:left-12 lg:left-16 bottom-8 flex items-center gap-2">
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
