import { describe, expect, it } from 'vitest'
import {
  audioTabForChoice,
  choicesForAudioTab,
  findMatchingSubtitle,
  type DownloadSourceChoice,
} from './downloadOptions'

function choice(key: string, audioType?: string): DownloadSourceChoice {
  return {
    key,
    source: {
      url: `https://example.test/${key}`,
      type: 'hls',
      quality: '1080p',
      server: 'Default',
    },
    audioType,
    server: 'Default',
    quality: '1080p',
    subtitles: [],
  }
}

describe('download audio tabs', () => {
  it('keeps dubbed sources in the dub tab and all other sources in the sub tab', () => {
    const sub = choice('subbed', 'subbed')
    const dub = choice('dubbed', 'dubbed')
    const hsub = choice('hsub', 'hsub')
    const unknown = choice('unknown')

    expect(audioTabForChoice(sub)).toBe('sub')
    expect(audioTabForChoice(dub)).toBe('dub')
    expect(audioTabForChoice(hsub)).toBe('sub')
    expect(audioTabForChoice(unknown)).toBe('sub')

    expect(choicesForAudioTab([sub, dub, hsub, unknown], 'sub').map((item) => item.key)).toEqual([
      'subbed',
      'hsub',
      'unknown',
    ])
    expect(choicesForAudioTab([sub, dub, hsub, unknown], 'dub').map((item) => item.key)).toEqual([
      'dubbed',
    ])
  })
})

describe('subtitle matching', () => {
  it('matches selected bulk subtitle across episode-specific labels and language variants', () => {
    const target = {
      url: 'https://episode-1.test/en.vtt',
      label: 'English',
      language: 'en',
    }

    expect(findMatchingSubtitle([
      {
        url: 'https://episode-2.test/en-us.vtt',
        label: 'English CC',
        language: 'en-US',
      },
    ], target)?.url).toBe('https://episode-2.test/en-us.vtt')
  })
})
