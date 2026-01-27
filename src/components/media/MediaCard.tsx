/**
 * MediaCard Component
 *
 * Displays anime/manga with cover image, title, and metadata.
 * Features Netflix-style hover scale effect (1.15x).
 */

import type { SearchResult } from '@/types/extension'

interface MediaCardProps {
  media: SearchResult
  onClick?: () => void
  progress?: {
    current: number
    total: number
    episodeNumber?: number
  }
}

export function MediaCard({ media, onClick, progress }: MediaCardProps) {
  return (
    <button
      className="group cursor-pointer w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)] rounded-md"
      onClick={onClick}
    >
      <div className="relative w-full aspect-[2/3] rounded-md overflow-hidden bg-[var(--color-bg-secondary)] animate-scale-hover">
        {/* Cover Image */}
        {media.cover_url ? (
          <img
            src={media.cover_url}
            alt={media.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl">
            📺
          </div>
        )}

        {/* Progress Bar */}
        {progress && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
            <div
              className="h-full bg-[var(--color-accent-primary)]"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        )}

        {/* Continue Watching Badge */}
        {progress && (
          <>
            <div className="absolute top-2 left-2 px-2 py-1 bg-[var(--color-accent-primary)] text-white text-xs font-semibold rounded">
              EP {progress.episodeNumber}
            </div>
            {/* Resume indicator on hover */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50">
              <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-accent-primary)] rounded-lg">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="text-sm font-bold">RESUME</span>
              </div>
            </div>
          </>
        )}

        {/* Hover Overlay with Additional Info */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="absolute bottom-0 left-0 right-0 p-4">
            {/* Metadata on hover */}
            <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)] mb-2">
              {media.rating && (
                <span className="flex items-center gap-1 text-yellow-400 font-semibold">
                  ★ {media.rating.toFixed(1)}
                </span>
              )}
              {media.year && (
                <>
                  {media.rating && <span>•</span>}
                  <span>{media.year}</span>
                </>
              )}
              {media.status && media.status.toLowerCase() !== 'unknown' && (
                <>
                  <span>•</span>
                  <span className="capitalize">{media.status.toLowerCase()}</span>
                </>
              )}
            </div>

            {/* Description (if available) */}
            {media.description && (
              <p className="text-xs text-[var(--color-text-secondary)] line-clamp-3">
                {media.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Title - Always Visible Below Image */}
      <div className="mt-2 px-1">
        <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">
          {media.title}
        </h3>
      </div>
    </button>
  )
}

/**
 * MediaCardSkeleton - Loading state with shimmer effect
 */
export function MediaCardSkeleton() {
  return (
    <div className="group">
      <div className="relative w-full aspect-[2/3] rounded-md overflow-hidden bg-[var(--color-bg-secondary)]">
        <div className="absolute inset-0 shimmer-bg" />
      </div>

      {/* Title skeleton */}
      <div className="mt-2 px-1 space-y-2">
        <div className="h-3 bg-[var(--color-bg-secondary)] rounded shimmer-bg w-full" />
        <div className="h-3 bg-[var(--color-bg-secondary)] rounded shimmer-bg w-2/3" />
      </div>
    </div>
  )
}
