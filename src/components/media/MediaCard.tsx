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
    <button
      onClick={onClick}
      className="group relative w-full aspect-[2/3] rounded-md overflow-hidden bg-[var(--color-bg-secondary)] cursor-pointer animate-scale-hover focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]"
    >
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

      {/* Overlay on Hover */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <div className="absolute bottom-0 left-0 right-0 p-4">
          {/* Title */}
          <h3 className="text-base font-semibold text-white line-clamp-2 mb-2">
            {media.title}
          </h3>

          {/* Metadata */}
          <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
            {media.year && <span>{media.year}</span>}
            {media.status && (
              <>
                <span>•</span>
                <span className="capitalize">{media.status.toLowerCase()}</span>
              </>
            )}
          </div>

          {/* Description (if available) */}
          {media.description && (
            <p className="mt-2 text-xs text-[var(--color-text-secondary)] line-clamp-3">
              {media.description}
            </p>
          )}
        </div>
      </div>

      {/* Top Badge (Status) */}
      {media.status && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-black/70 rounded text-xs font-medium">
          {media.status}
        </div>
      )}
    </button>
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
