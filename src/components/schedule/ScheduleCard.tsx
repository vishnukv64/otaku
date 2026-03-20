import { Star, Tv, Play } from 'lucide-react'
import type { SearchResult } from '@/types/extension'
import { useProxiedImage } from '@/hooks/useProxiedImage'

/** Convert Jikan broadcast day+time (JST) to a local Date for the upcoming occurrence */
export function getNextBroadcastDate(broadcastDay?: string, broadcastTime?: string): Date | null {
  if (!broadcastDay || !broadcastTime) return null

  const dayMap: Record<string, number> = {
    Sundays: 0, Mondays: 1, Tuesdays: 2, Wednesdays: 3,
    Thursdays: 4, Fridays: 5, Saturdays: 6,
  }
  const targetDayUTC = dayMap[broadcastDay]
  if (targetDayUTC === undefined) return null

  // Parse time (e.g., "01:30")
  const [hours, minutes] = broadcastTime.split(':').map(Number)
  if (isNaN(hours) || isNaN(minutes)) return null

  // Build a Date in JST (UTC+9), then find the next occurrence
  const now = new Date()
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const jstTarget = new Date(jstNow)
  jstTarget.setHours(hours, minutes, 0, 0)

  // Set to the correct day of the week
  const currentDay = jstNow.getDay()
  let daysUntil = targetDayUTC - currentDay
  if (daysUntil < 0) daysUntil += 7
  if (daysUntil === 0 && jstTarget <= jstNow) daysUntil = 7
  jstTarget.setDate(jstTarget.getDate() + daysUntil)

  // Convert JST target back to local time
  return new Date(now.getTime() + (jstTarget.getTime() - jstNow.getTime()))
}

/** Format countdown for display */
export function formatCountdown(targetDate: Date | null): { text: string; isPast: boolean; isAiring: boolean } {
  if (!targetDate) return { text: '', isPast: false, isAiring: false }

  const now = Date.now()
  const diff = targetDate.getTime() - now

  // "Airing now" window: 0 to -30 minutes
  if (diff <= 0 && diff > -30 * 60 * 1000) {
    return { text: 'Airing now', isPast: false, isAiring: true }
  }

  if (diff <= 0) {
    const absDiff = Math.abs(diff)
    const hours = Math.floor(absDiff / (1000 * 60 * 60))
    const minutes = Math.floor((absDiff / (1000 * 60)) % 60)
    if (hours > 0) return { text: `Aired ${hours}h ago`, isPast: true, isAiring: false }
    return { text: `Aired ${minutes}m ago`, isPast: true, isAiring: false }
  }

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff / (1000 * 60)) % 60)

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return { text: `Airs in ${days}d ${hours % 24}h`, isPast: false, isAiring: false }
  }
  if (hours > 0) return { text: `Airs in ${hours}h ${minutes}m`, isPast: false, isAiring: false }
  return { text: `Airs in ${minutes}m`, isPast: false, isAiring: false }
}

interface ScheduleCardProps {
  anime: SearchResult
  libraryStatus?: string | null
  onClick: () => void
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  watching: { label: 'Watching', color: 'bg-green-600' },
  plan_to_watch: { label: 'Plan to Watch', color: 'bg-blue-600' },
  completed: { label: 'Completed', color: 'bg-purple-600' },
  on_hold: { label: 'On Hold', color: 'bg-yellow-600' },
  dropped: { label: 'Dropped', color: 'bg-red-800' },
}

export function ScheduleCard({ anime, libraryStatus, onClick }: ScheduleCardProps): JSX.Element {
  const { src: coverSrc } = useProxiedImage(anime.cover_url || '')
  const nextBroadcast = getNextBroadcastDate(anime.broadcast_day, anime.broadcast_time)
  const countdown = formatCountdown(nextBroadcast)
  const libBadge = libraryStatus ? STATUS_LABELS[libraryStatus] : null

  return (
    <button
      onClick={onClick}
      className="group relative bg-[rgba(255,255,255,0.04)] rounded-xl overflow-hidden border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.15)] transition-all text-left w-full"
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] overflow-hidden">
        {coverSrc && (
          <img
            src={coverSrc}
            alt={anime.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        )}
        {/* Library status badge */}
        {libBadge && (
          <div className={`absolute top-2 left-2 ${libBadge.color} px-2 py-0.5 rounded text-[10px] font-semibold text-white`}>
            {libBadge.label}
          </div>
        )}
        {/* Type badge */}
        {anime.media_type && (
          <div className="absolute top-2 right-2 bg-black/70 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/80 flex items-center gap-1">
            <Tv className="w-2.5 h-2.5" />
            {anime.media_type}
          </div>
        )}
        {/* Countdown overlay at bottom of poster */}
        {countdown.text && (
          <CountdownOverlay countdown={countdown} />
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 space-y-1">
        <h3 className="text-sm font-medium text-white line-clamp-2 leading-tight">{anime.title}</h3>
        <div className="flex items-center gap-2 text-xs text-[rgba(255,255,255,0.5)]">
          {anime.available_episodes && (
            <span>{anime.available_episodes} EP</span>
          )}
          {anime.rating && (
            <span className="flex items-center gap-0.5 text-amber-400">
              <Star className="w-3 h-3 fill-current" />
              {anime.rating.toFixed(2)}
            </span>
          )}
        </div>
        {anime.studios && anime.studios.length > 0 && (
          <p className="text-[11px] text-[rgba(255,255,255,0.35)] truncate">{anime.studios[0]}</p>
        )}
      </div>
    </button>
  )
}

/** Countdown overlay rendered at the bottom of the poster image */
function CountdownOverlay({ countdown }: { countdown: { text: string; isPast: boolean; isAiring: boolean } }): JSX.Element {
  let className = 'absolute bottom-0 left-0 right-0 px-2 py-1.5 text-xs font-medium '

  if (countdown.isAiring) {
    className += 'bg-[#e50914]/90 text-white animate-pulse'
  } else if (countdown.isPast) {
    className += 'bg-black/70 text-white/50'
  } else {
    className += 'bg-black/70 text-green-400'
  }

  return (
    <div className={className}>
      {countdown.isAiring && <Play className="w-3 h-3 inline mr-1 fill-current" />}
      {countdown.text}
    </div>
  )
}
