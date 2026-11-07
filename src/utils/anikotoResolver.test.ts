import { describe, expect, it } from 'vitest'
import type { MediaDetails, SearchResult } from '@/types/extension'
import { buildAnikotoSearchQueries, pickBestAnikotoMatch, scoreAnikotoCandidate } from './anikotoResolver'

function details(overrides: Partial<MediaDetails>): MediaDetails {
  return {
    id: 'mal-1',
    title: 'Tensei shitara Dainana Ouji Datta node, Kimama ni Majutsu wo Kiwamemasu',
    english_name: 'I Was Reincarnated as the 7th Prince so I Can Take My Time Perfecting My Magical Ability',
    native_name: undefined,
    title_synonyms: [],
    genres: [],
    episodes: [],
    type: 'TV',
    episode_count: 12,
    ...overrides,
  }
}

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: 'candidate',
    title: 'Candidate',
    ...overrides,
  }
}

describe('Anikoto resolver', () => {
  it('rejects a sequel hit when the target title has no sequel season marker', () => {
    const target = details({})
    const seasonTwo = result({
      id: 'season-2',
      title: 'I Was Reincarnated as the 7th Prince so I Can Take My Time Perfecting My Magical Ability Season 2',
      native_name: 'Tensei shitara Dainana Ouji Datta node, Kimama ni Majutsu wo Kiwamemasu 2nd Season',
      available_episodes: 12,
      media_type: 'TV',
    })
    const seasonOne = result({
      id: 'season-1',
      title: 'I Was Reincarnated as the 7th Prince so I Can Take My Time Perfecting My Magical Ability',
      native_name: 'Tensei shitara Dainana Ouji Datta node, Kimama ni Majutsu wo Kiwamemasu',
      available_episodes: 12,
      media_type: 'TV',
    })

    expect(scoreAnikotoCandidate(target, seasonTwo)).toBe(0)
    expect(pickBestAnikotoMatch(target, [seasonTwo, seasonOne])?.id).toBe('season-1')
  })

  it('accepts season two when the target titles carry the same season marker', () => {
    const target = details({
      title: 'Dandadan 2nd Season',
      english_name: 'Dan Da Dan Season 2',
      native_name: undefined,
      title_synonyms: ['DAN DA DAN Season 2'],
    })
    const candidate = result({
      id: 'dan-da-dan-season-2-hhxir',
      title: 'Dan Da Dan Season 2',
      native_name: 'Dandadan 2nd Season',
      available_episodes: 12,
      media_type: 'TV',
    })

    expect(pickBestAnikotoMatch(target, [candidate])?.id).toBe('dan-da-dan-season-2-hhxir')
  })

  it('accepts an arc-named season that matches exactly but carries no season number', () => {
    const target = details({
      title: 'Jujutsu Kaisen: Shimetsu Kaiyuu - Zenpen',
      english_name: 'JUJUTSU KAISEN Season 3: The Culling Game Part 1',
      title_synonyms: ['Jujutsu Kaisen 3rd Season', 'JJK3'],
    })
    const exact = result({
      id: 'jujutsu-kaisen-shimetsu-kaiyuu-zoku-hen-29dd',
      title: 'Jujutsu Kaisen: Shimetsu Kaiyuu - Zenpen',
      title_synonyms: ['Jujutsu Kaisen: The Culling Game Part 1'],
      media_type: 'tv',
    })
    const firstSeason = result({ id: 'jujutsu-kaisen-650f', title: 'Jujutsu Kaisen', available_episodes: 24, media_type: 'tv' })

    expect(scoreAnikotoCandidate(target, firstSeason)).toBe(0)
    expect(pickBestAnikotoMatch(target, [firstSeason, exact])?.id).toBe('jujutsu-kaisen-shimetsu-kaiyuu-zoku-hen-29dd')
  })

  it('searches spellings that differ only in punctuation', () => {
    const queries = buildAnikotoSearchQueries(details({ title: 'One Punch Man', english_name: 'One-Punch Man' }))
    expect(queries.slice(0, 2)).toEqual(['One-Punch Man', 'One Punch Man'])
  })

  it('ignores provider labels such as (Uncensored)', () => {
    const target = details({ title: 'Tokyo Revengers: Santen Sensou-hen', english_name: undefined, episode_count: undefined })
    const candidate = result({ id: 'tr', title: 'Tokyo Revengers: Santen Sensou-hen (Uncensored)', media_type: 'tv' })
    expect(pickBestAnikotoMatch(target, [candidate])?.id).toBe('tr')
  })
})
