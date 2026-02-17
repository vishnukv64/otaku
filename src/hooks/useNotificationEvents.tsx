/**
 * Notification Events Hook
 *
 * Listens to Tauri events for real-time notification updates.
 * Loads initial notifications from database and shows toast for new ones.
 *
 * The store handles all backend sync operations - this hook just wires up
 * the event listener and provides convenience methods.
 */

import { useEffect, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useNavigate } from '@tanstack/react-router'
import toast from 'react-hot-toast'
import {
  useNotificationStore,
  type Notification,
  type NotificationType,
} from '@/store/notificationStore'
import { isMobile } from '@/utils/platform'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as sendSystemNotification,
} from '@tauri-apps/plugin-notification'

const NOTIFICATION_EVENT = 'notification'

// Module-level Set to track shown toast IDs (persists across StrictMode remounts)
const shownToastIds = new Set<string>()

// Module-level flag to prevent multiple listeners
let listenerSetUp = false
let globalUnlisten: (() => void) | null = null

/** Notification payload from backend (slightly different structure) */
interface NotificationPayload {
  id: string
  type: NotificationType
  title: string
  message: string
  source?: string
  action?: {
    label: string
    route?: string
    callback?: string
  }
  metadata?: Record<string, unknown>
  read: boolean
  dismissed: boolean
  timestamp: number
}

/** Convert backend payload to frontend Notification */
function payloadToNotification(payload: NotificationPayload): Notification {
  return {
    id: payload.id,
    type: payload.type,
    title: payload.title,
    message: payload.message,
    timestamp: payload.timestamp,
    read: payload.read,
    dismissed: payload.dismissed,
    source: payload.source,
    action: payload.action,
    metadata: payload.metadata,
  }
}

/** Get toast icon based on notification type */
function getToastIcon(type: NotificationType): string {
  switch (type) {
    case 'success':
      return '✓'
    case 'error':
      return '✕'
    case 'warning':
      return '⚠'
    case 'info':
    default:
      return 'ℹ'
  }
}

interface UseNotificationEventsReturn {
  /** Load notifications from backend */
  loadNotifications: () => Promise<void>
  /** Mark a notification as read */
  markAsRead: (id: string) => Promise<void>
  /** Mark all notifications as read */
  markAllAsRead: () => Promise<void>
  /** Dismiss a notification */
  dismiss: (id: string) => Promise<void>
  /** Clear all notifications */
  clearAll: () => Promise<void>
  /** Handle notification action (navigate or callback) */
  handleAction: (notification: Notification) => void
}

export function useNotificationEvents(): UseNotificationEventsReturn {
  const navigate = useNavigate()
  const store = useNotificationStore()

  // Load notifications from backend (delegates to store)
  const loadNotifications = useCallback(async () => {
    await store.loadNotifications()
  }, [store])

  // Mark notification as read (store handles backend sync)
  const markAsRead = useCallback(
    async (id: string) => {
      store.markAsRead(id)
    },
    [store]
  )

  // Mark all as read (store handles backend sync)
  const markAllAsRead = useCallback(async () => {
    store.markAllAsRead()
  }, [store])

  // Dismiss notification (store handles backend sync)
  const dismiss = useCallback(
    async (id: string) => {
      store.dismissNotification(id)
    },
    [store]
  )

  // Clear all notifications (store handles backend sync)
  const clearAll = useCallback(async () => {
    store.clearAll()
  }, [store])

  // Handle notification action
  const handleAction = useCallback(
    (notification: Notification) => {
      if (notification.action?.route) {
        navigate({ to: notification.action.route })
      }
      // Mark as read when action is clicked
      store.markAsRead(notification.id)
    },
    [navigate, store]
  )

  // Setup event listener and load initial data (only once globally)
  useEffect(() => {
    // Prevent multiple listeners (handles StrictMode and multiple hook calls)
    if (listenerSetUp) {
      return
    }
    listenerSetUp = true

    const setup = async () => {
      // Load initial notifications from database via store
      await store.loadNotifications()

      // Listen for new notifications (only if not already listening)
      if (globalUnlisten) {
        return
      }

      globalUnlisten = await listen<NotificationPayload>(NOTIFICATION_EVENT, (event) => {
        const payload = event.payload
        const notification = payloadToNotification(payload)

        // Check if we've already shown a toast for this notification
        if (shownToastIds.has(notification.id)) {
          return
        }

        // Mark this notification as shown
        shownToastIds.add(notification.id)

        // Add to store (uses the current store state)
        useNotificationStore.getState().addNotification(notification)

        // On mobile, send a system notification instead of in-app toast
        if (isMobile()) {
          sendMobileSystemNotification(notification.title, notification.message)
          return
        }

        // Desktop: show in-app toast notification
        const toastOptions = {
          id: notification.id, // Use notification ID as toast ID to prevent duplicates
          duration: 4000,
          icon: getToastIcon(notification.type),
          style: {
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-primary)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          },
        }

        // Show toast with action if available
        if (notification.action) {
          toast(
            (t) => (
              <div className="flex flex-col gap-1">
                <div className="font-medium">{notification.title}</div>
                <div className="text-sm text-[var(--color-text-secondary)]">
                  {notification.message}
                </div>
                {notification.action?.route && (
                  <a
                    href={notification.action.route}
                    onClick={(e) => {
                      e.preventDefault()
                      // Mark as read and dismiss toast (store handles backend sync)
                      useNotificationStore.getState().markAsRead(notification.id)
                      toast.dismiss(t.id)
                      // Navigate using window.location for simplicity
                      window.location.href = notification.action!.route!
                    }}
                    className="mt-1 text-sm text-[var(--color-accent-primary)] hover:underline text-left"
                  >
                    {notification.action?.label}
                  </a>
                )}
              </div>
            ),
            toastOptions
          )
        } else {
          toast(
            <div className="flex flex-col gap-0.5">
              <div className="font-medium">{notification.title}</div>
              <div className="text-sm text-[var(--color-text-secondary)]">
                {notification.message}
              </div>
            </div>,
            toastOptions
          )
        }
      })
    }

    setup()

    // Don't clean up the listener - it's global and should persist
    return () => {
      listenerSetUp = false
    }
  }, [store])

  return {
    loadNotifications,
    markAsRead,
    markAllAsRead,
    dismiss,
    clearAll,
    handleAction,
  }
}

/** Send a native system notification on Android */
async function sendMobileSystemNotification(title: string, body: string) {
  try {
    let granted = await isPermissionGranted()
    if (!granted) {
      const permission = await requestPermission()
      granted = permission === 'granted'
    }
    if (granted) {
      sendSystemNotification({ title, body })
    }
  } catch (err) {
    console.error('Failed to send system notification:', err)
  }
}
