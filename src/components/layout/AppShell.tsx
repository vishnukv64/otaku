import { ReactNode } from 'react'
import { TopNav } from './TopNav'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <TopNav />
      <main className="pt-16">{children}</main>
    </div>
  )
}
