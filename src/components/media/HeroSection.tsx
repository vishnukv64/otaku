/**
 * HeroSection Component
 *
 * Cinematic hero banner with auto-rotating carousel,
 * abyss-themed overlays, metadata chips, and action buttons.
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
    setShowTrailer(false) // eslint-disable-line react-hooks/set-state-in-effect
  }, [media.id])

  // Notify parent when trailer state changes
  useEffect(() => {
    onTrailerStateChange?.(showTrailer)
  }, [showTrailer])

  // Determine status chip variant
  const statusLower = media.status?.toLowerCase() || ''
  const isAiring = statusLower.includes('airing') || statusLower.includes('ongoing') || statusLower.includes('releasing')

  return (
    <div className="relative w-full aspect-[16/9] max-h-[70vh] mb-10 rounded-[var(--radius-xl)] overflow-hidden group">
      {/* Background Image */}
      {media.cover_url ? (
        <img
          src={media.cover_url}
          alt={media.title}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${showTrailer ? 'opacity-0' : 'opacity-100'}`}
        />
      ) : (
        <div className="absolute inset-0 bg-[var(--color-deep)]" />
      )}

      {/* YouTube Trailer Embed */}
      {showTrailer && trailerEmbedUrl && (
        <iframe
          src={trailerEmbedUrl}
          className="absolute inset-0 w-full h-full z-[5]"
          allow="autoplay; encrypted-media"
          allowFullScreen
          title={`${media.title} trailer`}
        />
      )}

      {/* Cinematic Overlay Layers (hidden during trailer) */}
      <div className={`transition-opacity duration-500 ${showTrailer ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {/* Left-to-right gradient for text readability */}
        <div
          className="absolute inset-0 z-[1]"
          style={{
            background: 'linear-gradient(to right, rgba(20,20,20,0.95), rgba(20,20,20,0.6) 50%, rgba(20,20,20,0.2))',
          }}
        />

        {/* Bottom-to-top gradient for seamless transition */}
        <div
          className="absolute inset-0 z-[2]"
          style={{
            background: 'linear-gradient(to top, rgba(20,20,20,0.8), transparent 40%)',
          }}
        />

        {/* Scan-lines effect */}
        <div
          className="absolute inset-0 z-[3] pointer-events-none"
          style={{
            background: 'repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)',
          }}
        />

        {/* Ambient accent glow */}
        <div
          className="absolute bottom-0 left-0 w-[500px] h-[300px] z-[3] pointer-events-none opacity-30"
          style={{
            background: 'radial-gradient(ellipse at bottom left, rgba(229,9,20,0.3), transparent 70%)',
          }}
        />
      </div>

      {/* Hero Content */}
      <div className={`absolute inset-0 flex items-end p-12 z-10 transition-opacity duration-500 ${showTrailer ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="max-w-[55%] min-w-[300px]">
          {/* Trending Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--color-accent-glow)] border border-[rgba(229,9,20,0.4)] text-[var(--color-accent-light)] text-xs font-bold uppercase tracking-[0.08em] mb-3 w-fit">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Trending Now
          </div>

          {/* Title */}
          <h1
            className="font-display font-extrabold mb-4 leading-[1.05] tracking-tight drop-shadow-[0_2px_20px_rgba(0,0,0,0.5)]"
            style={{ fontSize: 'clamp(2rem, 4vw, 4rem)', letterSpacing: '-0.02em' }}
          >
            {media.title}
          </h1>

          {/* Metadata Chips */}
          <div className="flex items-center gap-2.5 flex-wrap mb-4">
            {media.rating != null && media.rating > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.7rem] font-semibold font-mono text-[var(--color-gold)] bg-[rgba(245,197,24,0.08)] border border-[rgba(245,197,24,0.2)]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--color-gold)" stroke="none">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                {media.rating.toFixed(2)}
              </span>
            )}
            {media.media_type && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.7rem] font-semibold font-mono text-[var(--color-cyan)] bg-[rgba(6,182,212,0.08)] border border-[rgba(6,182,212,0.2)]">
                {media.media_type === 'anime' ? 'TV' : media.media_type.toUpperCase()}
              </span>
            )}
            {media.year && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.7rem] font-semibold font-mono text-[var(--color-text-muted)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)]">
                {media.year}
              </span>
            )}
            {media.status && statusLower !== 'unknown' && (
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.7rem] font-semibold font-mono ${
                isAiring
                  ? 'text-[var(--color-green)] bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.2)]'
                  : 'text-[var(--color-text-muted)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)]'
              }`}>
                {isAiring && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)] animate-pulse" />}
                {media.status}
              </span>
            )}
          </div>

          {/* Genre Tags */}
          {media.genres && media.genres.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-5">
              {media.genres.slice(0, 4).map((genre) => (
                <span
                  key={genre}
                  className="px-2.5 py-0.5 rounded-full text-xs text-[var(--color-text-secondary)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)]"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}

          {/* Description */}
          {media.description && (
            <p className="text-[0.9375rem] text-[var(--color-text-secondary)] mb-7 line-clamp-3 max-w-xl" style={{ lineHeight: '1.65' }}>
              {media.description.replace(/<[^>]*>/g, '')}
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-3.5">
            <button
              onClick={onWatch}
              className="flex items-center gap-2 px-6 py-2.5 rounded-[var(--radius-md)] font-semibold text-white transition-all duration-200 shadow-[0_0_30px_rgba(229,9,20,0.35)] hover:shadow-[0_0_50px_rgba(229,9,20,0.45)] hover:brightness-110"
              style={{ background: 'var(--accent-gradient)' }}
            >
              <Play size={18} fill="currentColor" />
              <span>Watch Now</span>
            </button>

            <button
              onClick={onMoreInfo}
              className="flex items-center gap-2 px-6 py-2.5 rounded-[var(--radius-md)] font-semibold text-white bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] backdrop-blur-sm hover:bg-[rgba(255,255,255,0.15)] transition-all duration-200"
            >
              <Info size={18} />
              <span>More Info</span>
            </button>

            {trailerEmbedUrl && import.meta.env.DEV && (
              <button
                onClick={() => setShowTrailer(true)}
                className="flex items-center gap-2 px-6 py-2.5 rounded-[var(--radius-md)] font-semibold text-white bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] backdrop-blur-sm hover:bg-[rgba(255,255,255,0.15)] transition-all duration-200"
              >
                <Film size={18} />
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

      {/* Carousel Dot Indicators */}
      {totalItems > 1 && onIndexChange && !showTrailer && (
        <div className="absolute top-6 right-6 flex items-center gap-1.5 z-10">
          {Array.from({ length: totalItems }).map((_, index) => (
            <button
              key={index}
              onClick={() => onIndexChange(index)}
              className={`rounded-full transition-all duration-300 ${
                index === currentIndex
                  ? 'w-6 h-1.5 rounded-[3px] bg-[var(--color-accent-mid)] shadow-[0_0_10px_var(--color-accent-primary)]'
                  : 'w-1.5 h-1.5 bg-white/30 hover:bg-white/50'
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
