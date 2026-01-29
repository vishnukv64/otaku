import { ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { TopNav } from './TopNav'
import { Footer } from './Footer'
import { SpotlightSearch } from '@/components/search/SpotlightSearch'
import { useSpotlightSearch } from '@/hooks/useSpotlightSearch'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const spotlight = useSpotlightSearch()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  // Hide TopNav and Footer on immersive routes (watch, read)
  const isImmersiveRoute = currentPath === '/watch' || currentPath === '/read'

  if (isImmersiveRoute) {
    // Immersive mode - no TopNav, no Footer, no padding
    return (
      <div className="min-h-screen bg-[var(--color-bg-primary)] flex flex-col">
        <main className="flex-1">{children}</main>
        {/* Spotlight search still available with Cmd+K */}
        <SpotlightSearch isOpen={spotlight.isOpen} onClose={spotlight.close} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] flex flex-col">
      <TopNav onSearchClick={spotlight.open} />
      <main className="pt-16 flex-1">{children}</main>
      <Footer />

      {/* Global Spotlight Search (Cmd+K) */}
      <SpotlightSearch isOpen={spotlight.isOpen} onClose={spotlight.close} />
    </div>
  )
}
