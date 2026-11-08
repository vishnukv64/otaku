import { describe, expect, it } from 'vitest'
import { audioModeLabel, audioSummary, countdownFromBroadcast, formatDateRange, nextBroadcastMs } from './providerExtras'

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
