import { useEffect, useState } from 'react'
import { createRootRoute, Outlet, Link } from '@tanstack/react-router'
import { Toaster } from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { MediaStatusProvider } from '@/contexts/MediaStatusContext'
import { useNotificationEvents } from '@/hooks/useNotificationEvents'
import { useAutoUpdateCheck } from '@/hooks/useAutoUpdateCheck'
import { useSettingsStore } from '@/store/settingsStore'
import { useReaderStore } from '@/store/readerStore'
import { usePlayerStore } from '@/store/playerStore'
import { ReleaseCheckOverlay } from '@/components/notifications/ReleaseCheckOverlay'
import { MigrationScreen } from '@/components/MigrationScreen'
import { checkMigrationNeeded } from '@/utils/tauri-commands'
import { Home, Search, ArrowLeft } from 'lucide-react'

function NotFoundPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        {/* 404 Number */}
        <div className="relative mb-8">
          <span className="text-[150px] font-bold text-[var(--color-text-primary)] opacity-5 select-none">
            404
          </span>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-24 h-24 rounded-full bg-[var(--color-accent-primary)]/10 flex items-center justify-center">
              <Search className="w-12 h-12 text-[var(--color-accent-primary)]" />
            </div>
          </div>
        </div>

        {/* Message */}
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-3">
          Page Not Found
        </h1>
        <p className="text-[var(--color-text-secondary)] mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>

        {/* Actions */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => window.history.back()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]/80 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
          <Link
            to="/"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent-primary)] text-white hover:bg-[var(--color-accent-primary)]/90 transition-colors"
          >
            <Home className="w-4 h-4" />
            Home
          </Link>
        </div>
      </div>
    </div>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundPage,
})

function RootComponent() {
  const [migrationNeeded, setMigrationNeeded] = useState<boolean | null>(null)

  // Check for pending data migration on startup
  useEffect(() => {
    checkMigrationNeeded()
      .then(setMigrationNeeded)
      .catch((err) => {
        console.error('Failed to check migration status:', err)
        setMigrationNeeded(false) // Don't block app on check failure
      })
  }, [])

  // Initialize all stores from database on app startup
  const initSettingsFromDatabase = useSettingsStore((state) => state.initFromDatabase)
  const initReaderFromDatabase = useReaderStore((state) => state.initFromDatabase)
  const initPlayerFromDatabase = usePlayerStore((state) => state.initFromDatabase)

  useEffect(() => {
    // Initialize all stores in parallel
    Promise.all([
      initSettingsFromDatabase(),
      initReaderFromDatabase(),
      initPlayerFromDatabase(),
    ]).catch((err) => {
      console.error('Failed to initialize stores from database:', err)
    })
  }, [initSettingsFromDatabase, initReaderFromDatabase, initPlayerFromDatabase])

  // Initialize notification event listener at root level
  // This ensures notifications are received app-wide
  useNotificationEvents()

  // Check for app updates on launch and periodically
  useAutoUpdateCheck()

  // Show migration screen while migration is needed (blocks all routes)
  if (migrationNeeded) {
    return <MigrationScreen onComplete={() => setMigrationNeeded(false)} />
  }

  // Still checking migration status — show nothing to avoid flash
  if (migrationNeeded === null) {
    return null
  }

  return (
    <MediaStatusProvider>
      <AppShell>
        <Outlet />
      </AppShell>
      <Toaster
        position="bottom-right"
        toastOptions={{
          // Default styling for all toasts
          style: {
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-primary)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '0.5rem',
            padding: '1rem',
          },
          // Success toasts
          success: {
            iconTheme: {
              primary: 'var(--color-accent-primary)',
              secondary: 'white',
            },
            duration: 3000,
          },
          // Error toasts
          error: {
            iconTheme: {
              primary: 'var(--color-accent-primary)',
              secondary: 'white',
            },
            duration: 4000,
          },
          // Loading toasts
          loading: {
            duration: Infinity,
          },
        }}
      />
      <ReleaseCheckOverlay />
    </MediaStatusProvider>
  )
}
