import { Link } from '@tanstack/react-router'

/** Phone-only Discover | Schedule segmented control shown at the top of the Anime tab and Schedule. */
export function AnimeSegment({ active }: { active: 'discover' | 'schedule' }) {
  const base = 'flex min-h-[40px] flex-1 items-center justify-center rounded-[var(--radius-md)] text-sm font-semibold'
  const on = 'bg-[var(--color-accent-primary)] text-white'
  const off = 'text-[var(--color-text-secondary)]'
  return (
    <div className="mx-4 mb-3 flex gap-1 rounded-[var(--radius-lg)] border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)] p-1">
      <Link to="/anime" className={`${base} ${active === 'discover' ? on : off}`}>
        Discover
      </Link>
      <Link to="/schedule" className={`${base} ${active === 'schedule' ? on : off}`}>
        Schedule
      </Link>
    </div>
  )
}
