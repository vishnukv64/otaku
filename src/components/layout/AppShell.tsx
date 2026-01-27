import { ReactNode } from 'react'
import { TopNav } from './TopNav'
import { Footer } from './Footer'
import { SpotlightSearch, useSpotlightSearch } from '@/components/search/SpotlightSearch'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const spotlight = useSpotlightSearch()

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
