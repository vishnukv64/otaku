import { Link, useRouterState } from '@tanstack/react-router'
import { Search, Settings, Menu, X, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDownloadStatus } from '@/hooks/useDownloadStatus'
import { ToastContainer } from '@/components/ui/Toast'
import { DownloadManager } from '@/components/player/DownloadManager'
import logoImage from '@/assets/logo.png'

const navItems = [
  { name: 'Home', path: '/' },
  { name: 'Anime', path: '/anime' },
  { name: 'Manga', path: '/manga' },
  { name: 'Library', path: '/library' },
]

export function TopNav() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [downloadManagerOpen, setDownloadManagerOpen] = useState(false)
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const { activeCount, toasts } = useDownloadStatus()

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 0)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-[var(--color-bg-primary)]' : 'bg-gradient-to-b from-black/80 to-transparent'
      }`}
    >
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-8">
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
              className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Search"
            >
              <Search size={20} />
            </button>

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

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} />
    </nav>
  )
}
