import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CheckCheck, X, RefreshCw, Settings, Clock } from 'lucide-react'
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
  getCachedMediaDetails,
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

/** Derive a notification category for tab filtering and badge display */
export function getNotifCategory(n: Notification): 'episode' | 'chapter' | 'schedule' | 'download' | 'system' {
  // Check source first
  if (n.source === 'schedule') return 'schedule'
  if (n.source === 'release') {
    const lower = (n.title + ' ' + n.message).toLowerCase()
    if (lower.includes('ch.') || lower.includes('chapter') || lower.includes('manga')) return 'chapter'
    return 'episode'
  }
  if (n.source === 'download') return 'download'

  // Fallback: infer from title/message
  const lower = (n.title + ' ' + n.message).toLowerCase()
  if (lower.includes('schedule') || lower.includes('airs today')) return 'schedule'
  if (lower.includes('download')) return 'download'
  if (lower.includes('episode') || lower.includes('ep ')) return 'episode'
  if (lower.includes('chapter') || lower.includes('ch.')) return 'chapter'

  return 'system'
}

/** Interval options for release checking */
const INTERVAL_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 360, label: '6 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '24 hours' },
]

type TabType = 'all' | 'episode' | 'chapter' | 'schedule' | 'download' | 'system'

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [showSettings, setShowSettings] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [releaseSettings, setReleaseSettings] = useState<ReleaseCheckSettings | null>(null)
  const [releaseStatus, setReleaseStatus] = useState<ReleaseCheckStatus | null>(null)
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({})
  const buttonRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()

  const store = useNotificationStore()
  const { notifications } = store

  // Filter notifications by tab
  const filteredNotifications = useMemo(() => {
    if (activeTab === 'all') return notifications
    return notifications.filter((n) => getNotifCategory(n) === activeTab)
  }, [notifications, activeTab])

  // Load release settings, status, and cover URLs when panel opens
  useEffect(() => {
    if (isOpen) {
      loadReleaseData()
      // Fetch cover URLs for notifications that have media_id but no thumbnail
      const mediaIds = new Set<string>()
      for (const n of notifications) {
        const mid = n.metadata?.media_id as string | undefined
        const thumb = n.metadata?.thumbnail as string | undefined
        if (mid && !thumb && !coverUrls[mid]) mediaIds.add(mid)
      }
      if (mediaIds.size > 0) {
        Promise.all(
          Array.from(mediaIds).map(async (id) => {
            try {
              const details = await getCachedMediaDetails(id)
              if (details?.media?.cover_url) return [id, details.media.cover_url] as const
            } catch { /* ignore */ }
            return null
          })
        ).then((results) => {
          const newCovers: Record<string, string> = {}
          for (const r of results) if (r) newCovers[r[0]] = r[1]
          if (Object.keys(newCovers).length > 0) setCoverUrls(prev => ({ ...prev, ...newCovers }))
        })
      }
    }
  }, [isOpen, notifications])

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

        // Migrate old manga routes
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

  // Release check handlers
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
      const status = await getReleaseCheckStatus()
      setReleaseStatus(status)

      if (results.length > 0) {
        setActiveTab('episode')
      }
    } catch (error) {
      console.error('Failed to check for releases:', error)
    } finally {
      setIsChecking(false)
    }
  }

  // Calculate unread count
  const unreadCount = notifications.filter((n) => !n.read && !n.dismissed).length

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

  const tabs: { key: TabType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'episode', label: 'Episodes' },
    { key: 'chapter', label: 'Chapters' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'download', label: 'Downloads' },
    { key: 'system', label: 'System' },
  ]

  return (
    <>
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

      {/* Portal: render overlay + panel outside nav stacking context */}
      {createPortal(
        <>
          {/* Overlay Backdrop */}
          <div
            className={`fixed inset-0 z-[9500] bg-black/50 backdrop-blur-[4px] transition-opacity duration-250 ${
              isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            onClick={() => { setIsOpen(false); setShowSettings(false) }}
          />

          {/* Slide-out Panel */}
          <div
        className={`fixed top-0 right-0 bottom-0 w-[420px] max-w-[100vw] z-[9501] bg-[var(--color-bg-primary)] border-l border-[var(--color-glass-border)] flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ boxShadow: isOpen ? '-8px 0 40px rgba(0,0,0,0.6), 0 0 60px rgba(0,0,0,0.3)' : 'none' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3.5 border-b border-[var(--color-glass-border)] flex-shrink-0">
          <h3 className="font-display font-bold text-[1.125rem] flex-1">Notifications</h3>
          {notifications.length > 0 && (
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] hover:bg-white/10 rounded-lg transition-colors text-sm text-[var(--color-text-secondary)]"
              title="Mark all as read"
            >
              <CheckCheck size={14} />
              <span className="text-xs">Mark all read</span>
            </button>
          )}
          <button
            onClick={() => { setIsOpen(false); setShowSettings(false) }}
            className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] hover:bg-white/10 hover:text-white flex items-center justify-center transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 py-3 border-b border-[var(--color-glass-border)] flex-shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-full text-[0.8rem] font-medium whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Release Check Controls (compact bar) */}
        {releaseSettings && (
          <div className="px-5 py-2 border-b border-[var(--color-glass-border)] flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-text-secondary)]">Auto-check</span>
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
                <button
                  onClick={handleCheckNow}
                  disabled={isChecking}
                  className={`p-1.5 rounded-md transition-colors ${
                    isChecking
                      ? 'text-[var(--color-text-muted)] cursor-not-allowed'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5'
                  }`}
                  title="Check for new releases now"
                >
                  <RefreshCw size={14} className={isChecking ? 'animate-spin' : ''} />
                </button>
                <div className="relative">
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5 transition-colors"
                    title="Release check settings"
                  >
                    <Settings size={14} />
                  </button>
                  {showSettings && (
                    <div className="absolute right-0 top-full mt-1 w-36 bg-[var(--color-bg-primary)] border border-[var(--color-glass-border)] rounded-lg shadow-lg z-10 overflow-hidden">
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
                                : 'text-[var(--color-text-secondary)] hover:bg-white/5'
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
        <div className="flex-1 overflow-y-auto px-2 py-2" style={{ scrollbarWidth: 'thin' }}>
          {filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-5 gap-3 text-[var(--color-text-muted)] text-center">
              <Bell size={40} style={{ opacity: 0.3 }} />
              <div className="font-semibold text-[0.9375rem] text-[var(--color-text-secondary)]">
                {activeTab === 'all' ? 'No notifications yet' : `No ${activeTab} notifications`}
              </div>
              <div className="text-[0.8125rem]">
                New updates will appear here
              </div>
            </div>
          ) : (
            filteredNotifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                coverUrl={coverUrls[(notification.metadata?.media_id as string) || ''] || (notification.metadata?.thumbnail as string)}
                onDismiss={dismiss}
                onAction={handleNotificationAction}
                onMarkRead={markAsRead}
              />
            ))
          )}
        </div>

        {/* Footer */}
        {filteredNotifications.length > 0 && (
          <div className="px-5 py-3 border-t border-[var(--color-glass-border)] text-center flex-shrink-0 flex items-center justify-center gap-3">
            <span className="text-xs text-[var(--color-text-muted)]">
              {filteredNotifications.length} notification{filteredNotifications.length !== 1 ? 's' : ''}
              {activeTab === 'all' && unreadCount > 0 && ` (${unreadCount} unread)`}
            </span>
            <button onClick={clearAll} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent-light)] transition-colors">
              Clear all
            </button>
          </div>
        )}
      </div>
        </>,
        document.body
      )}
    </>
  )
}
