/**
 * MediaCard Component
 *
 * Displays anime/manga with cover image, title, and metadata.
 * Features Netflix-style hover scale effect with popover.
 * Supports status badges for library, favorites, and watch/read progress.
 */

import { useState, useEffect } from 'react'
import type { SearchResult } from '@/types/extension'
import type { MediaStatus } from '@/contexts/MediaStatusContext'
import { getShortStatusLabel, getStatusColor } from '@/contexts/MediaStatusContext'
import { Heart, BookmarkCheck, Bell } from 'lucide-react'
import { hasNewEpisode } from '@/utils/mediaHelpers'

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
  return s === 'releasing' || s === 'ongoing' || s === 'airing' || s === 'currently airing' || s.includes('airing') || s.includes('ongoing') || s.includes('releasing')
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
  const [showNewBadge, setShowNewBadge] = useState(false)

  // Check for new episodes
  useEffect(() => {
    // Only check if:
    // 1. User is tracking/watching
    // 2. Not in progress view
    // 3. Anime is currently airing (not finished)
    if (!progress && (status?.isTracked || status?.isWatching) && isAiring(media.status)) {
      hasNewEpisode(media).then(setShowNewBadge).catch(() => setShowNewBadge(false))
    } else {
      setShowNewBadge(false)
    }
  }, [media, media.id, media.latest_episode, media.status, progress, status?.isTracked, status?.isWatching])

  // Badge priority system (show only the most relevant badge on the right)
  // Priority: Favorite > Currently Watching/Reading > Library Status > Tracking
  let rightBadge: 'favorite' | 'watching' | 'library' | 'tracking' | null = null

  if (status?.isFavorite) {
    rightBadge = 'favorite'
  } else if (!progress && (status?.isWatching || status?.isReading)) {
    rightBadge = 'watching'
  } else if (!progress && status?.inLibrary && status.libraryStatus) {
    rightBadge = 'library'
  } else if (status?.isTracked) {
    rightBadge = 'tracking'
  }

  // Latest episode badge for airing anime (hide if showing NEW badge)
  const showLatestEpisode = !progress && !showNewBadge && isAiring(media.status) && media.latest_episode && media.latest_episode_date

  return (
    <div className="relative w-full group/card">
      {/* Invisible spacer that maintains grid position */}
      <div className="w-full">
        <div className="aspect-[2/3]" />
        <div className="h-12" /> {/* Space for title */}
      </div>

      {/* Actual card - positioned absolute so it can scale without affecting layout */}
      <div className="absolute inset-0 transition-all duration-300 ease-out origin-top group-hover/card:scale-110 group-hover/card:z-50">
        <button
          className="w-full cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)] rounded-md"
          onClick={onClick}
        >
          <div className="relative w-full aspect-[2/3] rounded-md overflow-hidden bg-[var(--color-bg-secondary)] shadow-lg group-hover/card:shadow-2xl group-hover/card:shadow-black/60 transition-shadow duration-300">
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

            {/* Status Badge - Top Right Corner (single badge with priority) */}
            <div className="absolute top-1.5 right-1.5 pointer-events-auto">
              {rightBadge === 'favorite' && (
                <div
                  className="p-1.5 bg-red-500/90 rounded-md shadow-lg"
                  title="Favorite"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Heart size={14} className="text-white fill-white" />
                </div>
              )}

              {rightBadge === 'watching' && (
                <div
                  className="px-2 py-1 bg-blue-500/90 text-white text-[10px] font-semibold rounded-md shadow-lg"
                  title={status?.isWatching ? 'Currently Watching' : 'Currently Reading'}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  {status?.isWatching ? 'Watching' : 'Reading'}
                </div>
              )}

              {rightBadge === 'library' && status?.libraryStatus && (
                <div
                  className={`px-2 py-1 ${getStatusColor(status.libraryStatus)} text-white text-[10px] font-semibold rounded-md flex items-center gap-1 shadow-lg`}
                  title={`In Library: ${getShortStatusLabel(status.libraryStatus)}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <BookmarkCheck size={10} />
                  <span className="hidden sm:inline">{getShortStatusLabel(status.libraryStatus)}</span>
                </div>
              )}

              {rightBadge === 'tracking' && (
                <div
                  className="p-1.5 bg-indigo-500/90 rounded-md shadow-lg"
                  title="Tracking for new episodes"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Bell size={14} className="text-white" />
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

            {/* NEW Episode Badge (takes priority over latest episode) */}
            {showNewBadge && (
              <div
                className="absolute top-1.5 left-1.5 px-2 py-1 bg-emerald-500/20 border border-emerald-500/60 text-emerald-300 text-[10px] font-semibold rounded-md backdrop-blur-sm flex items-center gap-1"
                title={`New Episode ${media.latest_episode} Available!`}
              >
                <span className="w-1 h-1 bg-emerald-400 rounded-full" />
                <span>NEW</span>
              </div>
            )}

            {/* Latest Episode Badge (for airing anime) */}
            {showLatestEpisode && (
              <div
                className="absolute top-1.5 left-1.5 px-2 py-1 bg-emerald-500/90 text-white text-[10px] font-semibold rounded-md shadow-lg"
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
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity bg-black/50">
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
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-300">
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
      </div>
    </div>
  )
}

/**
 * MediaCardSkeleton - Loading state with shimmer effect
 */
export function MediaCardSkeleton() {
  return (
    <div className="relative w-full">
      <div className="w-full">
        <div className="aspect-[2/3] rounded-md bg-[var(--color-bg-secondary)]">
          <div className="absolute inset-0 shimmer-bg rounded-md" />
        </div>
        <div className="h-12" />
      </div>

      {/* Title skeleton */}
      <div className="absolute bottom-0 left-0 right-0 px-1 space-y-2">
        <div className="h-3 bg-[var(--color-bg-secondary)] rounded shimmer-bg w-full" />
        <div className="h-3 bg-[var(--color-bg-secondary)] rounded shimmer-bg w-2/3" />
      </div>
    </div>
  )
}
