import { useState, useRef, useEffect, useCallback } from 'react'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useNotificationStore, type Notification } from '@/store/notificationStore'
import {
  markNotificationRead as markReadBackend,
  markAllNotificationsRead as markAllReadBackend,
  dismissNotification as dismissBackend,
  clearAllNotifications as clearAllBackend,
} from '@/utils/tauri-commands'
import { NotificationItem } from './NotificationItem'

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()

  const store = useNotificationStore()
  const { notifications } = store

  // Action handlers that update both store and backend
  // These don't set up event listeners, unlike useNotificationEvents
  const markAsRead = useCallback(
    async (id: string) => {
      store.markAsRead(id)
      try {
        await markReadBackend(id)
      } catch (error) {
        console.error('Failed to mark notification as read:', error)
      }
    },
    [store]
  )

  const markAllAsRead = useCallback(async () => {
    store.markAllAsRead()
    try {
      await markAllReadBackend()
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error)
    }
  }, [store])

  const dismiss = useCallback(
    async (id: string) => {
      store.dismissNotification(id)
      try {
        await dismissBackend(id)
      } catch (error) {
        console.error('Failed to dismiss notification:', error)
      }
    },
    [store]
  )

  const clearAll = useCallback(async () => {
    store.clearAll()
    try {
      await clearAllBackend()
    } catch (error) {
      console.error('Failed to clear all notifications:', error)
    }
  }, [store])

  const handleAction = useCallback(
    (notification: Notification) => {
      if (notification.action?.route) {
        navigate({ to: notification.action.route })
      }
      markAsRead(notification.id)
    },
    [navigate, markAsRead]
  )

  // Calculate unread count
  const unreadCount = notifications.filter((n) => !n.read && !n.dismissed).length

  // Close panel when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        panelRef.current &&
        buttonRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close panel on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const handleNotificationAction = (notification: Parameters<typeof handleAction>[0]) => {
    handleAction(notification)
    setIsOpen(false)
  }

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 bg-[var(--color-accent-primary)] text-white text-xs font-bold rounded-full flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] bg-[var(--color-bg-primary)] border border-[var(--color-bg-hover)] rounded-lg shadow-2xl overflow-hidden z-50"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-bg-hover)]">
            <h3 className="font-semibold text-[var(--color-text-primary)]">
              Notifications
            </h3>
            <div className="flex items-center gap-1">
              {notifications.length > 0 && (
                <>
                  <button
                    onClick={markAllAsRead}
                    className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                    title="Mark all as read"
                  >
                    <CheckCheck size={16} />
                  </button>
                  <button
                    onClick={clearAll}
                    className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                    title="Clear all"
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Notification List */}
          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <Bell
                  size={32}
                  className="mx-auto mb-3 text-[var(--color-text-muted)]"
                />
                <p className="text-[var(--color-text-secondary)]">
                  No notifications yet
                </p>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">
                  You'll see download updates and more here
                </p>
              </div>
            ) : (
              notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onDismiss={dismiss}
                  onAction={handleNotificationAction}
                  onMarkRead={markAsRead}
                />
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-[var(--color-bg-hover)] text-center">
              <span className="text-xs text-[var(--color-text-muted)]">
                {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
                {unreadCount > 0 && ` (${unreadCount} unread)`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
