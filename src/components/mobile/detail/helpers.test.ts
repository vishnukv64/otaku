import { describe, it, expect } from 'vitest'
import { chunkRanges, isRecentlyReleased, rangeSelection, timeAgo } from './helpers'

describe('chunkRanges', () => {
  it('chunks with a short tail', () => {
    expect(chunkRanges(120, 50).map((r) => r.label)).toEqual(['1–50', '51–100', '101–120'])
  })
  it('handles empty/invalid input', () => {
    expect(chunkRanges(0, 50)).toEqual([])
    expect(chunkRanges(10, 0)).toEqual([])
  })
  it('single chunk when total < size', () => {
    expect(chunkRanges(7, 50)).toEqual([{ start: 1, end: 7, label: '1–7' }])
  })
})

describe('rangeSelection', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `c${i + 1}`, number: i + 1 }))
  it('skips already downloaded and tolerates reversed bounds', () => {
    const r = rangeSelection(items, 5, 2, new Set(['c3']))
    expect(r.inRange).toBe(4)
    expect(r.skipped).toBe(1)
    expect(r.toDownload.map((i) => i.id)).toEqual(['c2', 'c4', 'c5'])
  })
})

describe('isRecentlyReleased', () => {
  it('uses releaseDate when present', () => {
    expect(isRecentlyReleased(1, 1, new Date().toISOString(), undefined, undefined)).toBe(true)
    expect(isRecentlyReleased(1, 1, '2000-01-01', undefined, undefined)).toBe(false)
  })
  it('false without timing info', () => {
    expect(isRecentlyReleased(1, 1, undefined, undefined, undefined)).toBe(false)
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2025-06-30T00:00:00Z')
  it('formats days and months, blank for bad input', () => {
    expect(timeAgo('2025-06-28T00:00:00Z', now)).toBe('2 days ago')
    expect(timeAgo('2025-03-01T00:00:00Z', now)).toBe('4 mo ago')
    expect(timeAgo('nope', now)).toBe('')
    expect(timeAgo(undefined, now)).toBe('')
  })
})
