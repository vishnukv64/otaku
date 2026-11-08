import { describe, expect, it } from 'vitest'
import { proxyUri, upstreamUri } from './dashPlayer'

const server = { proxy_base_url: 'http://127.0.0.1:4321/proxy', token: 'tok' }
const mpd = 'https://cdn.test/2021/Show/E01/720/manifest.mpd'

describe('dash proxy URIs', () => {
  it('round-trips: segments resolve against the upstream manifest, not the proxy', () => {
    const proxied = proxyUri(server, mpd, 'https://hstream.moe/')
    expect(proxied.startsWith(server.proxy_base_url)).toBe(true)
    const base = upstreamUri(server, proxied)
    expect(base).toBe(mpd)
    // What shaka does with a relative SegmentTemplate path:
    expect(new URL('chunks/init-stream0.webp', base).href).toBe('https://cdn.test/2021/Show/E01/720/chunks/init-stream0.webp')
  })

  it('leaves non-proxy URIs alone', () => {
    expect(upstreamUri(server, mpd)).toBe(mpd)
  })
})
