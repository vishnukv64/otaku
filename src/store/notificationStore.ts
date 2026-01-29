/**
 * Notification Store - In-app notification management
 *
 * Handles:
 * - Notification state (read, unread, dismissed)
 * - Loading/syncing with backend
 * - Real-time updates via Tauri events
 *
 * Notifications are persisted to SQLite via backend
 */

import { create } from 'zustand'
import {
  listNotifications as fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification as dismissNotificationBackend,
  clearAllNotifications,
} from '@/utils/tauri-commands'

export type NotificationType = 'success' | 'error' | 'warning' | 'info'

export interface NotificationAction {
  label: string
  route?: string
  callback?: string
}

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  timestamp: number
  read: boolean
  dismissed: boolean
  source?: string
  action?: NotificationAction
  metadata?: Record<string, unknown>
}

interface NotificationState {
  // State
  notifications: Notification[]
  isLoading: boolean
  isInitialized: boolean

  // Actions
  loadNotifications: () => Promise<void>
  setNotifications: (notifications: Notification[]) => void
  addNotification: (notification: Notification) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  dismissNotification: (id: string) => void
  clearAll: () => void
  setLoading: (loading: boolean) => void

  // Computed helpers (not reactive, call these as functions)
  getUnreadCount: () => number
  getUnreadNotifications: () => Notification[]
}

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  // Initial state
  notifications: [],
  isLoading: false,
  isInitialized: false,

  // Load notifications from backend database
  loadNotifications: async () => {
    // Skip if already initialized or currently loading
    if (get().isInitialized || get().isLoading) return

    set({ isLoading: true })
    try {
      const backendNotifications = await fetchNotifications(100, false)
      // Map backend response to store format (they should match)
      set({
        notifications: backendNotifications,
        isLoading: false,
        isInitialized: true,
      })
    } catch (err) {
      console.error('Failed to load notifications from database:', err)
      set({ isLoading: false, isInitialized: true })
    }
  },

  // Set all notifications (used when loading from backend)
  setNotifications: (notifications) => {
    set({ notifications, isLoading: false })
  },

  // Add a new notification (from real-time event)
  addNotification: (notification) => {
    set((state) => {
      // Prevent duplicates
      const exists = state.notifications.some((n) => n.id === notification.id)
      if (exists) return state

      // Add to front of list (newest first)
      return {
        notifications: [notification, ...state.notifications],
      }
    })
  },

  // Mark a single notification as read (updates UI immediately, syncs to backend)
  markAsRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    }))
    // Sync to backend (fire-and-forget)
    markNotificationRead(id).catch((err) => {
      console.error('Failed to mark notification as read in database:', err)
    })
  },

  // Mark all notifications as read (updates UI immediately, syncs to backend)
  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    }))
    // Sync to backend (fire-and-forget)
    markAllNotificationsRead().catch((err) => {
      console.error('Failed to mark all notifications as read in database:', err)
    })
  },

  // Dismiss a notification (updates UI immediately, syncs to backend)
  dismissNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }))
    // Sync to backend (fire-and-forget)
    dismissNotificationBackend(id).catch((err) => {
      console.error('Failed to dismiss notification in database:', err)
    })
  },

  // Clear all notifications (updates UI immediately, syncs to backend)
  clearAll: () => {
    set({ notifications: [] })
    // Sync to backend (fire-and-forget)
    clearAllNotifications().catch((err) => {
      console.error('Failed to clear all notifications in database:', err)
    })
  },

  // Set loading state
  setLoading: (loading) => {
    set({ isLoading: loading })
  },

  // Get count of unread notifications
  getUnreadCount: () => {
    return get().notifications.filter((n) => !n.read && !n.dismissed).length
  },

  // Get only unread notifications
  getUnreadNotifications: () => {
    return get().notifications.filter((n) => !n.read && !n.dismissed)
  },
}))
