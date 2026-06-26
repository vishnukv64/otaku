import { describe, expect, it } from 'vitest'
import { canSeekLocalDownload, getInitialPlaybackTime, shouldUseLocalDownload } from './downloadedPlayback'

describe('shouldUseLocalDownload', () => {
  it('keeps local HLS playlists even when the playlist file is small', () => {
    expect(shouldUseLocalDownload('/downloads/Episode_1.m3u8', 24_000)).toBe(true)
  })

  it('rejects tiny direct video files from old broken downloads', () => {
    expect(shouldUseLocalDownload('/downloads/Episode_1.otaku', 24_000)).toBe(false)
  })
})

describe('getInitialPlaybackTime', () => {
  it('starts legacy single-file TS downloads from the beginning', () => {
    expect(getInitialPlaybackTime(504, { isLegacyTsDownload: true })).toBe(0)
  })

  it('keeps resume time for normal local playback', () => {
    expect(getInitialPlaybackTime(504, { isLegacyTsDownload: false })).toBe(504)
  })
})

describe('canSeekLocalDownload', () => {
  it('disables seeking for legacy single-file TS downloads', () => {
    expect(canSeekLocalDownload({ isLegacyTsDownload: true })).toBe(false)
  })

  it('allows seeking for normal local playback', () => {
    expect(canSeekLocalDownload({ isLegacyTsDownload: false })).toBe(true)
  })
})
