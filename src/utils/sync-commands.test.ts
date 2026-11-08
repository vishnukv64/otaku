import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { formatSynced, isPairPayload, syncLabel } from './sync-commands'

describe('sync-commands helpers', () => {
  it('labels each state', () => {
    expect(syncLabel({ state: 'idle', queued: 0, devices: [] })).toBe('Not paired')
    expect(syncLabel({ state: 'syncing', queued: 1, devices: [] })).toBe('Syncing · 1 change')
    expect(syncLabel({ state: 'offline', queued: 3, devices: [] })).toBe('3 queued')
    expect(syncLabel({ state: 'offline', queued: 0, devices: [] })).toBe('Offline')
  })

  it('recognises only otaku pairing payloads', () => {
    expect(isPairPayload(' otaku://pair?l=x ')).toBe(true)
    expect(isPairPayload('https://example.com')).toBe(false)
  })

  it('formats last synced', () => {
    const now = new Date('2026-01-01T10:00:00Z')
    expect(formatSynced(null, now)).toBe('Never')
    expect(formatSynced('2026-01-01 09:58:00', now)).toBe('2 min ago')
    expect(formatSynced('2026-01-01 10:00:00', now)).toBe('just now')
  })
})
