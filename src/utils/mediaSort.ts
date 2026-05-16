import type { SearchResult } from '@/types/extension'

export type MediaSortDirection = 'asc' | 'desc'

export function getDefaultMediaSortDirection(orderBy: string): MediaSortDirection {
  if (orderBy === 'title' || orderBy === 'popularity') return 'asc'
  return 'desc'
}

const NUMERIC_SORT_KEYS = new Set(['score', 'start_date', 'episodes', 'popularity', 'rank'])

function numericValue(item: SearchResult, orderBy: string, direction: MediaSortDirection): number {
  const missing = direction === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY

  if (orderBy === 'score') return item.rating ?? missing
  if (orderBy === 'start_date') return item.year ?? missing
  if (orderBy === 'episodes') return item.available_episodes ?? missing
  if (orderBy === 'popularity') return item.popularity ?? missing
  if (orderBy === 'rank') return item.rank ?? missing

  return missing
}

export function sortMediaResults(
  items: SearchResult[],
  orderBy: string,
  direction: MediaSortDirection = getDefaultMediaSortDirection(orderBy)
): SearchResult[] {
  if (orderBy === 'title') {
    return [...items].sort((a, b) => {
      const comparison = a.title.localeCompare(b.title)
      return direction === 'asc' ? comparison : -comparison
    })
  }

  if (!NUMERIC_SORT_KEYS.has(orderBy)) return [...items]

  return [...items].sort((a, b) => {
    const aValue = numericValue(a, orderBy, direction)
    const bValue = numericValue(b, orderBy, direction)
    if (aValue === bValue) return 0
    return direction === 'asc' ? aValue - bValue : bValue - aValue
  })
}
