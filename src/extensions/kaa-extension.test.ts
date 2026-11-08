import { describe, expect, it, vi } from 'vitest'
import { KAA_EXTENSION } from './kaa-extension'
import type { MediaDetails, SearchResults, VideoSources } from '@/types/extension'

type Fetch = (url: string, options: { method: string; body?: string }) => string

function loadExtension(fetchImpl: Fetch) {
  return new Function('__fetch', '__log', `${KAA_EXTENSION}; return extensionObject;`)(
    fetchImpl,
    vi.fn()
  ) as {
    search: (query: string, page: number) => SearchResults
    getDetails: (id: string) => MediaDetails
    getSources: (episodeId: string) => VideoSources
  }
}

const ok = (body: unknown) =>
  JSON.stringify({ status: 200, body: typeof body === 'string' ? body : JSON.stringify(body) })

// Two pages of episodes: 1-2 on the first, 3 on the second.
const pages = [
  { number: 1, eps: [1, 2] },
  { number: 2, eps: [3] },
]
const ep = (n: number) => ({ episode_number: n, episode_string: String(n), slug: `h${n}`, title: `E${n}` })

const playerHtml =
  '<astro-island props="{&quot;manifest&quot;:[0,&quot;//bl.cdn.test/playlist/abc123/master.m3u8&quot;],&quot;subtitles&quot;:[1,[[0,{&quot;language&quot;:[0,&quot;en&quot;],&quot;name&quot;:[0,&quot;English&quot;],&quot;src&quot;:[0,&quot;https://subst.test/en.vtt&quot;]}]]]}">'

function fakeKaa(): Fetch {
  return (url, options) => {
    if (url.endsWith('/api/fsearch')) {
      expect(options.method).toBe('POST')
      expect(JSON.parse(options.body!)).toEqual({ page: 1, query: 'frieren' })
      return ok({
        maxPage: 1,
        result: [{
          slug: 'frieren-1',
          title: 'Sousou no Frieren',
          title_en: 'Frieren',
          type: 'tv',
          year: 2023,
          episode_count: 3,
          genres: ['Fantasy'],
          poster: { hq: 'frieren-hq' },
        }],
      })
    }
    if (url.endsWith('/frieren-1/episodes?lang=ja-JP&ep=1')) return ok({ pages, result: [ep(1), ep(2)] })
    if (url.endsWith('/frieren-1/episodes?lang=ja-JP&ep=3')) return ok({ pages, result: [ep(3)] })
    if (url.endsWith('/api/show/frieren-1')) return ok({ title: 'Sousou no Frieren', title_en: 'Frieren', type: 'tv', rating: 'PG-13', locales: ['ja-JP', 'en-US'], banner: { hq: 'b-hq' }, start_date: '2023-09-29T00:00:00.000Z' })
    if (url.endsWith('/frieren-1/episodes?lang=en-US&ep=1')) return ok({ pages: [{ number: 1, eps: [3] }], result: [{ ...ep(3), slug: 'd3' }] })
    if (url.endsWith('/api/show/frieren-1/episode/ep-3-d3')) return ok({ episode_synopsis: 'dub syn', servers: [{ name: 'VidStreaming', src: 'https://player.test/cat-player/player?id=abc123&ln=en-US' }] })
    if (url.endsWith('/api/show/frieren-1/episode/ep-3-h3')) {
      return ok({
        episode_synopsis: 'syn',
        broadcast_day: 'friday',
        broadcast_time: '14:00',
        servers: [
          { name: 'VidStreaming', src: 'https://player.test/cat-player/player?id=abc123&ln=ja-JP' },
          { name: 'BirdStream', src: 'https://player.test/cat-player/player?id=zzz&type=dash' },
        ],
      })
    }
    if (url.startsWith('https://player.test/cat-player/player?id=abc123')) return ok(playerHtml)
    if (url.includes('/movie-1/episodes')) return ok({ pages: [], result: [] })
    if (url.endsWith('/api/show/movie-1')) return ok({ title: 'Movie', watch_uri: '/movie-1/ep-0-abc9' })
    if (url.endsWith('/api/show/movie-1/episode/ep-0-abc9')) {
      return ok({ servers: [{ name: 'VidStreaming', src: 'https://player.test/x?id=mov' }] })
    }
    if (url.startsWith('https://player.test/x?id=mov')) {
      return ok('{&quot;manifest&quot;:[0,&quot;https://hls.test/manifest/mov/master.m3u8&quot;]}')
    }
    return JSON.stringify({ status: 404, body: '' })
  }
}

describe('KAA extension', () => {
  it('maps search results', () => {
    const { results, has_next_page } = loadExtension(fakeKaa()).search('frieren', 1)
    expect(has_next_page).toBe(false)
    expect(results[0]).toMatchObject({
      id: 'frieren-1',
      title: 'Sousou no Frieren',
      cover_url: 'https://kaa.lt/image/poster/frieren-hq.webp',
      available_episodes: 3,
      title_synonyms: ['Frieren'],
    })
  })

  it('collects episodes across every page', () => {
    const details = loadExtension(fakeKaa()).getDetails('frieren-1')
    expect(details.episodes.map((e) => e.id)).toEqual([
      'frieren-1::1',
      'frieren-1::2',
      'frieren-1::3',
    ])
  })

  it('reads subtitle tracks whose fields vary (older episodes add format/filename/source)', () => {
    const html =
      '<astro-island props="{&quot;manifest&quot;:[0,&quot;//bl.cdn.test/m.m3u8&quot;],&quot;subtitles&quot;:[1,[' +
      '[0,{&quot;format&quot;:[0,&quot;srt&quot;],&quot;language&quot;:[0,&quot;en&quot;],&quot;filename&quot;:[0,&quot;x_en.srt&quot;],&quot;name&quot;:[0,&quot;English&quot;],&quot;source&quot;:[0,&quot;bilibili&quot;],&quot;src&quot;:[0,&quot;https://subs.test/x_en.srt&quot;]}],' +
      '[0,{&quot;language&quot;:[0,&quot;th&quot;],&quot;name&quot;:[0,&quot;Thai&quot;],&quot;src&quot;:[0,&quot;//subs.test/th.vtt&quot;]}]' +
      ']],&quot;thumbnails&quot;:[0,&quot;https://subst.test/p.vtt&quot;]}">'
    const ext = loadExtension((() => JSON.stringify({ status: 200, body: html })) as never) as unknown as {
      player: (url: string) => { subtitles: unknown[] }
    }
    expect(ext.player('https://player.test/x').subtitles).toEqual([
      { url: 'https://subs.test/x_en.srt', language: 'en', label: 'English' },
      { url: 'https://subs.test/th.vtt', language: 'th', label: 'Thai' },
    ])
  })

  it('resolves an episode on a later page to an HLS manifest with subtitles, skipping DASH', () => {
    const { sources, subtitles } = loadExtension(fakeKaa()).getSources('frieren-1::3')
    expect(sources).toEqual([
      expect.objectContaining({
        url: 'https://bl.cdn.test/playlist/abc123/master.m3u8',
        type: 'hls',
        server: 'VidStreaming',
        referrer: 'https://krussdomi.com/',
        audio_type: 'sub',
        audio_locale: 'ja-JP',
        episode_synopsis: 'syn',
      }),
      expect.objectContaining({ audio_type: 'dub', audio_locale: 'en-US', episode_synopsis: 'dub syn' }),
    ])
    expect(subtitles).toEqual([{ url: 'https://subst.test/en.vtt', language: 'en', label: 'English' }])
  })

  it('fills age rating, audio locales, banner, dates and broadcast slot', () => {
    expect(loadExtension(fakeKaa()).getDetails('frieren-1')).toMatchObject({
      age_rating: 'PG-13',
      audio_locales: ['ja-JP', 'en-US'],
      banner_url: 'https://kaa.lt/image/banner/b-hq.webp',
      start_date: '2023-09-29T00:00:00.000Z',
      broadcast: { day: 'friday', time: '14:00' },
    })
  })

  it('falls back to watch_uri for movies without an episode list', () => {
    const ext = loadExtension(fakeKaa())
    expect(ext.getDetails('movie-1').episodes).toHaveLength(1)
    expect(ext.getSources('movie-1::1').sources[0].url).toBe(
      'https://hls.test/manifest/mov/master.m3u8'
    )
  })

  it('returns no sources instead of throwing when KAA errors', () => {
    expect(loadExtension(fakeKaa()).getSources('missing::1')).toEqual({ sources: [], subtitles: [] })
  })
})
