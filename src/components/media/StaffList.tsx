import type { JikanStaffEntry } from '@/utils/tauri-commands'

interface StaffListProps {
  staff: JikanStaffEntry[]
  loading?: boolean
}

function getPersonImage(person: { images?: { webp?: { image_url?: string }; jpg?: { image_url?: string } } }): string | undefined {
  const imgs = person.images
  if (!imgs) return undefined
  return imgs.webp?.image_url || imgs.jpg?.image_url || undefined
}

export function StaffList({ staff, loading }: StaffListProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2 animate-pulse">
            <div className="w-10 h-10 rounded-full bg-[var(--color-bg-hover)] shrink-0" />
            <div className="flex-1">
              <div className="h-3 bg-[var(--color-bg-hover)] rounded w-3/4" />
              <div className="h-2.5 bg-[var(--color-bg-hover)] rounded w-1/2 mt-1.5" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (staff.length === 0) {
    return (
      <p className="text-center py-8 text-[var(--color-text-secondary)]">
        No staff data available
      </p>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
      {staff.map((entry, idx) => {
        const imgUrl = getPersonImage(entry.person)
        return (
          <div key={`${entry.person.mal_id}-${idx}`} className="flex items-center gap-3 py-2 sm:py-2 min-h-[48px]">
            <div className="w-10 h-10 rounded-full overflow-hidden bg-[var(--color-bg-secondary)] shrink-0">
              {imgUrl ? (
                <img
                  src={imgUrl}
                  alt={entry.person.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">
                  ?
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                {entry.person.name}
              </p>
              {entry.positions && entry.positions.length > 0 && (
                <p className="text-xs text-[var(--color-text-muted)] truncate">
                  {entry.positions.join(', ')}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
