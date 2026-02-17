import { useRef } from 'react'
import { Play, Info } from 'lucide-react'
import type { SearchResult } from '@/types/extension'

interface MobileHeroSectionProps {
  media: SearchResult
  onWatch: () => void
  onMoreInfo: () => void
  totalItems?: number
  currentIndex?: number
  onIndexChange?: (index: number) => void
}

export function MobileHeroSection({
  media,
  onWatch,
  onMoreInfo,
  totalItems = 1,
  currentIndex = 0,
  onIndexChange,
}: MobileHeroSectionProps) {
  const touchStartX = useRef(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!onIndexChange || totalItems <= 1) return
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(deltaX) < 50) return // ignore small swipes

    if (deltaX < 0) {
      // Swipe left → next
      const next = currentIndex + 1 < totalItems ? currentIndex + 1 : 0
      onIndexChange(next)
    } else {
      // Swipe right → previous
      const prev = currentIndex - 1 >= 0 ? currentIndex - 1 : totalItems - 1
      onIndexChange(prev)
    }
  }

  return (
    <div
      className="relative w-full rounded-lg overflow-hidden mb-6"
      style={{ height: '60vh' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Full-width poster background */}
      {media.cover_url ? (
        <img
          src={media.cover_url}
          alt={media.title}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-[var(--color-bg-secondary)]" />
      )}

      {/* Gradient overlay at bottom */}
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-primary)] via-black/50 to-transparent" />

      {/* Content overlaid at bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-5">
        {/* Title */}
        <h1 className="text-2xl font-bold mb-1.5 drop-shadow-lg line-clamp-2">
          {media.title}
        </h1>

        {/* Metadata */}
        <div className="flex items-center gap-3 text-sm mb-2">
          {media.rating && (
            <span className="flex items-center gap-1 text-yellow-400 font-bold">
              ★ {media.rating.toFixed(1)}
            </span>
          )}
          {media.year && (
            <>
              {media.rating && <span className="text-[var(--color-text-muted)]">·</span>}
              <span className="text-[var(--color-text-secondary)]">{media.year}</span>
            </>
          )}
          {media.status && media.status.toLowerCase() !== 'unknown' && (
            <>
              <span className="text-[var(--color-text-muted)]">·</span>
              <span className="text-[var(--color-text-secondary)] capitalize">
                {media.status.toLowerCase()}
              </span>
            </>
          )}
        </div>

        {/* Description */}
        {media.description && (
          <p className="text-xs text-[var(--color-text-secondary)] mb-4 line-clamp-2">
            {media.description.replace(/<[^>]*>/g, '')}
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={onWatch}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-white text-black font-semibold rounded text-sm"
          >
            <Play size={16} fill="currentColor" />
            Watch Now
          </button>
          <button
            onClick={onMoreInfo}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-white/20 text-white font-semibold rounded text-sm backdrop-blur-sm"
          >
            <Info size={16} />
            More Info
          </button>
        </div>

        {/* Carousel dots */}
        {totalItems > 1 && onIndexChange && (
          <div className="flex items-center gap-1.5 mt-4">
            {Array.from({ length: Math.min(totalItems, 20) }).map((_, index) => (
              <button
                key={index}
                onClick={() => onIndexChange(index)}
                className={`h-1 rounded-full transition-all ${
                  index === currentIndex
                    ? 'w-8 bg-[var(--color-accent-primary)]'
                    : 'w-5 bg-white/40'
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
