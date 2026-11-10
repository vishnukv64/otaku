import { describe, expect, it } from 'vitest'
import { providerForMedia, streamingProviders } from './streamingProviders'

describe('providerForMedia', () => {
  const restricted = { restricted: true }
  const regular = { restricted: false }

  it('routes restricted titles to hstream only while the extended catalog is on', () => {
    expect(providerForMedia('kaa', true, restricted)).toBe('hstream')
    expect(providerForMedia('kaa', false, restricted)).toBe('kaa')
  })

  it('keeps the user pick for everything else, including before details load', () => {
    expect(providerForMedia('anikoto', true, regular)).toBe('anikoto')
    expect(providerForMedia('kaa', true, {})).toBe('kaa')
    expect(providerForMedia('kaa', true, null)).toBe('kaa')
  })

  it('hides extended-catalog providers unless that setting is on', () => {
    expect(streamingProviders(false).some((p) => p.value === 'hstream')).toBe(false)
    expect(streamingProviders(true).some((p) => p.value === 'hstream')).toBe(true)
  })
})
