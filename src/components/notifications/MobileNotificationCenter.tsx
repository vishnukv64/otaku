/**
 * Mobile Notification Center
 *
 * Exports:
 * - NotificationPageContent: Standalone content (used by /notifications route on mobile)
 * - MobileNotificationCenter: Modal shell wrapping NotificationPageContent (used by TopNav on desktop small screens)
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Bell,
  X,
  CheckCheck,
  Trash2,
  RefreshCw,
  Clock,
  ChevronDown,
} from 'lucide-react'
import {
  useNotificationStore,
  type Notification,
} from '@/store/notificationStore'
import {
  markNotificationRead as markReadBackend,
  markAllNotificationsRead as markAllReadBackend,
  dismissNotification as dismissBackend,
  clearAllNotifications as clearAllBackend,
  getReleaseCheckSettings,
  updateReleaseCheckSettings,
  checkForNewReleases,
  getReleaseCheckStatus,
  type ReleaseCheckSettings,
  type ReleaseCheckStatus,
} from '@/utils/tauri-commands'
import { NotificationItem } from './NotificationItem'

/** Interval options for release checking */
const INTERVAL_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 360, label: '6 hours' },
]

/** Format relative time for last check */
function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return 'Never'

  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

interface MobileNotificationCenterProps {
  isOpen: boolean
  onClose: () => void
}

interface NotificationPageContentProps {
  onNavigateAway?: () => void
}

type TabType = 'all' | 'releases'

/**
 * Standalone notification content — no modal wrapper, no backdrop, no fixed positioning.
 * Used directly by the /notifications route and mounted inside MobileNotificationCenter's modal shell.
 */
export function NotificationPageContent({
  onNavigateAway,
}: NotificationPageContentProps) {
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [isChecking, setIsChecking] = useState(false)
  const [releaseSettings, setReleaseSettings] =
    useState<ReleaseCheckSettings | null>(null)
  const [releaseStatus, setReleaseStatus] =
    useState<ReleaseCheckStatus | null>(null)
  const [showIntervalPicker, setShowIntervalPicker] = useState(false)
  const navigate = useNavigate()

  const store = useNotificationStore()
  const { notifications } = store

  // Filter notifications by tab
  const filteredNotifications = useMemo(() => {
    if (activeTab === 'releases') {
      return notifications.filter((n) => n.source === 'release')
    }
    return notifications
  }, [notifications, activeTab])

  // Count release notifications for badge
  const releaseCount = useMemo(() => {
    return notifications.filter(
      (n) => n.source === 'release' && !n.read && !n.dismissed
    ).length
  }, [notifications])

  const unreadCount = notifications.filter(
    (n) => !n.read && !n.dismissed
  ).length

  // Load release settings on mount
  useEffect(() => {
    loadReleaseData()
  }, [])

  const loadReleaseData = async () => {
    try {
      const [settings, status] = await Promise.all([
        getReleaseCheckSettings(),
        getReleaseCheckStatus(),
      ])
      setReleaseSettings(settings)
      setReleaseStatus(status)
    } catch (error) {
      console.error('Failed to load release check data:', error)
    }
  }

  // Action handlers
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
        let route = notification.action.route

        // Migrate old manga routes
        const oldMangaRouteMatch = route.match(
          /^\/manga\/([^?]+)\?extensionId=(.+)$/
        )
        if (oldMangaRouteMatch) {
          const [, mangaId, extensionId] = oldMangaRouteMatch
          route = `/read?extensionId=${extensionId}&mangaId=${mangaId}`
        }

        navigate({ to: route })
      }
      markAsRead(notification.id)
      onNavigateAway?.()
    },
    [navigate, markAsRead, onNavigateAway]
  )

  // Release check handlers
  const handleToggleReleaseCheck = async () => {
    if (!releaseSettings) return

    const newEnabled = !releaseSettings.enabled
    try {
      await updateReleaseCheckSettings(
        newEnabled,
        releaseSettings.interval_minutes
      )
      setReleaseSettings({ ...releaseSettings, enabled: newEnabled })
    } catch (error) {
      console.error('Failed to toggle release check:', error)
    }
  }

  const handleIntervalChange = async (minutes: number) => {
    if (!releaseSettings) return

    try {
      await updateReleaseCheckSettings(releaseSettings.enabled, minutes)
      setReleaseSettings({ ...releaseSettings, interval_minutes: minutes })
      setShowIntervalPicker(false)
    } catch (error) {
      console.error('Failed to update check interval:', error)
    }
  }

  const handleCheckNow = async () => {
    setIsChecking(true)
    try {
      const results = await checkForNewReleases()
      const status = await getReleaseCheckStatus()
      setReleaseStatus(status)

      if (results.length > 0) {
        setActiveTab('releases')
      }
    } catch (error) {
      console.error('Failed to check for releases:', error)
    } finally {
      setIsChecking(false)
    }
  }

  const currentIntervalLabel =
    INTERVAL_OPTIONS.find(
      (o) => o.value === releaseSettings?.interval_minutes
    )?.label ?? `${releaseSettings?.interval_minutes ?? 60}m`

  return (
    <div className="flex flex-col min-h-0">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-[var(--color-accent-primary)]" />
            <h2 className="text-lg font-bold">Notifications</h2>
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-[var(--color-accent-primary)] text-white rounded-full">
                {unreadCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {notifications.length > 0 && (
              <>
                <button
                  onClick={markAllAsRead}
                  className="p-2 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck size={18} />
                </button>
                <button
                  onClick={clearAll}
                  className="p-2 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                  title="Clear all"
                >
                  <Trash2 size={18} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('all')}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'all'
                ? 'text-[var(--color-accent-primary)] border-[var(--color-accent-primary)]'
                : 'text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text-primary)]'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setActiveTab('releases')}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'releases'
                ? 'text-[var(--color-accent-primary)] border-[var(--color-accent-primary)]'
                : 'text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text-primary)]'
            }`}
          >
            Releases
            {releaseCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-[var(--color-accent-primary)] text-white rounded-full">
                {releaseCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Release Check Controls (only on Releases tab) */}
      {activeTab === 'releases' && releaseSettings && (
        <div className="px-4 py-3 border-b border-white/10 bg-[var(--color-bg-secondary)] flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--color-text-secondary)]">
                Auto-check
              </span>
              {/* Toggle Switch */}
              <button
                onClick={handleToggleReleaseCheck}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  releaseSettings.enabled
                    ? 'bg-[var(--color-accent-primary)]'
                    : 'bg-[var(--color-bg-hover)]'
                }`}
                title={
                  releaseSettings.enabled
                    ? 'Disable release alerts'
                    : 'Enable release alerts'
                }
              >
                <span
                  className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  style={{
                    transform: releaseSettings.enabled
                      ? 'translateX(24px)'
                      : 'translateX(4px)',
                  }}
                />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Interval Picker */}
              <div className="relative">
                <button
                  onClick={() => setShowIntervalPicker(!showIntervalPicker)}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  {currentIntervalLabel}
                  <ChevronDown size={12} />
                </button>

                {showIntervalPicker && (
                  <div className="absolute right-0 top-full mt-1 w-28 bg-[var(--color-bg-primary)] border border-[var(--color-bg-hover)] rounded-lg shadow-lg z-10 overflow-hidden">
                    <div className="py-1">
                      {INTERVAL_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => handleIntervalChange(option.value)}
                          className={`w-full px-3 py-2 text-sm text-left transition-colors ${
                            releaseSettings.interval_minutes === option.value
                              ? 'bg-[var(--color-accent-primary)] text-white'
                              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Check Now Button */}
              <button
                onClick={handleCheckNow}
                disabled={isChecking}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isChecking
                    ? 'text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] cursor-not-allowed'
                    : 'text-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/10 hover:bg-[var(--color-accent-primary)]/20'
                }`}
              >
                <RefreshCw
                  size={12}
                  className={isChecking ? 'animate-spin' : ''}
                />
                {isChecking ? 'Checking...' : 'Check Now'}
              </button>
            </div>
          </div>

          {/* Status Line */}
          {releaseStatus && releaseSettings.enabled && (
            <div className="flex items-center gap-1 mt-2 text-xs text-[var(--color-text-muted)]">
              <Clock size={10} />
              <span>
                Last checked: {formatRelativeTime(releaseStatus.last_check)}
                {releaseStatus.items_checked > 0 && (
                  <> · {releaseStatus.items_checked} items</>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Notification List */}
      <div className="flex-1 overflow-y-auto">
        {filteredNotifications.length === 0 ? (
          <div className="py-16 px-4 text-center">
            <Bell
              size={40}
              className="mx-auto mb-4 text-[var(--color-text-muted)]"
            />
            <p className="text-[var(--color-text-secondary)] font-medium">
              {activeTab === 'releases'
                ? 'No release notifications'
                : 'No notifications yet'}
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              {activeTab === 'releases'
                ? 'New episodes and chapters will appear here'
                : 'Download updates and alerts will appear here'}
            </p>
          </div>
        ) : (
          filteredNotifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onDismiss={dismiss}
              onAction={handleAction}
              onMarkRead={markAsRead}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {filteredNotifications.length > 0 && (
        <div className="px-4 py-2 border-t border-white/10 text-center flex-shrink-0">
          <span className="text-xs text-[var(--color-text-muted)]">
            {filteredNotifications.length} notification
            {filteredNotifications.length !== 1 ? 's' : ''}
            {activeTab === 'all' &&
              unreadCount > 0 &&
              ` (${unreadCount} unread)`}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Modal shell — wraps NotificationPageContent with backdrop, fixed positioning,
 * close button, and Escape key handler.
 */
export function MobileNotificationCenter({
  isOpen,
  onClose,
}: MobileNotificationCenterProps) {
  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape, true)
    return () => document.removeEventListener('keydown', handleEscape, true)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-300">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/90 backdrop-blur-md -z-10"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div
        className="relative bg-[var(--color-bg-primary)] rounded-xl max-w-lg w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-500 border border-white/5 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button (modal only) */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
        >
          <X size={20} />
        </button>

        <NotificationPageContent onNavigateAway={onClose} />
      </div>
    </div>
  )
}
