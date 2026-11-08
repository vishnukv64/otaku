import { describe, expect, it } from 'vitest'
import { providerForMedia, streamingProviders } from './streamingProviders'

describe('providerForMedia', () => {
  const hentai = { genres: ['Hentai', 'Romance'] }
  const normal = { genres: ['Action'] }

  it('routes hentai to hstream only while 18+ mode is on', () => {
    expect(providerForMedia('kaa', true, hentai)).toBe('hstream')
    expect(providerForMedia('kaa', false, hentai)).toBe('kaa')
  })

  it('keeps the user pick for everything else, including before details load', () => {
    expect(providerForMedia('anikoto', true, normal)).toBe('anikoto')
    expect(providerForMedia('kaa', true, null)).toBe('kaa')
  })

  it('hides 18+ providers unless 18+ mode is on', () => {
    expect(streamingProviders(false).some((p) => p.value === 'hstream')).toBe(false)
    expect(streamingProviders(true).some((p) => p.value === 'hstream')).toBe(true)
  })
})
