import { describe, expect, it, vi } from 'vitest'
import { HAHO_EXTENSION } from './haho-extension'
import type { MediaDetails, SearchResults, VideoSources } from '@/types/extension'

type Fetch = (url: string, options: { method: string; headers?: Record<string, string> }) => string

function loadExtension(fetchImpl: Fetch) {
  return new Function('__fetch', '__log', `${HAHO_EXTENSION}; return extensionObject;`)(
    fetchImpl,
    vi.fn()
  ) as {
    search: (query: string, page: number) => SearchResults
    getDetails: (id: string) => MediaDetails
    getSources: (episodeId: string) => VideoSources
  }
}

const ok = (body: string) => JSON.stringify({ status: 200, body })

const searchHtml = `
  <ul class="loop anime-loop list">
    <li class="anime-1"><a href="https://haho.moe/anime/abc12345" data-toggle="popover" title="Sample &amp; Show" rel="bookmark">
      <img class="image" src="https://haho.moe/images/anime/a.jpg" alt="Sample"></a></li>
    <li class="anime-2"><a href="https://haho.moe/anime/zzz99999" title="Other Show" rel="bookmark">
      <img class="image" src="https://haho.moe/images/anime/b.jpg" alt="Other"></a></li>
    <a href="https://haho.moe/anime/abc12345">dup without img</a>
  </ul><a href="?page=2">2</a>`
const detailsHtml = `
  <meta property="og:image" content="https://haho.moe/images/anime/a.jpg" />
  <meta property="og:description" content="A sample." />
  <h1 class="mb-3">Sample &amp; Show</h1>
  <a href="https://haho.moe/anime/abc12345/2">Episode 2</a>
  <a href="https://haho.moe/anime/abc12345/1">Episode 1</a>
  <a href="https://haho.moe/anime/abc12345/1">Episode 1 again</a>
  <a href="https://haho.moe/anime/other000/7">not ours</a>`
const pageHtml = '<iframe src="https://haho.moe/embed?v=tok1" allowfullscreen ></iframe>'
const embedHtml = `
  <source src="https://s1.example.test/f1?download_token=aa&amp;x=1" title="480p" type="video/mp4">
  <source src="https://example.test/watch/f2" title="360p" type="video/mp4">`

function fakeSite(): Fetch & { calls: { url: string; referer?: string }[] } {
  const calls: { url: string; referer?: string }[] = []
  const fn = ((url, options) => {
    calls.push({ url, referer: options.headers?.Referer })
    if (url.includes('/anime?q=')) return ok(searchHtml)
    if (url.endsWith('/anime/abc12345')) return ok(detailsHtml)
    if (url.endsWith('/anime/abc12345/1')) return ok(pageHtml)
    if (url.includes('/embed?v=tok1')) return ok(embedHtml)
    return JSON.stringify({ status: 404, body: '' })
  }) as Fetch & { calls: typeof calls }
  fn.calls = calls
  return fn
}

describe('haho extension', () => {
  it('search returns unique series with decoded titles and paging', () => {
    const res = loadExtension(fakeSite()).search('sample', 1)
    expect(res.results.map((r) => [r.id, r.title])).toEqual([
      ['abc12345', 'Sample & Show'],
      ['zzz99999', 'Other Show'],
    ])
    expect(res.has_next_page).toBe(true)
  })

  it('getDetails lists this series episodes in order', () => {
    const d = loadExtension(fakeSite()).getDetails('abc12345')
    expect(d.title).toBe('Sample & Show')
    expect(d.episodes.map((e) => e.id)).toEqual(['abc12345::1', 'abc12345::2'])
  })

  it('getSources returns only direct mp4 files, with the site referrer', () => {
    const site = fakeSite()
    const { sources } = loadExtension(site).getSources('abc12345::1')
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      url: 'https://s1.example.test/f1?download_token=aa&x=1',
      type: 'mp4',
      quality: '480p',
      referrer: 'https://haho.moe/',
    })
    expect(site.calls.find((c) => c.url.includes('/embed'))?.referer).toBe('https://haho.moe/anime/abc12345/1')
  })

  it('getSources is empty on a bad id or a failing site', () => {
    const ext = loadExtension(() => JSON.stringify({ status: 500, body: '' }))
    expect(ext.getSources('nope').sources).toEqual([])
    expect(ext.getSources('abc12345::1').sources).toEqual([])
  })
})
