/**
 * NextEpisodeCountdown Component
 *
 * Displays a countdown timer showing when the next episode will be released
 * for currently airing anime.
 */

import { useState, useEffect } from 'react'
import { Clock, Calendar } from 'lucide-react'

interface NextEpisodeCountdownProps {
  lastUpdateEnd?: string // ISO 8601 timestamp (fallback)
  latestEpisodeDate?: { year: number; month: number; date: number } // Preferred source
  broadcastInterval: number // milliseconds
  status?: string
}

interface TimeRemaining {
  days: number
  hours: number
  minutes: number
  seconds: number
  isOverdue: boolean
}

function calculateTimeRemaining(nextReleaseTime: number): TimeRemaining {
  const now = Date.now()
  const diff = nextReleaseTime - now

  if (diff <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isOverdue: true,
    }
  }

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  return {
    days,
    hours: hours % 24,
    minutes: minutes % 60,
    seconds: seconds % 60,
    isOverdue: false,
  }
}

function formatNextReleaseDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()

  // Check if it's today
  if (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  ) {
    return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
  }

  // Check if it's tomorrow
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (
    date.getDate() === tomorrow.getDate() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getFullYear() === tomorrow.getFullYear()
  ) {
    return `Tomorrow at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
  }

  // Otherwise show full date
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function NextEpisodeCountdown({
  lastUpdateEnd,
  latestEpisodeDate,
  broadcastInterval,
  status,
}: NextEpisodeCountdownProps) {
  // Only show for releasing/airing anime
  const isAiring = status && ['releasing', 'ongoing', 'airing', 'currently airing'].includes(status.toLowerCase())

  // Calculate last episode air time - prioritize latestEpisodeDate
  // Note: We compute this before hooks to keep hook order consistent
  let lastUpdate: number | null = null
  if (latestEpisodeDate) {
    // Convert latestEpisodeDate to timestamp (using noon as default time)
    lastUpdate = new Date(
      latestEpisodeDate.year,
      latestEpisodeDate.month,
      latestEpisodeDate.date,
      12, // noon
      0,
      0
    ).getTime()
  } else if (lastUpdateEnd) {
    // Fallback to ISO timestamp
    lastUpdate = new Date(lastUpdateEnd).getTime()
  }

  const nextReleaseTime = lastUpdate !== null ? lastUpdate + broadcastInterval : 0

  const [timeRemaining, setTimeRemaining] = useState<TimeRemaining>(
    calculateTimeRemaining(nextReleaseTime)
  )

  useEffect(() => {
    // Don't run interval if no valid release time
    if (lastUpdate === null) return

    // Update every second
    const interval = setInterval(() => {
      setTimeRemaining(calculateTimeRemaining(nextReleaseTime))
    }, 1000)

    return () => clearInterval(interval)
  }, [nextReleaseTime, lastUpdate])

  // Early returns after hooks to comply with Rules of Hooks
  if (lastUpdate === null) {
    return null
  }

  if (!isAiring) {
    return null
  }

  // If overdue, show a "Check for updates" message
  if (timeRemaining.isOverdue) {
    return (
      <div>
        <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] text-xs mb-2">
          <Clock className="w-3 h-3" />
          <span>Next Episode</span>
        </div>
        <div className="flex items-center gap-2 text-emerald-400">
          <Calendar className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">
            New episode available!
          </span>
        </div>
      </div>
    )
  }

  // Format countdown display
  const parts: string[] = []
  if (timeRemaining.days > 0) parts.push(`${timeRemaining.days}d`)
  if (timeRemaining.hours > 0 || timeRemaining.days > 0) parts.push(`${timeRemaining.hours}h`)
  if (timeRemaining.minutes > 0 || timeRemaining.hours > 0 || timeRemaining.days > 0) {
    parts.push(`${timeRemaining.minutes}m`)
  }
  parts.push(`${timeRemaining.seconds}s`)

  const countdownText = parts.join(' ')
  const releaseDate = formatNextReleaseDate(nextReleaseTime)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] text-xs mb-2">
        <Clock className="w-3 h-3" />
        <span>Next Episode</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-[var(--color-text-secondary)]">
          {releaseDate}
        </span>
        <span className="font-mono text-xl font-bold text-blue-400 tracking-wide whitespace-nowrap">
          {countdownText}
        </span>
      </div>
    </div>
  )
}
