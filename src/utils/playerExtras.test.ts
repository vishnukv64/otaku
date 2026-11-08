import { describe, expect, it } from 'vitest'
import { mapSkipResults } from './aniskip'
import { findSpriteCue, parseSpriteVtt } from './previewVtt'

describe('mapSkipResults', () => {
  it('maps and sorts known types, drops unknown/invalid', () => {
    const r = mapSkipResults({
      found: true,
      results: [
        { interval: { startTime: 1460, endTime: 1560 }, skipType: 'ed' },
        { interval: { startTime: 3.2, endTime: 93.2 }, skipType: 'op' },
        { interval: { startTime: 5, endTime: 6 }, skipType: 'weird' },
        { interval: { startTime: 9, endTime: 9 }, skipType: 'recap' },
      ],
    })
    expect(r).toEqual([
      { start: 3.2, end: 93.2, label: 'Skip Intro' },
      { start: 1460, end: 1560, label: 'Skip Outro' },
    ])
  })
  it('returns [] when not found', () => {
    expect(mapSkipResults({ found: false })).toEqual([])
    expect(mapSkipResults(null)).toEqual([])
  })
})

describe('parseSpriteVtt', () => {
  const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:05.000\np-01.jpg#xywh=0,0,320,180\n\n00:00:05.000 --> 00:01:10.500\np-01.jpg#xywh=320,0,320,180\n`
  const cues = parseSpriteVtt(vtt, 'https://h.test/id/preview.vtt')
  it('parses cues and resolves relative urls', () => {
    expect(cues).toHaveLength(2)
    expect(cues[1]).toMatchObject({ start: 5, end: 70.5, url: 'https://h.test/id/p-01.jpg', x: 320, w: 320, h: 180 })
  })
  it('finds the cue for a time, clamping past the end', () => {
    expect(findSpriteCue(cues, 2)?.x).toBe(0)
    expect(findSpriteCue(cues, 999)?.x).toBe(320)
  })
})
