import { describe, expect, it, vi } from 'vitest'
import { createAnikotoExtension } from './anikoto-extension'

function loadExtension(code: string, fetchImpl: (url: string) => string) {
  return new Function('__fetch', '__log', `${code}; return extensionObject;`)(
    fetchImpl,
    vi.fn(),
  ) as {
    search: (query: string, page: number) => unknown
    getDetails: (id: string) => unknown
    getSources: (episodeId: string) => unknown
  }
}

describe('Anikoto extension', () => {
  it('maps search, details, and watch responses into Otaku extension shapes', () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url.includes('/api/search?keyword=naruto')) {
        return JSON.stringify({
          status: 200,
          body: JSON.stringify({
            ok: true,
            data: {
              results: [{
                id: 'tip-1',
                slug: 'naruto-xyz',
                title: 'Naruto',
                image: 'https://img.test/naruto.jpg',
                type: 'TV',
                titleJp: 'Naruto JP',
                alternativeTitles: ['NARUTO'],
                episodes: { sub: 220, total: 220 },
                score: 8.1,
                date: '2002',
              }],
            },
          }),
        })
      }

      if (url.includes('/api/anime/naruto-xyz')) {
        return JSON.stringify({
          status: 200,
          body: JSON.stringify({
            ok: true,
            data: {
              id: 'anikoto-1',
              slug: 'naruto-xyz',
              title: 'Naruto',
              titleJp: 'Naruto JP',
              alternativeTitles: ['NARUTO'],
              image: 'https://img.test/naruto.jpg',
              synopsis: 'A ninja story.',
              type: 'TV',
              premiered: 'Fall 2002',
              status: 'Finished Airing',
              genres: ['Action'],
              malScore: 8.1,
              episodeCount: 220,
              episodes: {
                episodes: [
                  { number: '1', title: 'Enter Naruto', href: '/watch/naruto-xyz/ep-1' },
                  { number: '2', href: '/watch/naruto-xyz/ep-2' },
                ],
              },
            },
          }),
        })
      }

      if (url.includes('/api/watch/naruto-xyz?ep=1&stream=false')) {
        return JSON.stringify({
          status: 200,
          body: JSON.stringify({
            ok: true,
            data: {
              sources: [
                {
                  server: 'VidCloud-1',
                  type: 'sub',
                  m3u8: 'https://fxpy7.watching.onl/master.m3u8',
                  referer: 'https://vidwish.live/',
                  tracks: [{ file: 'https://subs.test/en.vtt', label: 'English' }],
                },
                {
                  server: 'HD-1',
                  type: 'sub',
                  m3u8: 'https://cdn.mewstream.buzz/master.m3u8',
                  referer: 'https://megaplay.buzz/',
                  tracks: [],
                },
              ],
            },
          }),
        })
      }

      throw new Error(`unexpected url: ${url}`)
    })

    const extension = loadExtension(createAnikotoExtension('https://anikoto-api.test'), fetchImpl)

    expect(extension.search('naruto', 1)).toEqual({
      results: [{
        id: 'naruto-xyz',
        title: 'Naruto',
        cover_url: 'https://img.test/naruto.jpg',
        year: 2002,
        rating: 8.1,
        available_episodes: 220,
        media_type: 'TV',
        genres: [],
        native_name: 'Naruto JP',
        title_synonyms: ['NARUTO'],
      }],
      has_next_page: false,
    })

    expect(extension.getDetails('naruto-xyz')).toMatchObject({
      id: 'naruto-xyz',
      title: 'Naruto',
      native_name: 'Naruto JP',
      title_synonyms: ['NARUTO'],
      cover_url: 'https://img.test/naruto.jpg',
      description: 'A ninja story.',
      genres: ['Action'],
      status: 'Finished Airing',
      year: 2002,
      rating: 8.1,
      episode_count: 220,
      episodes: [
        { id: 'naruto-xyz::1', number: 1, title: 'Enter Naruto' },
        { id: 'naruto-xyz::2', number: 2, title: 'Episode 2' },
      ],
    })

    expect(extension.getSources('naruto-xyz::1')).toEqual({
      sources: [{
        url: 'https://cdn.mewstream.buzz/master.m3u8',
        quality: 'Auto',
        type: 'hls',
        server: 'HD-1',
        referrer: 'https://megaplay.buzz/',
        audio_type: 'sub',
        subtitles: [],
      }, {
        url: 'https://fxpy7.watching.onl/master.m3u8',
        quality: 'Auto',
        type: 'hls',
        server: 'VidCloud-1',
        referrer: 'https://vidwish.live/',
        audio_type: 'sub',
        subtitles: [{
          url: 'https://subs.test/en.vtt',
          language: 'English',
          label: 'English',
        }],
      }],
      subtitles: [{
        url: 'https://subs.test/en.vtt',
        language: 'English',
        label: 'English',
      }],
    })
  })
})
