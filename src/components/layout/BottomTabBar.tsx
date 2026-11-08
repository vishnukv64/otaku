import { Link, useRouterState } from '@tanstack/react-router'
import { House, Tv, BookOpen, Library, User } from 'lucide-react'
import { useNotificationStore } from '@/store/notificationStore'
import { isReleaseSummaryNotification } from '@/components/notifications/ReleaseRadarGroupCard'

// Phone tab bar (mock: design/files/home.html). Settings lives in the You hub, together with
// History, Stats, Downloads, Schedule and Notifications, so those routes highlight You.
const YOU_PATHS = ['/you', '/settings', '/history', '/stats', '/downloads', '/schedule', '/notifications', '/logs', '/pair']

const tabs = [
  { name: 'Home', path: '/', icon: House },
  { name: 'Anime', path: '/anime', icon: Tv },
  { name: 'Manga', path: '/manga', icon: BookOpen },
  { name: 'Library', path: '/library', icon: Library },
  { name: 'You', path: '/you', icon: User },
] as const

function isTabActive(path: string, currentPath: string): boolean {
  if (path === '/') return currentPath === '/'
  if (path === '/you') return YOU_PATHS.some((p) => currentPath.startsWith(p))
  return currentPath.startsWith(path)
}

export function BottomTabBar() {
  const currentPath = useRouterState({ select: (s) => s.location.pathname })
  const unread = useNotificationStore(
    (s) => s.notifications.filter((n) => !n.read && !n.dismissed && !isReleaseSummaryNotification(n)).length
  )

  return (
    <nav
      aria-label="Main"
      className="shrink-0 z-[100] bg-[rgba(20,20,20,0.96)] border-t border-[var(--color-glass-border)]"
      style={{ paddingBottom: 'var(--sab)' }}
    >
      <div className="flex items-stretch h-[53px]">
        {tabs.map((tab) => {
          const active = isTabActive(tab.path, currentPath)
          const Icon = tab.icon
          const badge = tab.path === '/you' && unread > 0 ? unread : 0
          return (
            <Link
              key={tab.path}
              to={tab.path}
              aria-current={active ? 'page' : undefined}
              aria-label={badge ? `${tab.name}, ${badge} unread` : tab.name}
              className={`flex flex-1 flex-col items-center justify-center gap-[3px] text-[11px] font-medium transition-colors ${
                active ? 'text-white' : 'text-[var(--color-text-muted)]'
              }`}
            >
              <span className="relative">
                <Icon
                  size={23}
                  className={active ? 'text-[var(--color-accent-primary)]' : undefined}
                  aria-hidden="true"
                />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-[var(--color-accent-primary)] text-white text-[10px] font-bold leading-4 text-center border-2 border-[var(--color-bg-primary)] box-content">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              {tab.name}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
