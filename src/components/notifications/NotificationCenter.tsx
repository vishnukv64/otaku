import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Bell, CheckCheck, Trash2, RefreshCw, Settings, Clock } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useNotificationStore, type Notification } from '@/store/notificationStore'
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

/** Interval options for release checking (V2: in minutes for more granular control) */
const INTERVAL_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 360, label: '6 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '24 hours' },
]

type TabType = 'all' | 'releases'

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [showSettings, setShowSettings] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [releaseSettings, setReleaseSettings] = useState<ReleaseCheckSettings | null>(null)
  const [releaseStatus, setReleaseStatus] = useState<ReleaseCheckStatus | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
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
    return notifications.filter((n) => n.source === 'release' && !n.read && !n.dismissed).length
  }, [notifications])

  // Load release settings and status when panel opens
  useEffect(() => {
    if (isOpen) {
      loadReleaseData()
    }
  }, [isOpen])

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

  // Action handlers that update both store and backend
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

        // Migrate old manga routes: /manga/{id}?extensionId={ext} -> /read?extensionId={ext}&mangaId={id}
        const oldMangaRouteMatch = route.match(/^\/manga\/([^?]+)\?extensionId=(.+)$/)
        if (oldMangaRouteMatch) {
          const [, mangaId, extensionId] = oldMangaRouteMatch
          route = `/read?extensionId=${extensionId}&mangaId=${mangaId}`
        }

        navigate({ to: route })
      }
      markAsRead(notification.id)
    },
    [navigate, markAsRead]
  )

  // Release check handlers (V2: uses interval_minutes)
  const handleToggleReleaseCheck = async () => {
    if (!releaseSettings) return

    const newEnabled = !releaseSettings.enabled
    try {
      await updateReleaseCheckSettings(newEnabled, releaseSettings.interval_minutes)
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
      setShowSettings(false)
    } catch (error) {
      console.error('Failed to update check interval:', error)
    }
  }

  const handleCheckNow = async () => {
    setIsChecking(true)
    try {
      const results = await checkForNewReleases()
      // Refresh status after check
      const status = await getReleaseCheckStatus()
      setReleaseStatus(status)

      // Switch to releases tab if new releases found
      if (results.length > 0) {
        setActiveTab('releases')
      }
    } catch (error) {
      console.error('Failed to check for releases:', error)
    } finally {
      setIsChecking(false)
    }
  }

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
        setShowSettings(false)
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
        setShowSettings(false)
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
          {/* Header with Tabs */}
          <div className="border-b border-[var(--color-bg-hover)]">
            <div className="flex items-center justify-between px-4 py-2">
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

            {/* Tabs */}
            <div className="flex px-4 gap-4">
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
            <div className="px-4 py-2 border-b border-[var(--color-bg-hover)] bg-[var(--color-bg-secondary)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--color-text-secondary)]">
                    Auto-check
                  </span>
                  {/* Toggle Switch */}
                  <button
                    onClick={handleToggleReleaseCheck}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      releaseSettings.enabled
                        ? 'bg-[var(--color-accent-primary)]'
                        : 'bg-[var(--color-bg-hover)]'
                    }`}
                    title={releaseSettings.enabled ? 'Disable release alerts' : 'Enable release alerts'}
                  >
                    <span
                      className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                      style={{
                        transform: releaseSettings.enabled ? 'translateX(18px)' : 'translateX(4px)',
                      }}
                    />
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  {/* Check Now Button */}
                  <button
                    onClick={handleCheckNow}
                    disabled={isChecking}
                    className={`p-1.5 rounded-md transition-colors ${
                      isChecking
                        ? 'text-[var(--color-text-muted)] cursor-not-allowed'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                    }`}
                    title="Check for new releases now"
                  >
                    <RefreshCw size={14} className={isChecking ? 'animate-spin' : ''} />
                  </button>

                  {/* Settings Dropdown Toggle */}
                  <div className="relative">
                    <button
                      onClick={() => setShowSettings(!showSettings)}
                      className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                      title="Release check settings"
                    >
                      <Settings size={14} />
                    </button>

                    {/* Settings Dropdown */}
                    {showSettings && (
                      <div className="absolute right-0 top-full mt-1 w-36 bg-[var(--color-bg-primary)] border border-[var(--color-bg-hover)] rounded-lg shadow-lg z-10 overflow-hidden">
                        <div className="py-1">
                          <div className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
                            Check Interval
                          </div>
                          {INTERVAL_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => handleIntervalChange(option.value)}
                              className={`w-full px-3 py-1.5 text-sm text-left transition-colors ${
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
                </div>
              </div>

              {/* Status Line */}
              {releaseStatus && releaseSettings.enabled && (
                <div className="flex items-center gap-1 mt-1 text-xs text-[var(--color-text-muted)]">
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
          <div className="max-h-[400px] overflow-y-auto">
            {filteredNotifications.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <Bell
                  size={32}
                  className="mx-auto mb-3 text-[var(--color-text-muted)]"
                />
                <p className="text-[var(--color-text-secondary)]">
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
                  onAction={handleNotificationAction}
                  onMarkRead={markAsRead}
                />
              ))
            )}
          </div>

          {/* Footer */}
          {filteredNotifications.length > 0 && (
            <div className="px-4 py-2 border-t border-[var(--color-bg-hover)] text-center">
              <span className="text-xs text-[var(--color-text-muted)]">
                {filteredNotifications.length} notification{filteredNotifications.length !== 1 ? 's' : ''}
                {activeTab === 'all' && unreadCount > 0 && ` (${unreadCount} unread)`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
