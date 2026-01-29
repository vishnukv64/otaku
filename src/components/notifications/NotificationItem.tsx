import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import type { Notification } from '@/store/notificationStore'

interface NotificationItemProps {
  notification: Notification
  onDismiss: (id: string) => void
  onAction: (notification: Notification) => void
  onMarkRead: (id: string) => void
}

/** Get icon component based on notification type */
function getTypeIcon(type: Notification['type']) {
  const iconProps = { size: 18, className: 'flex-shrink-0' }

  switch (type) {
    case 'success':
      return <CheckCircle {...iconProps} className={`${iconProps.className} text-green-500`} />
    case 'error':
      return <XCircle {...iconProps} className={`${iconProps.className} text-red-500`} />
    case 'warning':
      return <AlertTriangle {...iconProps} className={`${iconProps.className} text-yellow-500`} />
    case 'info':
    default:
      return <Info {...iconProps} className={`${iconProps.className} text-blue-500`} />
  }
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

export function NotificationItem({
  notification,
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

  return (
    <div
      className={`
        relative group px-4 py-3 border-b border-[var(--color-bg-hover)] last:border-b-0
        transition-colors cursor-pointer
        ${notification.read ? 'bg-transparent' : 'bg-[var(--color-bg-hover)]/30'}
        hover:bg-[var(--color-bg-hover)]
      `}
      onClick={handleClick}
    >
      {/* Unread indicator */}
      {!notification.read && (
        <div className="absolute left-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--color-accent-primary)]" />
      )}

      <div className="flex items-start gap-3 pr-6">
        {/* Type icon */}
        <div className="mt-0.5">{getTypeIcon(notification.type)}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-[var(--color-text-primary)] truncate">
              {notification.title}
            </span>
            <span className="text-xs text-[var(--color-text-muted)] flex-shrink-0">
              {formatRelativeTime(notification.timestamp)}
            </span>
          </div>

          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5 line-clamp-2">
            {notification.message}
          </p>

          {/* Action button */}
          {notification.action && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAction(notification)
              }}
              className="mt-2 text-sm text-[var(--color-accent-primary)] hover:underline"
            >
              {notification.action.label}
            </button>
          )}
        </div>
      </div>

      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDismiss(notification.id)
        }}
        className="absolute top-2 right-2 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}
