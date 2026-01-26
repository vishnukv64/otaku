import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Toaster } from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <>
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
    </>
  )
}
