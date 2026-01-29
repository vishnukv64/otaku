/**
 * MediaCard Component
 *
 * Displays anime/manga with cover image, title, and metadata.
 * Features Netflix-style hover scale effect (1.15x).
 * Supports status badges for library, favorites, and watch/read progress.
 */

import type { SearchResult } from '@/types/extension'
import type { MediaStatus } from '@/contexts/MediaStatusContext'
import { getShortStatusLabel, getStatusColor } from '@/contexts/MediaStatusContext'
import { Heart, BookmarkCheck } from 'lucide-react'

/** Format episode date for display */
function formatEpisodeDate(epDate: { year: number; month: number; date: number }): string {
  const now = new Date()
  const episodeDate = new Date(epDate.year, epDate.month, epDate.date)
  const diffTime = now.getTime() - episodeDate.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`

  // Format as "Jan 22"
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[epDate.month]} ${epDate.date}`
}

/** Check if anime is currently airing */
function isAiring(status?: string): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s === 'releasing' || s === 'ongoing' || s === 'airing' || s === 'currently airing'
}

interface MediaCardProps {
  media: SearchResult
  onClick?: () => void
  /** Progress bar for continue watching/reading */
  progress?: {
    current: number
    total: number
    episodeNumber?: number
    /** True when this is the next episode to watch (previous was completed) */
    isNextEpisode?: boolean
  }
  /** Media status from useMediaStatus hook */
  status?: MediaStatus
}

export function MediaCard({ media, onClick, progress, status }: MediaCardProps) {
  // Determine which badges to show
  const showFavorite = status?.isFavorite
  const showLibraryStatus = status?.inLibrary && status.libraryStatus && !progress
  const showInProgress = !progress && (status?.isWatching || status?.isReading)

  // Latest episode badge for airing anime
  const showLatestEpisode = !progress && isAiring(media.status) && media.latest_episode && media.latest_episode_date

  // Debug: Log if airing anime is missing episode date
  if (isAiring(media.status) && (!media.latest_episode || !media.latest_episode_date)) {
    console.log('[MediaCard] Airing anime missing episode data:', media.title, {
      status: media.status,
      latest_episode: media.latest_episode,
      latest_episode_date: media.latest_episode_date
    })
  }

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

        {/* Status Badges - Top Right Corner (horizontal layout) */}
        <div className="absolute top-1.5 right-1.5 flex flex-row items-center gap-1">
          {/* Currently Watching/Reading Badge */}
          {showInProgress && (
            <div
              className="px-1.5 py-0.5 bg-blue-500/90 text-white text-[10px] font-semibold rounded"
              title={status?.isWatching ? 'Currently Watching' : 'Currently Reading'}
            >
              {status?.isWatching ? 'Watching' : 'Reading'}
            </div>
          )}

          {/* In Library Badge (only show if not showing progress) */}
          {showLibraryStatus && !showInProgress && (
            <div
              className={`px-1.5 py-0.5 ${getStatusColor(status.libraryStatus!)} text-white text-[10px] font-semibold rounded flex items-center gap-1`}
              title={`In Library: ${getShortStatusLabel(status.libraryStatus!)}`}
            >
              <BookmarkCheck size={10} />
              <span className="hidden sm:inline">{getShortStatusLabel(status.libraryStatus!)}</span>
            </div>
          )}

          {/* Favorite Badge */}
          {showFavorite && (
            <div className="p-1 bg-red-500/90 rounded" title="Favorite">
              <Heart size={12} className="text-white fill-white" />
            </div>
          )}
        </div>

        {/* Progress Bar (only for partially watched, not for next episode) */}
        {progress && !progress.isNextEpisode && progress.total > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
            <div
              className="h-full bg-[var(--color-accent-primary)]"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        )}

        {/* Latest Episode Badge (for airing anime) */}
        {showLatestEpisode && (
          <div
            className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-emerald-500/90 text-white text-[10px] font-semibold rounded"
            title={`Latest: Episode ${media.latest_episode}`}
          >
            EP {media.latest_episode} • {formatEpisodeDate(media.latest_episode_date!)}
          </div>
        )}

        {/* Continue Watching Badge */}
        {progress && (
          <>
            <div className={`absolute top-2 left-2 px-2 py-1 text-white text-xs font-semibold rounded ${
              progress.isNextEpisode ? 'bg-green-500' : 'bg-[var(--color-accent-primary)]'
            }`}>
              {progress.isNextEpisode ? `Next: EP ${progress.episodeNumber}` : `EP ${progress.episodeNumber}`}
            </div>
            {/* Resume/Play indicator on hover */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                progress.isNextEpisode ? 'bg-green-500' : 'bg-[var(--color-accent-primary)]'
              }`}>
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="text-sm font-bold">{progress.isNextEpisode ? 'PLAY NEXT' : 'RESUME'}</span>
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
