import { Link, useRouterState } from '@tanstack/react-router'
import { Home, Tv, BookOpen, Library, Settings } from 'lucide-react'

const tabs = [
  { name: 'Home', path: '/', icon: Home },
  { name: 'Anime', path: '/anime', icon: Tv },
  { name: 'Manga', path: '/manga', icon: BookOpen },
  { name: 'Library', path: '/library', icon: Library },
  { name: 'Settings', path: '/settings', icon: Settings },
] as const

export function BottomTabBar() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <nav
      className="shrink-0 z-[100] bg-[var(--color-bg-primary)] border-t border-white/10"
      style={{ paddingBottom: 'var(--sab)' }}
    >
      <div className="flex items-center justify-around h-16">
        {tabs.map((tab) => {
          const isActive = tab.path === '/'
            ? currentPath === '/'
            : currentPath.startsWith(tab.path)
          const Icon = tab.icon

          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors ${
                isActive
                  ? 'text-[var(--color-accent-primary)]'
                  : 'text-[var(--color-text-muted)]'
              }`}
            >
              <Icon size={22} />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
