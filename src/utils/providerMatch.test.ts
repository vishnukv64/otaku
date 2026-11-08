import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaDetails, SearchResult } from '@/types/extension'

const store = new Map<string, string>()
vi.mock('@/utils/tauri-commands', () => ({
  getAppSetting: vi.fn(async (k: string) => store.get(k) ?? null),
  setAppSetting: vi.fn(async (k: string, v: string) => void store.set(k, v)),
}))

import { matchTitles, rankMatches, resolveProviderSlug, setProviderMatch } from '@/utils/providerMatch'

const details = {
  id: '1',
  title: 'Devilman Crybaby',
  english_name: 'Devilman: Crybaby',
  native_name: 'デビルマン crybaby',
  title_synonyms: ['devilman crybaby'],
  year: 2018,
  type: 'ONA',
  episode_count: 10,
} as MediaDetails

const r = (id: string, o: Partial<SearchResult>): SearchResult => ({ id, title: id, ...o })

describe('rankMatches', () => {
  it('orders by closest year then type, and preselects the single full agreement', () => {
    const out = rankMatches(details, [
      r('lady', { year: 1998, media_type: 'tv', available_episodes: 26 }),
      r('uncut', { title: 'Devilman Crybaby Uncut', year: 2018, media_type: 'ona', available_episodes: 12 }),
      r('cry', { title: 'Devilman: Crybaby', year: 2018, media_type: 'ona', available_episodes: 10 }),
      r('tv18', { year: 2018, media_type: 'tv', available_episodes: 10 }),
    ])
    expect([out.best?.id, ...out.others.map((x) => x.id)]).toEqual(['cry', 'uncut', 'tv18', 'lady'])
    expect(out.preselectId).toBe('cry')
  })

  it('preselects nothing when two results agree fully or none does', () => {
    const a = r('a', { year: 2018, media_type: 'ona', available_episodes: 10 })
    expect(rankMatches(details, [a, { ...a, id: 'b' }]).preselectId).toBeNull()
    expect(rankMatches(details, [r('c', { year: 2018, media_type: 'ona', available_episodes: 9 })]).preselectId).toBeNull()
    expect(rankMatches(details, [r('d', { media_type: 'ona' })]).preselectId).toBeNull()
  })

  it('has no best match when year or type is off', () => {
    const out = rankMatches(details, [r('x', { year: 1998, media_type: 'ona' })])
    expect(out.best).toBeNull()
    expect(out.others).toHaveLength(1)
  })
})

it('matchTitles dedupes case-insensitively', () => {
  expect(matchTitles(details)).toEqual(['Devilman: Crybaby', 'Devilman Crybaby', 'デビルマン crybaby'])
})

describe('resolveProviderSlug', () => {
  beforeEach(() => store.clear())

  it('uses the saved pick without searching, per provider + media', async () => {
    const search = vi.fn(async () => ({ results: [r('auto', { year: 2018, media_type: 'ona' })], has_next_page: false }))
    await setProviderMatch('kaa', '1', { id: 'picked', title: 'Picked' })
    expect((await resolveProviderSlug('kaa', '1', details, search))?.id).toBe('picked')
    expect(search).not.toHaveBeenCalled()
    // other provider has no pick → falls through to the auto-matcher
    await resolveProviderSlug('other', '1', details, search)
    expect(search).toHaveBeenCalled()
  })
})
