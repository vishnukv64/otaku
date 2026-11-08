import { describe, expect, it } from 'vitest'
import { audioModeLabel, audioSummary, countdownFromBroadcast, formatDateRange, nextBroadcastMs, withProviderEpisodes } from './providerExtras'

describe('providerExtras', () => {
  const fri = Date.UTC(2025, 0, 3, 10, 0) // Friday 10:00 UTC
  it('next broadcast is the same day when still ahead, else next week', () => {
    expect(nextBroadcastMs('friday', '14:00', fri)).toBe(Date.UTC(2025, 0, 3, 14, 0))
    expect(nextBroadcastMs('friday', '09:00', fri)).toBe(Date.UTC(2025, 0, 10, 9, 0))
    expect(nextBroadcastMs('sunday', '23:15', fri)).toBe(Date.UTC(2025, 0, 5, 23, 15))
    expect(nextBroadcastMs('nope', '14:00', fri)).toBeNull()
  })
  it('countdown inputs reproduce the next slot', () => {
    const c = countdownFromBroadcast({ day: 'friday', time: '14:00' }, fri)!
    expect(new Date(c.lastUpdateEnd).getTime() + c.broadcastInterval).toBe(Date.UTC(2025, 0, 3, 14, 0))
  })
  it('labels audio locales', () => {
    expect(audioSummary(['ja-JP', 'en-US', 'es-ES'])).toBe('Sub: Japanese · Dub: English, European Spanish')
    expect(audioModeLabel('sub')).toBe('SUB')
    expect(audioModeLabel('en-US')).toBe('English (Dub)')
    expect(audioModeLabel('ja-JP')).toBe('Japanese (Sub)')
    expect(audioSummary(undefined)).toBe('')
  })
  it('formats date ranges', () => {
    expect(formatDateRange('2023-09-29T00:00:00.000Z', '2024-03-22T00:00:00.000Z')).toBe('Sep 29, 2023 – Mar 22, 2024')
    expect(formatDateRange('2023-09-29T00:00:00.000Z')).toBe('Sep 29, 2023 – ?')
    expect(formatDateRange()).toBe('')
  })
})

describe('withProviderEpisodes', () => {
  const base = [
    { id: 'a1', number: 1, title: 'Episode 1' },
    { id: 'a2', number: 2, title: 'The Real Name', thumbnail: 'mal.jpg' },
    { id: 'a3', number: 3 },
  ]
  const provider = [
    { id: 'k1', number: 1, title: 'Arrival', thumbnail: 'k1.webp', duration: 1440 },
    { id: 'k2', number: 2, title: 'Other Name', thumbnail: 'k2.webp' },
    { id: 'k3', number: 3, title: 'Episode 3', thumbnail: 'k3.webp' },
  ]

  it('fills stills, generic titles and runtimes by number; ours wins otherwise', () => {
    const out = withProviderEpisodes(base, provider)
    expect(out[0]).toEqual({ id: 'a1', number: 1, title: 'Arrival', thumbnail: 'k1.webp', duration: 1440 })
    expect(out[1].title).toBe('The Real Name')
    expect(out[1].thumbnail).toBe('mal.jpg')
    expect(out[2].title).toBeUndefined() // provider title is generic too
    expect(out[2].thumbnail).toBe('k3.webp')
    expect(out.map((e) => e.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('returns the base list untouched without provider data', () => {
    expect(withProviderEpisodes(base, null)).toBe(base)
  })
})
