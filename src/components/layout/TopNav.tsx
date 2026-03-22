import { Link, useRouterState, useRouter, useNavigate } from '@tanstack/react-router'
import { Search, Settings, Menu, X, Download, ChevronLeft, ChevronRight, Bell } from 'lucide-react'
import { useEffect, useState, useRef } from 'react'
import { useDownloadStatus } from '@/hooks/useDownloadStatus'
import { DownloadManager } from '@/components/player/DownloadManager'
import { NotificationCenter } from '@/components/notifications'
import { useNotificationStore } from '@/store/notificationStore'
import logoImage from '@/assets/logo.png'
import { isMobile } from '@/utils/platform'

const navItems = [
  { name: 'Home', path: '/' },
  { name: 'Anime', path: '/anime' },
  { name: 'Manga', path: '/manga' },
  { name: 'Schedule', path: '/schedule' },
  { name: 'Library', path: '/library' },
  { name: 'History', path: '/history' },
  { name: 'Stats', path: '/stats' },
]

interface TopNavProps {
  onSearchClick?: () => void
}

export function TopNav({ onSearchClick }: TopNavProps) {
  const [scrolled, setScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [downloadManagerOpen, setDownloadManagerOpen] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const routerState = useRouterState()
  const router = useRouter()
  const navigate = useNavigate()
  const currentPath = routerState.location.pathname
  const { activeCount } = useDownloadStatus()
  const mobile = isMobile()
  const unreadNotificationCount = useNotificationStore(
    (s) => s.notifications.filter((n) => !n.read && !n.dismissed).length
  )

  // Track navigation position using refs
  const navigationPosition = useRef(0)
  const maxNavigationPosition = useRef(0)
  const isBackForwardNavigation = useRef(false)

  // Track when currentPath changes (captures all navigation)
  const previousPath = useRef(currentPath)
  useEffect(() => {
    if (previousPath.current !== currentPath) {
      if (!isBackForwardNavigation.current) {
        // New forward navigation (Link click, etc.)
        navigationPosition.current++
        maxNavigationPosition.current = navigationPosition.current
      }
      // Reset the flag
      isBackForwardNavigation.current = false

      // Update button states
      setCanGoBack(navigationPosition.current > 0)
      setCanGoForward(navigationPosition.current < maxNavigationPosition.current)

      previousPath.current = currentPath
    }
  }, [currentPath])

  // Handle back navigation using router's built-in method
  const handleBack = () => {
    if (navigationPosition.current > 0) {
      navigationPosition.current--
      isBackForwardNavigation.current = true
      router.history.back()
    }
  }

  // Handle forward navigation using router's built-in method
  const handleForward = () => {
    if (navigationPosition.current < maxNavigationPosition.current) {
      navigationPosition.current++
      isBackForwardNavigation.current = true
      router.history.forward()
    }
  }

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 0)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Mobile: navigate to route pages. Desktop: open modals/dropdowns.
  const handleDownloadClick = () => {
    if (mobile) {
      navigate({ to: '/downloads' })
    } else {
      setDownloadManagerOpen(true)
    }
  }

  const handleNotificationClick = () => {
    navigate({ to: '/notifications' })
  }

  return (
    <>
    <nav
      className={`${mobile ? 'relative shrink-0' : 'fixed top-0 left-0 right-0'} z-[100] transition-all duration-300 backdrop-blur-[12px] ${
        scrolled
          ? 'bg-[rgba(20,20,20,0.98)] border-b border-[var(--color-glass-border)] shadow-[var(--shadow-md)]'
          : mobile
            ? 'bg-[var(--color-bg-primary)]'
            : 'bg-[linear-gradient(to_bottom,rgba(20,20,20,0.95)_0%,rgba(20,20,20,0.6)_60%,transparent_100%)] border-b border-transparent'
      }`}
      style={mobile ? { paddingTop: 'var(--sat)' } : undefined}
    >
      <div className="max-w-4k mx-auto px-4 sm:px-6 lg:px-8 3xl:px-12">
        <div className="flex items-center justify-between" style={{ height: 'var(--nav-height)' }}>
          {/* Logo & Navigation Buttons */}
          <div className="flex items-center gap-6">
            <Link
              to="/"
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
            >
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(229,9,20,0.25)] overflow-hidden"
                style={{ background: 'var(--accent-gradient)' }}
              >
                <img
                  src={logoImage}
                  alt="Otaku Logo"
                  className="h-9 w-9 object-contain"
                />
              </div>
              <span
                className="text-xl font-extrabold font-display hidden sm:inline"
                style={{
                  background: 'var(--accent-gradient-h)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                OTAKU
              </span>
            </Link>

            {/* Back/Forward Buttons (desktop only — Android has its own back gesture) */}
            {!isMobile() && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleBack}
                  disabled={!canGoBack}
                  className={`p-1.5 rounded-md transition-colors ${
                    canGoBack
                      ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                      : 'text-[var(--color-text-muted)] cursor-not-allowed opacity-50'
                  }`}
                  aria-label="Go back"
                  title="Go back"
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  onClick={handleForward}
                  disabled={!canGoForward}
                  className={`p-1.5 rounded-md transition-colors ${
                    canGoForward
                      ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                      : 'text-[var(--color-text-muted)] cursor-not-allowed opacity-50'
                  }`}
                  aria-label="Go forward"
                  title="Go forward"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}

            {/* Desktop Navigation Links */}
            <div className="hidden md:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`relative px-3.5 py-1.5 text-sm font-medium rounded-full transition-all duration-200 ${
                    currentPath === item.path
                      ? 'text-white bg-[var(--color-glass-bg)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-glass-bg)]'
                  }`}
                >
                  {item.name}
                  {currentPath === item.path && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-[var(--color-accent-mid)] shadow-[0_0_8px_var(--color-accent-primary)]" />
                  )}
                </Link>
              ))}
            </div>
          </div>

          {/* Right Side Icons */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Search button (desktop only — mobile uses BottomTabBar search) */}
            {!mobile && (
              <button
                onClick={onSearchClick}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm text-[var(--color-text-muted)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-bg-hover)] hover:border-[var(--color-glass-border-hover)] hover:text-[var(--color-text-secondary)] transition-all duration-200"
                aria-label="Search (Cmd+K)"
                title="Search (Cmd+K)"
              >
                <Search size={16} />
                <span className="hidden lg:inline text-[var(--color-text-dim)]">Search</span>
                <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-[var(--color-text-dim)] bg-[var(--color-glass-bg)] rounded border border-[var(--color-glass-border)]">
                  ⌘K
                </kbd>
              </button>
            )}

            {/* Notification Center */}
            {mobile ? (
              <button
                onClick={handleNotificationClick}
                className="relative p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-glass-bg)] transition-all duration-200"
                aria-label="Notifications"
              >
                <Bell size={20} />
                {unreadNotificationCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 bg-[var(--color-accent-primary)] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                  </span>
                )}
              </button>
            ) : (
              <NotificationCenter />
            )}

            {/* Download Indicator with Badge */}
            <button
              onClick={handleDownloadClick}
              className="relative p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-glass-bg)] transition-all duration-200"
              aria-label="Downloads"
            >
              <Download size={20} />
              {activeCount > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 bg-[var(--color-accent-primary)] text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
                  {activeCount}
                </span>
              )}
            </button>

            {/* Settings link (desktop only — mobile uses BottomTabBar) */}
            {!mobile && (
              <Link
                to="/settings"
                className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-glass-bg)] transition-all duration-200"
                aria-label="Settings"
              >
                <Settings size={20} />
              </Link>
            )}

            {/* Mobile Menu Button (desktop only — mobile uses BottomTabBar) */}
            {!mobile && (
              <button
                className="md:hidden p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                aria-label="Menu"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            )}
          </div>
        </div>

        {/* Mobile Menu (desktop small screens only — mobile uses BottomTabBar) */}
        {!mobile && mobileMenuOpen && (
          <div className="md:hidden py-3 border-t border-[var(--color-glass-border)]">
            <div className="flex flex-col gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                    currentPath === item.path
                      ? 'text-white bg-[var(--color-accent-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-glass-bg)]'
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

    </nav>

      {/* Download Manager Modal (desktop only) — rendered outside nav to escape its stacking context */}
      {!mobile && (
        <DownloadManager
          isOpen={downloadManagerOpen}
          onClose={() => setDownloadManagerOpen(false)}
        />
      )}
    </>
  )
}
