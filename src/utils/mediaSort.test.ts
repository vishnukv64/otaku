import { describe, expect, it } from 'vitest'
import type { SearchResult } from '@/types/extension'
import {
  getDefaultMediaSortDirection,
  getMangaDiscoverSortType,
  sortMediaResults,
} from './mediaSort'

const items: SearchResult[] = [
  { id: '1', title: 'Beta', rating: 8.1, year: 2024, available_episodes: 6, popularity: 20 },
  { id: '2', title: 'Alpha', rating: 9.2, year: 2022, available_episodes: 24, popularity: 3 },
  { id: '3', title: 'Gamma', rating: 7.4, year: 2023, available_episodes: 12, popularity: 8 },
]

const mangaItems: SearchResult[] = [
  { id: '1', title: 'Low Views', available_episodes: 20, views: 100 },
  { id: '2', title: 'High Views', available_episodes: 8, views: 5000 },
  { id: '3', title: 'Mid Views', available_episodes: 40, views: 900 },
]

const datedItems: SearchResult[] = [
  { id: '1', title: 'Older', year: 2026, latest_episode_date: { year: 2026, month: 0, date: 5 } },
  { id: '2', title: 'Newest', year: 2026, latest_episode_date: { year: 2026, month: 5, date: 20 } },
  { id: '3', title: 'Middle', year: 2026, latest_episode_date: { year: 2026, month: 2, date: 10 } },
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

  it('maps manga header sort values to provider discover sort values', () => {
    expect(getMangaDiscoverSortType('score')).toBe('score')
    expect(getMangaDiscoverSortType('popularity')).toBe('score')
    expect(getMangaDiscoverSortType('title')).toBe('az')
    expect(getMangaDiscoverSortType('start_date')).toBe('update')
    expect(getMangaDiscoverSortType('episodes')).toBe('update')
  })

  it('sorts manga provider rows by views when rating and MAL popularity are missing', () => {
    expect(sortMediaResults(mangaItems, 'popularity').map((item) => item.id)).toEqual([
      '2',
      '3',
      '1',
    ])
    expect(sortMediaResults(mangaItems, 'score').map((item) => item.id)).toEqual(['2', '3', '1'])
    expect(sortMediaResults(mangaItems, 'episodes').map((item) => item.id)).toEqual(['3', '1', '2'])
  })

  it('sorts newest by full latest episode date when available', () => {
    expect(sortMediaResults(datedItems, 'start_date').map((item) => item.id)).toEqual([
      '2',
      '3',
      '1',
    ])
  })
})
