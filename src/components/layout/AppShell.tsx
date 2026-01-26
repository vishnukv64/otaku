import { ReactNode } from 'react'
import { TopNav } from './TopNav'
import { SpotlightSearch, useSpotlightSearch } from '@/components/search/SpotlightSearch'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const spotlight = useSpotlightSearch()

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <TopNav onSearchClick={spotlight.open} />
      <main className="pt-16">{children}</main>

      {/* Global Spotlight Search (Cmd+K) */}
      <SpotlightSearch isOpen={spotlight.isOpen} onClose={spotlight.close} />
    </div>
  )
}
