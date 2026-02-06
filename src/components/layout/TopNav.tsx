import { Link, useRouterState, useRouter } from '@tanstack/react-router'
import { Search, Settings, Menu, X, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState, useRef } from 'react'
import { useDownloadStatus } from '@/hooks/useDownloadStatus'
import { DownloadManager } from '@/components/player/DownloadManager'
import { NotificationCenter } from '@/components/notifications'
import { ApiStatusIndicator } from './ApiStatusIndicator'
import logoImage from '@/assets/logo.png'

const navItems = [
  { name: 'Home', path: '/' },
  { name: 'Anime', path: '/anime' },
  { name: 'Manga', path: '/manga' },
  { name: 'Library', path: '/library' },
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
  const currentPath = routerState.location.pathname
  const { activeCount } = useDownloadStatus()

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

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-300 ${
        scrolled ? 'bg-[var(--color-bg-primary)]' : 'bg-gradient-to-b from-black/80 to-transparent'
      }`}
    >
      <div className="max-w-4k mx-auto px-4 sm:px-6 lg:px-8 3xl:px-12">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Navigation Buttons */}
          <div className="flex items-center gap-6">
            <Link
              to="/"
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
            >
              <img
                src={logoImage}
                alt="Otaku Logo"
                className="h-10 w-10 object-contain bg-black rounded-full"
              />
              <span className="text-2xl font-bold text-[var(--color-accent-primary)] hidden sm:inline">
                OTAKU
              </span>
            </Link>

            {/* Back/Forward Buttons */}
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

            {/* Desktop Navigation Links */}
            <div className="hidden md:flex items-center gap-6">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`text-sm font-medium transition-colors hover:text-[var(--color-text-primary)] ${
                    currentPath === item.path
                      ? 'text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>

          {/* Right Side Icons */}
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={onSearchClick}
              className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors group flex items-center gap-2"
              aria-label="Search (Cmd+K)"
              title="Search (Cmd+K)"
            >
              <Search size={20} />
              <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] rounded border border-[var(--color-bg-hover)] group-hover:border-[var(--color-text-muted)]">
                <span className="text-[10px]">⌘</span>K
              </kbd>
            </button>

            {/* Notification Center */}
            <NotificationCenter />

            {/* Download Indicator with Badge */}
            <button
              onClick={() => setDownloadManagerOpen(true)}
              className="relative p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Downloads"
            >
              <Download size={20} />
              {activeCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-[var(--color-accent-primary)] text-white text-xs font-bold rounded-full flex items-center justify-center animate-pulse">
                  {activeCount}
                </span>
              )}
            </button>

            {/* API Status Indicator */}
            <ApiStatusIndicator />

            <Link
              to="/settings"
              className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Settings"
              onClick={() => setMobileMenuOpen(false)}
            >
              <Settings size={20} />
            </Link>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Menu"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-[var(--color-bg-hover)]">
            <div className="flex flex-col gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-4 py-3 text-base font-medium transition-colors hover:bg-[var(--color-bg-hover)] rounded ${
                    currentPath === item.path
                      ? 'text-[var(--color-text-primary)] bg-[var(--color-bg-secondary)]'
                      : 'text-[var(--color-text-secondary)]'
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

      {/* Download Manager Modal */}
      <DownloadManager
        isOpen={downloadManagerOpen}
        onClose={() => setDownloadManagerOpen(false)}
      />
    </nav>
  )
}
