/**
 * Footer Component
 *
 * Compact global footer displayed on all pages
 */

import { useEffect, useState } from 'react'
import { Heart } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { getVersion } from '@tauri-apps/api/app'
import logoImage from '@/assets/logo.png'

export function Footer() {
  const currentYear = new Date().getFullYear()
  const [appVersion, setAppVersion] = useState<string>('')

  useEffect(() => {
    getVersion().then(setAppVersion).catch(console.error)
  }, [])

  return (
    <footer className="border-t border-[var(--color-glass-border)] bg-[var(--color-void)]">
      <div className="max-w-4k mx-auto px-4 3xl:px-12 py-3 flex items-center justify-between gap-4 flex-wrap">
        {/* Left: Branding + copyright */}
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
          >
            <div
              className="h-6 w-6 rounded-full flex items-center justify-center shadow-[0_0_12px_rgba(229,9,20,0.2)] overflow-hidden"
              style={{ background: 'var(--accent-gradient)' }}
            >
              <img
                src={logoImage}
                alt="Otaku"
                className="h-6 w-6 object-contain"
              />
            </div>
            <span
              className="text-sm font-extrabold font-display"
              style={{
                background: 'var(--accent-gradient-h)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              OTAKU
            </span>
          </Link>
          <span className="text-[var(--color-glass-border)]">|</span>
          <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
            Made with <Heart size={10} className="text-[var(--color-accent-primary)] fill-current" /> &copy; {currentYear}
          </span>
        </div>

        {/* Right: Disclaimer + version */}
        <div className="flex items-center gap-3">
          <p className="text-[11px] text-[var(--color-text-dim)] max-w-md">
            Content provided by third-party extensions. For educational purposes only.
          </p>
          {appVersion && (
            <span className="font-mono text-[11px] text-[var(--color-text-dim)] opacity-60 whitespace-nowrap">v{appVersion}</span>
          )}
        </div>
      </div>
    </footer>
  )
}
