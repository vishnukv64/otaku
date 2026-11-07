import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { Bell, ChevronLeft, Search } from 'lucide-react'
import logoImage from '@/assets/logo.png'
import { useNotificationStore } from '@/store/notificationStore'
import { isReleaseSummaryNotification } from '@/components/notifications/ReleaseRadarGroupCard'

// Phone app bar (mocks: design/files/home.html, system.html "App bar variants").
// - brand: Home, logo + OTAKU wordmark, search and notifications
// - tab:   tab roots, large title, search where the tab is searchable
// - pushed: screens opened from the You hub, back chevron + title
type Variant =
  | { kind: 'brand' }
  | { kind: 'tab'; title: string; search: boolean }
  | { kind: 'pushed'; title: string }

const TAB_TITLES: Record<string, { title: string; search: boolean }> = {
  '/anime': { title: 'Anime', search: true },
  '/manga': { title: 'Manga', search: true },
  '/library': { title: 'Library', search: true },
  '/you': { title: 'You', search: false },
}

const PUSHED_TITLES: Record<string, string> = {
  '/settings': 'Settings',
  '/history': 'History',
  '/stats': 'Stats',
  '/downloads': 'Downloads',
  '/schedule': 'Schedule',
  '/notifications': 'Notifications',
  '/logs': 'Logs',
}

function appBarVariant(pathname: string): Variant {
  if (pathname === '/') return { kind: 'brand' }
  const root = '/' + (pathname.split('/')[1] ?? '')
  const tab = TAB_TITLES[root]
  if (tab) return { kind: 'tab', ...tab }
  return { kind: 'pushed', title: PUSHED_TITLES[root] ?? '' }
}

function useUnreadCount(): number {
  return useNotificationStore(
    (s) => s.notifications.filter((n) => !n.read && !n.dismissed && !isReleaseSummaryNotification(n)).length
  )
}

const iconButton =
  'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white active:bg-[var(--color-glass-bg-hover)]'

export function MobileAppBar({ onSearchClick }: { onSearchClick: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const router = useRouter()
  const unread = useUnreadCount()
  const variant = appBarVariant(pathname)

  const searchButton = (
    <button type="button" className={iconButton} aria-label="Search" onClick={onSearchClick}>
      <Search size={24} aria-hidden="true" />
    </button>
  )

  return (
    <header
      className="relative z-[100] shrink-0 bg-[var(--color-bg-primary)]"
      style={{ paddingTop: 'var(--sat)' }}
    >
      <div className="flex h-[52px] items-center gap-1 pl-4 pr-2">
        {variant.kind === 'brand' && (
          <>
            <Link to="/" className="mr-auto flex items-center gap-2" aria-label="Otaku home">
              <img src={logoImage} alt="" className="h-[30px] w-[30px] object-contain" />
              <span className="font-display text-xl font-extrabold tracking-[0.02em] text-[var(--color-accent-primary)]">
                OTAKU
              </span>
            </Link>
            {searchButton}
            <Link
              to="/notifications"
              className={iconButton}
              aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
            >
              <Bell size={24} aria-hidden="true" />
              {unread > 0 && (
                <span className="absolute right-[3px] top-[5px] box-content h-4 min-w-4 rounded-full border-2 border-[var(--color-bg-primary)] bg-[var(--color-accent-primary)] px-1 text-center text-[10px] font-bold leading-4 text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          </>
        )}

        {variant.kind === 'tab' && (
          <>
            <h1 className="mr-auto font-display text-[22px] font-bold text-white">{variant.title}</h1>
            {variant.search && searchButton}
          </>
        )}

        {variant.kind === 'pushed' && (
          <>
            <button
              type="button"
              className={`${iconButton} -ml-3`}
              aria-label="Back"
              onClick={() => router.history.back()}
            >
              <ChevronLeft size={26} aria-hidden="true" />
            </button>
            <h1 className="mr-auto truncate font-display text-[17px] font-bold text-white">{variant.title}</h1>
          </>
        )}
      </div>
    </header>
  )
}
