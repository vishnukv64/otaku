import { useEffect } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Toaster } from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { MediaStatusProvider } from '@/contexts/MediaStatusContext'
import { useNotificationEvents } from '@/hooks/useNotificationEvents'
import { useAutoUpdateCheck } from '@/hooks/useAutoUpdateCheck'
import { useSettingsStore } from '@/store/settingsStore'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  // Initialize settings from database on app startup
  const initFromDatabase = useSettingsStore((state) => state.initFromDatabase)
  useEffect(() => {
    initFromDatabase()
  }, [initFromDatabase])

  // Initialize notification event listener at root level
  // This ensures notifications are received app-wide
  useNotificationEvents()

  // Check for app updates on launch and periodically
  useAutoUpdateCheck()

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
    </MediaStatusProvider>
  )
}
