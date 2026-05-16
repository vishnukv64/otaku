import { describe, expect, it } from 'vitest'
import type { SearchResult } from '@/types/extension'
import { getDefaultMediaSortDirection, sortMediaResults } from './mediaSort'

const items: SearchResult[] = [
  { id: '1', title: 'Beta', rating: 8.1, year: 2024, available_episodes: 6, popularity: 20 },
  { id: '2', title: 'Alpha', rating: 9.2, year: 2022, available_episodes: 24, popularity: 3 },
  { id: '3', title: 'Gamma', rating: 7.4, year: 2023, available_episodes: 12, popularity: 8 },
]

describe('media sorting', () => {
  it('uses user-facing default directions for header sort options', () => {
    expect(getDefaultMediaSortDirection('title')).toBe('asc')
    expect(getDefaultMediaSortDirection('popularity')).toBe('asc')
    expect(getDefaultMediaSortDirection('score')).toBe('desc')
    expect(getDefaultMediaSortDirection('start_date')).toBe('desc')
  })

  it('sorts score, title, newest, episodes, and popularity correctly', () => {
    expect(sortMediaResults(items, 'score').map((item) => item.id)).toEqual(['2', '1', '3'])
    expect(sortMediaResults(items, 'title').map((item) => item.id)).toEqual(['2', '1', '3'])
    expect(sortMediaResults(items, 'start_date').map((item) => item.id)).toEqual(['1', '3', '2'])
    expect(sortMediaResults(items, 'episodes').map((item) => item.id)).toEqual(['2', '3', '1'])
    expect(sortMediaResults(items, 'popularity').map((item) => item.id)).toEqual(['2', '3', '1'])
  })
})
