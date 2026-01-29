/**
 * Notification Utility
 *
 * Provides a unified API for showing notifications throughout the app.
 * - Full notifications: toast + NotificationCenter + database persistence
 * - Toast-only: ephemeral toast that disappears after a few seconds
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
  /** Only show a toast - don't add to NotificationCenter or database */
  toastOnly?: boolean
  /** Toast duration in ms (default: 4000) */
  duration?: number
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
 *
 * Use toastOnly: true for ephemeral messages like "Resuming playback"
 */
export function notify(options: NotifyOptions): string {
  const id = `notify-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const type = options.type || 'info'
  const timestamp = Date.now()

  // If toastOnly, just show the toast and return
  if (options.toastOnly) {
    showToast(id, type, options.title, options.message, options.duration)
    return id
  }

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
    showToast(id, type, options.title, options.message, options.duration)
  }

  return id
}

/** Show a toast popup */
function showToast(
  id: string,
  type: NotificationType,
  title: string,
  message: string,
  duration: number = 4000
) {
  const toastOptions = {
    id,
    duration,
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
    createElement('div', { className: 'font-medium' }, title),
    createElement(
      'div',
      { className: 'text-sm text-[var(--color-text-secondary)]' },
      message
    )
  )

  toast(toastContent, toastOptions)
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

/**
 * Show a toast-only message (ephemeral, not persisted)
 * Use for transient info like "Resuming playback from 3:45"
 */
export function toastInfo(title: string, message: string, duration?: number): void {
  notify({ title, message, type: 'info', toastOnly: true, duration })
}

export function toastSuccess(title: string, message: string, duration?: number): void {
  notify({ title, message, type: 'success', toastOnly: true, duration })
}

export function toastError(title: string, message: string, duration?: number): void {
  notify({ title, message, type: 'error', toastOnly: true, duration })
}

export function toastWarning(title: string, message: string, duration?: number): void {
  notify({ title, message, type: 'warning', toastOnly: true, duration })
}

// Convenience aliases matching common toast patterns
export const notification = {
  success: notifySuccess,
  error: notifyError,
  info: notifyInfo,
  warning: notifyWarning,
}

// Ephemeral toast helpers
export const ephemeralToast = {
  success: toastSuccess,
  error: toastError,
  info: toastInfo,
  warning: toastWarning,
}
