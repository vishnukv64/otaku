/**
 * Footer Component
 *
 * Global footer displayed on all pages
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
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="max-w-4k mx-auto px-4 3xl:px-12 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Branding - matches TopNav */}
          <Link
            to="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <img
              src={logoImage}
              alt="Otaku Logo"
              className="h-10 w-10 object-contain bg-black rounded-full"
            />
            <span className="text-2xl font-bold text-[var(--color-accent-primary)]">
              OTAKU
            </span>
          </Link>

          {/* Copyright and Version */}
          <div className="flex items-center gap-4 text-sm text-[var(--color-text-tertiary)]">
            <div className="flex items-center gap-1">
              <span>Made with</span>
              <Heart size={14} className="text-[var(--color-accent-primary)] fill-current" />
              <span>&copy; {currentYear} Otaku</span>
            </div>
            {appVersion && (
              <span className="font-mono text-xs opacity-75">v{appVersion}</span>
            )}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-tertiary)] text-center">
            Otaku does not store any media files on its servers. All content is provided by third-party extensions.
            This application is for educational purposes only.
          </p>
        </div>
      </div>
    </footer>
  )
}
