import { ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { TopNav } from './TopNav'
import { Footer } from './Footer'
import { BottomTabBar } from './BottomTabBar'
import { SpotlightSearch } from '@/components/search/SpotlightSearch'
import { useSpotlightSearch } from '@/hooks/useSpotlightSearch'
import { isMobile } from '@/utils/platform'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const spotlight = useSpotlightSearch()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const mobile = isMobile()

  // Hide TopNav and Footer on immersive routes (watch, read)
  const isImmersiveRoute = currentPath === '/watch' || currentPath === '/read'

  if (isImmersiveRoute) {
    // Immersive mode - no TopNav, no Footer/TabBar, no padding
    return (
      <div className="min-h-screen bg-[var(--color-bg-primary)] flex flex-col">
        <main className="flex-1">{children}</main>
        <SpotlightSearch isOpen={spotlight.isOpen} onClose={spotlight.close} />
      </div>
    )
  }

  if (mobile) {
    // Mobile: fixed viewport layout — header/footer in normal flow, only main scrolls.
    // The tauri-plugin-edge-to-edge handles native WKWebView edge-to-edge on iOS,
    // so `fixed inset-0` fills the entire screen including behind safe areas.
    return (
      <div className="fixed inset-0 flex flex-col bg-[var(--color-bg-primary)]">
        <TopNav onSearchClick={spotlight.open} />
        <main className="flex-1 overflow-y-auto min-h-0">{children}</main>
        <BottomTabBar />
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
