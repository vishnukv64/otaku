import { useMemo, useState } from 'react'
import { BellRing, ChevronDown, ChevronUp, CheckCheck, X } from 'lucide-react'
import type { Notification } from '@/store/notificationStore'
import { useProxiedImage } from '@/hooks/useProxiedImage'

export interface ReleaseGroup {
  mediaId: string | null
  mediaType: 'anime' | 'manga' | null
  mediaTitle: string
  notifications: Notification[]
  thumbnail?: string
  unreadCount: number
  totalNewReleases: number
  latestNumber: number | null
  latestTimestamp: number
  actionLabel: string
  actionRoute?: string
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'Just now'
}

function getReleaseLabel(group: ReleaseGroup): string {
  if (group.mediaType === 'manga') {
    return group.totalNewReleases === 1 ? 'New Chapter' : `${group.totalNewReleases} New Chapters`
  }

  return group.totalNewReleases === 1 ? 'New Episode' : `${group.totalNewReleases} New Episodes`
}

function getSummary(group: ReleaseGroup): string {
  const noun = group.mediaType === 'manga' ? 'chapter' : 'episode'
  const latest = group.latestNumber != null ? ` · latest ${noun} ${group.latestNumber}` : ''
  return `${group.totalNewReleases} ${noun}${group.totalNewReleases === 1 ? '' : 's'} waiting${latest}`
}

export function groupReleaseNotifications(
  notifications: Notification[],
  coverUrls: Record<string, string> = {},
): ReleaseGroup[] {
  const groups = new Map<string, ReleaseGroup>()

  for (const notification of notifications) {
    const mediaId = (notification.metadata?.media_id as string | undefined) ?? null
    const mediaTitle =
      (notification.metadata?.media_title as string | undefined) ??
      notification.title.replace(/^New\s+(Episode|Chapter)\s+Available:?\s*/i, '')
    const mediaType = ((notification.metadata?.media_type as 'anime' | 'manga' | undefined) ??
      (notification.message.toLowerCase().includes('chapter') ? 'manga' : 'anime')) as
      | 'anime'
      | 'manga'
    const key = mediaId ?? `${mediaType}:${mediaTitle}`
    const thumbnail =
      (notification.metadata?.thumbnail as string | undefined) ??
      (mediaId ? coverUrls[mediaId] : undefined)
    const latestNumber =
      typeof notification.metadata?.current_number === 'number'
        ? notification.metadata.current_number
        : null
    const newReleases =
      typeof notification.metadata?.new_releases === 'number' ? notification.metadata.new_releases : 1

    const existing = groups.get(key)
    if (existing) {
      existing.notifications.push(notification)
      existing.unreadCount += notification.read ? 0 : 1
      existing.totalNewReleases += newReleases
      existing.latestTimestamp = Math.max(existing.latestTimestamp, notification.timestamp)
      existing.latestNumber =
        existing.latestNumber == null
          ? latestNumber
          : latestNumber == null
            ? existing.latestNumber
            : Math.max(existing.latestNumber, latestNumber)
      existing.thumbnail ||= thumbnail
      if (!existing.actionRoute && notification.action?.route) {
        existing.actionRoute = notification.action.route
      }
    } else {
      groups.set(key, {
        mediaId,
        mediaType,
        mediaTitle,
        notifications: [notification],
        thumbnail,
        unreadCount: notification.read ? 0 : 1,
        totalNewReleases: newReleases,
        latestNumber,
        latestTimestamp: notification.timestamp,
        actionLabel: mediaType === 'manga' ? 'Read Now' : 'Watch Now',
        actionRoute: notification.action?.route,
      })
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.latestTimestamp - a.latestTimestamp)
}

interface ReleaseRadarGroupCardProps {
  group: ReleaseGroup
  onDismiss: (group: ReleaseGroup) => void
  onAction: (group: ReleaseGroup) => void
  onAcknowledge: (group: ReleaseGroup) => void
}

export function ReleaseRadarGroupCard({
  group,
  onDismiss,
  onAction,
  onAcknowledge,
}: ReleaseRadarGroupCardProps) {
  const [expanded, setExpanded] = useState(false)
  const { src: thumbnailSrc } = useProxiedImage(group.thumbnail || '')
  const summary = useMemo(() => getSummary(group), [group])
  const badgeLabel = useMemo(() => getReleaseLabel(group), [group])

  return (
    <div
      className={`group relative mb-2 rounded-[var(--radius-md)] border bg-white/[0.02] p-3 transition-all ${
        group.unreadCount > 0
          ? 'border-[rgba(229,9,20,0.35)] shadow-[0_0_0_1px_rgba(229,9,20,0.12)]'
          : 'border-white/8'
      }`}
    >
      <div className="flex items-start gap-3">
        {thumbnailSrc ? (
          <img
            src={thumbnailSrc}
            alt=""
            className="h-[52px] w-[38px] rounded-[var(--radius-sm)] bg-white/5 object-cover flex-shrink-0"
          />
        ) : (
          <div className="flex h-[52px] w-[38px] flex-shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-white/10 bg-white/5">
            <BellRing size={18} className="text-[var(--color-text-muted)]" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="mb-1 inline-flex items-center gap-[3px] rounded-full border border-[rgba(229,9,20,0.2)] bg-[rgba(229,9,20,0.15)] px-[7px] py-[1px] text-[0.6rem] font-bold uppercase tracking-wider text-[var(--color-accent-light)]">
                {badgeLabel}
              </span>
              <div className="truncate text-[0.875rem] font-semibold text-[var(--color-text-primary)]">
                {group.mediaTitle}
              </div>
              <p className="mt-0.5 text-[0.75rem] leading-[1.35] text-[var(--color-text-secondary)]">
                {summary}
              </p>
            </div>

            <div className="flex flex-col items-end gap-1">
              {group.unreadCount > 0 && (
                <span className="rounded-full bg-[var(--color-accent-primary)] px-2 py-0.5 text-[0.65rem] font-bold text-white">
                  {group.unreadCount} new
                </span>
              )}
              <span className="text-[0.6875rem] text-[var(--color-text-muted)]">
                {formatRelativeTime(group.latestTimestamp)}
              </span>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {group.actionRoute && (
              <button
                onClick={() => onAction(group)}
                className="rounded bg-[var(--color-accent-primary)] px-2.5 py-1 text-[0.72rem] font-medium text-white transition-colors hover:bg-[var(--color-accent-primary)]/80"
              >
                {group.actionLabel}
              </button>
            )}
            {group.mediaId && (
              <button
                onClick={() => onAcknowledge(group)}
                className="inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1 text-[0.72rem] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-white/20 hover:text-[var(--color-text-primary)]"
              >
                <CheckCheck size={12} />
                Mark seen
              </button>
            )}
            {group.notifications.length > 1 && (
              <button
                onClick={() => setExpanded((value) => !value)}
                className="inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1 text-[0.72rem] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-white/20 hover:text-[var(--color-text-primary)]"
              >
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {expanded ? 'Hide details' : `${group.notifications.length} alerts`}
              </button>
            )}
          </div>

          {expanded && (
            <div className="mt-3 space-y-2 border-t border-white/8 pt-3">
              {group.notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="rounded bg-white/[0.03] px-3 py-2 text-[0.74rem] text-[var(--color-text-secondary)]"
                >
                  <div className="font-medium text-[var(--color-text-primary)]">{notification.title}</div>
                  {notification.message && <div className="mt-0.5">{notification.message}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={() => onDismiss(group)}
        className="absolute right-2 top-2 rounded-full p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:bg-white/10 hover:text-[var(--color-text-primary)] group-hover:opacity-100"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}
