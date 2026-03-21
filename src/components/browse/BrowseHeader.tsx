/**
 * BrowseHeader Component
 *
 * Page header with title, result count, sort dropdown.
 */

interface BrowseHeaderProps {
  title: string
  resultCount?: number
  sortBy: string
  onSortChange: (sort: string) => void
}

const sortOptions = [
  { value: 'popularity', label: 'Popularity' },
  { value: 'score', label: 'Score' },
  { value: 'title', label: 'Title' },
  { value: 'start_date', label: 'Newest' },
  { value: 'episodes', label: 'Episodes' },
]

export function BrowseHeader({ title, resultCount, sortBy, onSortChange }: BrowseHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
      <div>
        <h2 className="font-display font-bold text-[1.375rem] mb-1.5 border-l-[3px] border-[var(--color-accent-primary)] pl-3">{title}</h2>
        {resultCount != null && resultCount > 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">
            Showing <strong className="text-[var(--color-text-secondary)]">{resultCount} results</strong>
          </p>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value)}
          className="px-3 py-1.5 text-[0.8125rem] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-[var(--radius-md)] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Sort: {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
