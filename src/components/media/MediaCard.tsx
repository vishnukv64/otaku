/**
 * MediaCard Component
 *
 * Displays anime/manga with cover image, title, and metadata.
 * Features Netflix-style hover scale effect with popover.
 * Supports status badges for library, favorites, and watch/read progress.
 *
 * Uses unified release state hook for NEW badge (V2 release tracking).
 */

import type { SearchResult } from '@/types/extension'
import type { MediaStatus } from '@/contexts/MediaStatusContext'
import { getShortStatusLabel, getStatusColor } from '@/contexts/MediaStatusContext'
import { Heart, BookmarkCheck, Bell } from 'lucide-react'
import { useReleaseState } from '@/hooks/useReleaseStates'

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
  /** Rank number to display (e.g., 1-10 for Top 10 carousel) */
  rank?: number
}

export function MediaCard({ media, onClick, progress, status, rank }: MediaCardProps) {
  // Use unified release state hook (V2) for NEW badge
  // Only fetch release state if user is tracking/watching this media
  const shouldCheckRelease = !progress && (status?.isTracked || status?.isWatching) && isAiring(media.status)
  const { hasNewRelease } = useReleaseState(shouldCheckRelease ? media.id : undefined)

  // Show NEW badge when:
  // 1. User is tracking/watching
  // 2. Not in progress view (continue watching section)
  // 3. Anime is currently airing
  // 4. V2 release tracking detected a new release
  const showNewBadge = shouldCheckRelease && hasNewRelease

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
      <button
        className="w-full cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)] rounded-[var(--radius-md)] transition-all duration-300 hover:-translate-y-1.5 hover:scale-[1.02]"
        onClick={onClick}
        style={{
          filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.5))',
        }}
      >
        <div
          className="relative w-full aspect-[2/3] rounded-[var(--radius-md)] overflow-hidden bg-[var(--color-card)] transition-shadow duration-300 group-hover/card:shadow-[0_16px_60px_rgba(0,0,0,0.6),0_0_30px_rgba(229,9,20,0.25),0_0_0_1px_rgba(255,255,255,0.16)]"
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
            <div className="w-full h-full flex items-center justify-center bg-[var(--color-panel)]">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" strokeWidth="1.5">
                <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
                <polyline points="17 2 12 7 7 2" />
              </svg>
            </div>
          )}

          {/* Status Badge - Top Right Corner */}
          <div className="absolute top-1.5 right-1.5 pointer-events-auto">
            {rightBadge === 'favorite' && (
              <div
                className="p-1.5 bg-red-500/90 rounded-md shadow-lg backdrop-blur-sm"
                title="Favorite"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <Heart size={14} className="text-white fill-white" />
              </div>
            )}

            {rightBadge === 'watching' && (
              <div
                className="px-2 py-1 bg-blue-500/90 text-white text-[10px] font-semibold rounded-md shadow-lg backdrop-blur-sm"
                title={status?.isWatching ? 'Currently Watching' : 'Currently Reading'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {status?.isWatching ? 'Watching' : 'Reading'}
              </div>
            )}

            {rightBadge === 'library' && status?.libraryStatus && (
              <div
                className={`px-2 py-1 ${getStatusColor(status.libraryStatus)} text-white text-[10px] font-semibold rounded-md flex items-center gap-1 shadow-lg backdrop-blur-sm`}
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
                className="p-1.5 bg-indigo-500/90 rounded-md shadow-lg backdrop-blur-sm"
                title="Tracking for new episodes"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <Bell size={14} className="text-white" />
              </div>
            )}
          </div>

          {/* NEW Episode Badge */}
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
              className="absolute top-1.5 left-1.5 px-2 py-1 bg-emerald-500/90 text-white text-[10px] font-semibold rounded-md shadow-lg backdrop-blur-sm"
              title={`Latest: Episode ${media.latest_episode}`}
            >
              EP {media.latest_episode} • {formatEpisodeDate(media.latest_episode_date!)}
            </div>
          )}

          {/* Continue Watching Badge */}
          {progress && (
            <div className={`absolute top-2 left-2 px-2 py-1 text-white text-xs font-semibold rounded backdrop-blur-sm ${
              progress.isNextEpisode ? 'bg-green-500/90' : 'bg-[var(--color-accent-primary)]/90'
            }`}>
              {progress.isNextEpisode ? `Next: EP ${progress.episodeNumber}` : `EP ${progress.episodeNumber}`}
            </div>
          )}

          {/* Circular Play Button Overlay (on hover) */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 bg-[rgba(20,20,20,0.5)]">
            <div className="w-[42px] h-[42px] rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center shadow-[0_0_30px_rgba(229,9,20,0.45)] transition-transform duration-200 hover:scale-110">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          </div>

          {/* Bottom Gradient Overlay with Title & Score */}
          <div className="absolute bottom-0 left-0 right-0 p-3 pt-10 bg-gradient-to-t from-[rgba(20,20,20,0.98)] via-[rgba(20,20,20,0.7)] to-transparent pointer-events-none">
            <h3 className="text-sm font-semibold font-display text-white line-clamp-2 leading-tight mb-1.5">
              {media.title}
            </h3>
            <div className="flex items-center gap-2">
              {media.rating != null && media.rating > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-semibold font-mono text-[var(--color-gold)] bg-[rgba(245,197,24,0.08)] border border-[rgba(245,197,24,0.2)]">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--color-gold)" stroke="none">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  {media.rating.toFixed(1)}
                </span>
              )}
              {media.media_type && (
                <span className="text-[0.7rem] text-[var(--color-text-muted)] uppercase">
                  {media.media_type === 'anime' ? 'TV' : media.media_type}
                </span>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {progress && !progress.isNextEpisode && progress.total > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/60 z-[2]">
              <div
                className="h-full bg-[var(--color-accent-primary)]"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          )}

          {/* Rank Number Overlay (for Top 10 carousel) */}
          {rank != null && (
            <div className="absolute -left-2 bottom-0 z-[5] pointer-events-none select-none">
              <span
                className="text-[80px] font-extrabold font-display leading-none"
                style={{
                  color: 'transparent',
                  WebkitTextStroke: '2px rgba(255,255,255,0.7)',
                  textShadow: '0 0 20px rgba(0,0,0,0.8)',
                }}
              >
                {rank}
              </span>
            </div>
          )}
        </div>
      </button>
    </div>
  )
}

/**
 * MediaCardSkeleton - Loading state with shimmer effect
 */
export function MediaCardSkeleton() {
  return (
    <div className="relative w-full">
      <div className="aspect-[2/3] rounded-[var(--radius-md)] bg-[var(--color-card)] overflow-hidden">
        <div className="w-full h-full shimmer-bg" />
        {/* Title skeleton in overlay position */}
        <div className="absolute bottom-0 left-0 right-0 p-3 pt-10 bg-gradient-to-t from-[rgba(20,20,20,0.98)] to-transparent">
          <div className="h-3.5 bg-[var(--color-surface)] rounded w-3/4 mb-2" />
          <div className="h-3 bg-[var(--color-surface)] rounded w-1/3" />
        </div>
      </div>
    </div>
  )
}
