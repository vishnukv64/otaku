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
}

export function MediaCard({ media, onClick }: MediaCardProps) {
  return (
    <div className="group cursor-pointer" onClick={onClick}>
      <div className="relative w-full aspect-[2/3] rounded-md overflow-hidden bg-[var(--color-bg-secondary)] animate-scale-hover focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]">
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
              {media.status && (
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
    </div>
  )
}

/**
 * MediaCardSkeleton - Loading state
 */
export function MediaCardSkeleton() {
  return (
    <div className="w-full aspect-[2/3] rounded-md overflow-hidden bg-[var(--color-bg-secondary)] animate-pulse">
      <div className="w-full h-full bg-[var(--color-bg-hover)]" />
    </div>
  )
}
