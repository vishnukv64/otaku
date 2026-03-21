import { useState } from 'react'
import { X, Info } from 'lucide-react'
import type { Notification } from '@/store/notificationStore'
import { getNotifCategory } from './NotificationCenter'

interface NotificationItemProps {
  notification: Notification
  coverUrl?: string
  onDismiss: (id: string) => void
  onAction: (notification: Notification) => void
  onMarkRead: (id: string) => void
}

/** Format relative time (e.g., "2m ago", "1h ago") */
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

/** Get badge style + label based on notification category */
function getBadgeConfig(category: ReturnType<typeof getNotifCategory>) {
  switch (category) {
    case 'episode':
      return { label: 'New Episode', className: 'bg-[rgba(229,9,20,0.15)] text-[var(--color-accent-light)] border-[rgba(229,9,20,0.2)]' }
    case 'chapter':
      return { label: 'New Chapter', className: 'bg-[rgba(229,9,20,0.15)] text-[var(--color-accent-light)] border-[rgba(229,9,20,0.2)]' }
    case 'download':
      return { label: 'Download', className: 'bg-[rgba(70,211,105,0.12)] text-green-400 border-[rgba(70,211,105,0.2)]' }
    case 'system':
    default:
      return { label: 'System', className: 'bg-[rgba(128,128,128,0.12)] text-[var(--color-text-muted)] border-[rgba(128,128,128,0.2)]' }
  }
}

export function NotificationItem({
  notification,
  coverUrl,
  onDismiss,
  onAction,
  onMarkRead,
}: NotificationItemProps) {
  const handleClick = () => {
    if (!notification.read) {
      onMarkRead(notification.id)
    }
    if (notification.action) {
      onAction(notification)
    }
  }

  const [imgError, setImgError] = useState(false)
  const category = getNotifCategory(notification)
  const badge = getBadgeConfig(category)
  const thumbnail = coverUrl || (notification.metadata?.thumbnail || notification.metadata?.image) as string | undefined
  const isUnread = !notification.read
  const isRead = notification.read

  return (
    <div
      className={`
        group relative flex items-start gap-3 p-3 rounded-[var(--radius-md)]
        cursor-pointer transition-all mb-0.5
        hover:bg-white/[0.03]
        ${isUnread ? 'border-l-[3px] border-l-[var(--color-accent-primary)]' : ''}
        ${isRead ? 'opacity-65' : ''}
      `}
      onClick={handleClick}
    >
      {/* Thumbnail or icon */}
      {thumbnail && !imgError ? (
        <img
          src={thumbnail}
          alt=""
          className="w-[38px] h-[52px] rounded-[var(--radius-sm)] object-cover bg-white/5 flex-shrink-0"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="w-[38px] h-[52px] rounded-[var(--radius-sm)] bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
          <Info size={18} className="text-[var(--color-text-muted)]" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Type badge */}
        <span className={`inline-flex items-center gap-[3px] px-[7px] py-[1px] rounded-full text-[0.6rem] font-bold uppercase tracking-wider mb-[3px] border ${badge.className}`}>
          {badge.label}
        </span>

        <div className="font-semibold text-[0.8125rem] leading-[1.3] mb-0.5 text-[var(--color-text-primary)]">
          {notification.title}
        </div>

        {notification.message && (
          <p className="text-[0.75rem] text-[var(--color-text-secondary)] leading-[1.3] mb-[3px] line-clamp-2">
            {notification.message}
          </p>
        )}

        <div className="text-[0.6875rem] text-[var(--color-text-muted)]">
          {formatRelativeTime(notification.timestamp)}
        </div>
      </div>

      {/* Action button */}
      {notification.action && (
        <div className="flex-shrink-0 self-center">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAction(notification)
            }}
            className="px-2.5 py-1 bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-primary)]/80 text-white rounded text-[0.7rem] font-medium transition-colors"
          >
            {notification.action.label}
          </button>
        </div>
      )}

      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDismiss(notification.id)
        }}
        className="absolute top-2 right-2 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/10"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}
