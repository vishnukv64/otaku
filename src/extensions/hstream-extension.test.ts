import { describe, expect, it, vi } from 'vitest'
import { HSTREAM_EXTENSION } from './hstream-extension'
import type { MediaDetails, SearchResults, VideoSources } from '@/types/extension'

type Fetch = (url: string, options: { method: string; headers?: Record<string, string>; body?: string }) => string

function loadExtension(fetchImpl: Fetch) {
  return new Function('__fetch', '__log', `${HSTREAM_EXTENSION}; return extensionObject;`)(
    fetchImpl,
    vi.fn()
  ) as {
    search: (query: string, page: number) => SearchResults
    getDetails: (id: string) => MediaDetails
    getSources: (episodeId: string) => VideoSources
  }
}

const card = (slug: string, n: number) => `
  <a
    href="https://hstream.moe/hentai/${slug}-${n}"
    class="block"
  >
    <img
      src="/images/hentai/${slug}/gallery-ep-${n}-0-thumbnail.webp"
      alt="Over &amp; Flow - ${n}"
      loading="lazy"
    />
  </a>`
const searchHtml = (next: boolean) =>
  [card('overflow', 2), card('overflow', 1), card('other-show', 1), next ? '<a href="?page=2">2</a>' : ''].join('')

const reply = (body: string, set_cookie: string[] = []) => JSON.stringify({ status: 200, body, set_cookie })

function fakeSite(): Fetch & { calls: string[] } {
  const calls: string[] = []
  const fn = ((url, options) => {
    calls.push(`${options.method} ${url}`)
    if (url.includes('/search?')) return reply(searchHtml(false))
    if (url.endsWith('/hentai/overflow-1')) {
      return reply(
        '<meta property="og:description" content="A &quot;story&quot;" /><meta property="og:image" content="https://x/i.webp" /><input id="e_id" type="hidden" value="79" />',
        ['XSRF-TOKEN=abc%3D%3D; path=/; samesite=lax', 'hstream_session=sess1; path=/; httponly']
      )
    }
    if (url.endsWith('/player/api')) {
      expect(options.method).toBe('POST')
      expect(JSON.parse(options.body!)).toEqual({ episode_id: '79' })
      expect(options.headers!['X-XSRF-TOKEN']).toBe('abc==')
      expect(options.headers!['Cookie']).toBe('XSRF-TOKEN=abc%3D%3D; hstream_session=sess1')
      expect(options.headers!['Referer']).toBe('https://hstream.moe/hentai/overflow-1')
      return reply(JSON.stringify({ stream_url: '2021/Overflow/E01', stream_domains: ['https://dead.test', 'https://cdn.test/'], extra_subtitles: [] }))
    }
    if (url.startsWith('https://dead.test')) return JSON.stringify({ status: 503, body: '' })
    if (url.endsWith('/manifest.mpd')) return JSON.stringify({ status: 200, body: '<MPD/>' })
    throw new Error('unexpected ' + url)
  }) as Fetch & { calls: string[] }
  fn.calls = calls
  return fn
}

describe('hstream extension', () => {
  it('search groups episode cards into series', () => {
    const res = loadExtension(fakeSite()).search('overflow', 1)
    expect(res.results.map((r) => [r.id, r.title, r.available_episodes])).toEqual([
      ['overflow', 'Over & Flow', 2],
      ['other-show', 'Over & Flow', 1],
    ])
    expect(res.results[0].cover_url).toBe('https://hstream.moe/images/hentai/overflow/gallery-ep-2-0-thumbnail.webp')
    expect(res.has_next_page).toBe(false)
  })

  it('getDetails lists only that series, in order', () => {
    const d = loadExtension(fakeSite()).getDetails('overflow')
    expect(d.episodes.map((e) => e.id)).toEqual(['overflow::1', 'overflow::2'])
    expect(d.description).toBe('A "story"')
  })

  it('getSources posts with session cookies and returns 1080 + 720 DASH from a live mirror', () => {
    const { sources } = loadExtension(fakeSite()).getSources('overflow::1')
    expect(sources.map((s) => [s.quality, s.resolution, s.type])).toEqual([
      ['1080p', 1080, 'dash'],
      ['720p', 720, 'dash'],
    ])
    expect(sources[0].url).toBe('https://cdn.test/2021/Overflow/E01/1080/manifest.mpd')
    expect(sources[0].referrer).toBe('https://hstream.moe/')
  })

  it('getSources returns empty on a malformed id or failure', () => {
    const ext = loadExtension(() => {
      throw new Error('boom')
    })
    expect(ext.getSources('nope').sources).toEqual([])
    expect(ext.getSources('a::1').sources).toEqual([])
  })
})
