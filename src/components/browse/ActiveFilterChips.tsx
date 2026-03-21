/**
 * ActiveFilterChips Component
 *
 * Horizontal row of active filter pills with X buttons and "Clear all" action.
 */


export interface FilterChip {
  key: string
  label: string
  group: string
}

interface ActiveFilterChipsProps {
  filters: FilterChip[]
  onRemove: (key: string, group: string) => void
  onClearAll: () => void
}

export function ActiveFilterChips({ filters, onRemove, onClearAll }: ActiveFilterChipsProps) {
  if (filters.length === 0) return null

  return (
    <div className="flex items-center flex-wrap gap-2 px-3.5 py-1 rounded-[var(--radius-md)] bg-[rgba(229,9,20,0.05)] border border-[rgba(229,9,20,0.12)] mb-1">
      <span className="text-xs text-[var(--color-text-muted)]">Active:</span>
      {filters.map((filter) => (
        <span
          key={filter.key}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-[rgba(229,9,20,0.12)] border border-[rgba(229,9,20,0.3)] text-[var(--color-accent-light)]"
        >
          {filter.label}
          <button
            onClick={() => onRemove(filter.key, filter.group)}
            className="hover:text-white transition-colors text-base leading-none"
            aria-label={`Remove ${filter.label} filter`}
          >
            &times;
          </button>
        </span>
      ))}
      <button
        onClick={onClearAll}
        className="text-xs font-semibold text-[var(--color-accent-light)] bg-[rgba(229,9,20,0.1)] border border-[rgba(229,9,20,0.25)] rounded-full px-3 py-1 hover:bg-[rgba(229,9,20,0.2)] hover:border-[rgba(229,9,20,0.4)] transition-all ml-1"
      >
        Clear all
      </button>
    </div>
  )
}
