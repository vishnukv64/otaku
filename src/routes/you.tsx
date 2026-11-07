/**
 * You hub (phone only): the fifth tab. Mock: design/files/you.html.
 * Gives the screens that have no tab on the phone a home: History, Stats,
 * Downloads, Schedule, Notifications, Settings, Logs and About.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import {
  Activity,
  Bell,
  CalendarDays,
  ChartColumn,
  ChevronRight,
  Download,
  History,
  Info,
  Library,
  Settings,
  Terminal,
} from 'lucide-react'
import logoImage from '@/assets/logo.png'
import {
  getReadingStatsSummary,
  getTotalStorageUsed,
  getWatchStatsSummary,
  type ReadingStatsSummary,
  type WatchStatsSummary,
} from '@/utils/tauri-commands'
import { useDownloadStatus } from '@/hooks/useDownloadStatus'
import { useNotificationStore } from '@/store/notificationStore'
import { isReleaseSummaryNotification } from '@/components/notifications/ReleaseRadarGroupCard'
import { ApiStatusIndicator } from '@/components/layout/ApiStatusIndicator'

export const Route = createFileRoute('/you')({
  component: YouHub,
})

const numberFormat = new Intl.NumberFormat()

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

function Tile({ to, icon, title, meta }: { to: string; icon: ReactNode; title: string; meta: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex min-h-[92px] flex-col gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-3.5 active:bg-[var(--color-bg-hover)]"
    >
      <span className="text-[var(--color-accent-primary)]">{icon}</span>
      <span>
        <span className="block text-[15px] font-semibold text-white">{title}</span>
        <span className="block text-[12.5px] text-[var(--color-text-muted)]">{meta}</span>
      </span>
    </Link>
  )
}

function Row({ to, icon, title, sub, end }: { to: string; icon: ReactNode; title: string; sub: string; end?: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex min-h-[56px] items-center gap-3 border-b border-[var(--color-glass-border)] px-3.5 py-2.5 last:border-b-0 active:bg-[var(--color-bg-hover)]"
    >
      <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface)] text-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-white">{title}</span>
        <span className="block truncate text-[12.5px] text-[var(--color-text-muted)]">{sub}</span>
      </span>
      {end}
      <ChevronRight size={18} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
    </Link>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 text-center">
      <div className="font-display text-xl font-bold text-white">{value}</div>
      <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
    </div>
  )
}

function SectionHead({ children }: { children: ReactNode }) {
  return (
    <h2 className="px-[30px] pb-2 pt-[22px] text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
      {children}
    </h2>
  )
}

function YouHub() {
  const [version, setVersion] = useState('')
  const [watch, setWatch] = useState<WatchStatsSummary | null>(null)
  const [reading, setReading] = useState<ReadingStatsSummary | null>(null)
  const [storage, setStorage] = useState<number | null>(null)
  const { activeCount } = useDownloadStatus()
  const unread = useNotificationStore(
    (s) => s.notifications.filter((n) => !n.read && !n.dismissed && !isReleaseSummaryNotification(n)).length
  )

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(''))
    getWatchStatsSummary().then(setWatch).catch(() => setWatch(null))
    getReadingStatsSummary().then(setReading).catch(() => setReading(null))
    getTotalStorageUsed().then(setStorage).catch(() => setStorage(null))
  }, [])

  const hours = watch ? Math.round(watch.total_time_seconds / 3600) : null

  return (
    <div className="pb-8">
      <section className="flex items-center gap-3 px-4 pt-2" aria-label="Profile">
        <img src={logoImage} alt="Otaku logo" className="h-14 w-14 rounded-[var(--radius-lg)] object-contain" />
        <div>
          <div className="font-display text-[22px] font-bold text-white">Otaku</div>
          <div className="text-[13px] text-[var(--color-text-muted)]">{version ? `v${version}` : '\u00a0'}</div>
        </div>
      </section>

      <section
        className="mx-4 mt-4 flex rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] py-3.5"
        aria-label="Your totals"
      >
        <Stat value={hours === null ? '–' : `${numberFormat.format(hours)}h`} label="Watched" />
        <Stat value={watch ? numberFormat.format(watch.episodes_completed) : '–'} label="Episodes" />
        <Stat value={reading ? numberFormat.format(reading.total_chapters_completed) : '–'} label="Chapters" />
      </section>

      <SectionHead>Activity</SectionHead>
      <div className="mx-4 grid grid-cols-2 gap-2.5">
        <Tile to="/history" icon={<History size={22} />} title="History" meta="Watched and read" />
        <Tile to="/stats" icon={<ChartColumn size={22} />} title="Stats" meta="Your watch and read stats" />
        <Tile
          to="/downloads"
          icon={<Download size={22} />}
          title="Downloads"
          meta={
            <>
              {storage === null ? 'Offline library' : `${formatBytes(storage)} used`}
              {activeCount > 0 && ` · ${activeCount} active`}
            </>
          }
        />
        <Tile to="/schedule" icon={<CalendarDays size={22} />} title="Schedule" meta="Airing this week" />
        <Tile
          to="/notifications"
          icon={<Bell size={22} />}
          title="Notifications"
          meta={unread > 0 ? `${unread} unread` : 'All caught up'}
        />
        <Tile to="/library" icon={<Library size={22} />} title="Library" meta="Your saved titles" />
      </div>

      <SectionHead>App</SectionHead>
      <nav className="mx-4 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)]" aria-label="App">
        <Row to="/settings" icon={<Settings size={18} />} title="Settings" sub="Appearance, playback, reader, privacy" />
        <Row to="/logs" icon={<Terminal size={18} />} title="Logs" sub="View error logs and debug information" />
        <Row to="/settings" icon={<Info size={18} />} title="About" sub={version ? `Version ${version}, licences, links` : 'Version, licences, links'} />
      </nav>

      <SectionHead>Connectivity</SectionHead>
      <div className="mx-4 flex min-h-[56px] items-center gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] px-3.5 py-2.5">
        <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface)] text-white">
          <Activity size={18} />
        </span>
        <span className="flex-1 text-[15px] font-medium text-white">API status</span>
        <ApiStatusIndicator inline />
      </div>
    </div>
  )
}
