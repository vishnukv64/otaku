/**
 * Notification Utility
 *
 * Provides a unified API for showing notifications throughout the app.
 * Shows a toast popup AND adds to the NotificationCenter store.
 * Persists notifications to the database via Tauri backend.
 * Uses the same toast style as download notifications for consistency.
 */

import toast from 'react-hot-toast'
import { createElement } from 'react'
import { useNotificationStore, type NotificationType } from '@/store/notificationStore'
import { createNotification } from '@/utils/tauri-commands'

interface NotifyOptions {
  /** Notification title */
  title: string
  /** Notification message */
  message: string
  /** Notification type */
  type?: NotificationType
  /** Source/category of the notification */
  source?: string
  /** Action button configuration */
  action?: {
    label: string
    route?: string
  }
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /** Skip showing a toast (only add to NotificationCenter) */
  silent?: boolean
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

/**
 * Show a notification - displays a toast AND adds to NotificationCenter
 * Also persists to database via Tauri backend (fire-and-forget)
 */
export function notify(options: NotifyOptions): string {
  const id = `notify-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const type = options.type || 'info'
  const timestamp = Date.now()

  // Add to NotificationCenter store (immediate for UI)
  useNotificationStore.getState().addNotification({
    id,
    type,
    title: options.title,
    message: options.message,
    timestamp,
    read: false,
    dismissed: false,
    source: options.source,
    action: options.action,
    metadata: options.metadata,
  })

  // Persist to database (fire-and-forget, don't block UI)
  createNotification(
    type,
    options.title,
    options.message,
    options.source,
    options.action?.label,
    options.action?.route,
    options.metadata
  ).catch((err) => {
    console.error('Failed to persist notification to database:', err)
  })

  // Show toast popup (unless silent) - matches useNotificationEvents style
  if (!options.silent) {
    const toastOptions = {
      id,
      duration: 4000,
      icon: getToastIcon(type),
      style: {
        background: 'var(--color-bg-secondary)',
        color: 'var(--color-text-primary)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      },
    }

    // Create toast content matching the notification events style
    const toastContent = createElement(
      'div',
      { className: 'flex flex-col gap-0.5' },
      createElement('div', { className: 'font-medium' }, options.title),
      createElement(
        'div',
        { className: 'text-sm text-[var(--color-text-secondary)]' },
        options.message
      )
    )

    toast(toastContent, toastOptions)
  }

  return id
}

/**
 * Show a success notification
 */
export function notifySuccess(title: string, message: string, options?: Partial<NotifyOptions>): string {
  return notify({
    title,
    message,
    type: 'success',
    ...options,
  })
}

/**
 * Show an error notification
 */
export function notifyError(title: string, message: string, options?: Partial<NotifyOptions>): string {
  return notify({
    title,
    message,
    type: 'error',
    ...options,
  })
}

/**
 * Show an info notification
 */
export function notifyInfo(title: string, message: string, options?: Partial<NotifyOptions>): string {
  return notify({
    title,
    message,
    type: 'info',
    ...options,
  })
}

/**
 * Show a warning notification
 */
export function notifyWarning(title: string, message: string, options?: Partial<NotifyOptions>): string {
  return notify({
    title,
    message,
    type: 'warning',
    ...options,
  })
}

// Convenience aliases matching common toast patterns
export const notification = {
  success: notifySuccess,
  error: notifyError,
  info: notifyInfo,
  warning: notifyWarning,
}
