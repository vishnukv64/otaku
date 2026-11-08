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

describe('attachDash ordering', () => {
  it('waits for the previous player to finish tearing down before attaching a new one', async () => {
    const { vi } = await import('vitest')
    const events: string[] = []
    let n = 0
    vi.doMock('shaka-player', () => ({
      default: {
        polyfill: { installAll: () => {} },
        Player: class {
          id = ++n
          attach = async () => { events.push(`attach${this.id}`) }
          load = async () => {}
          getNetworkingEngine = () => ({ registerRequestFilter: () => {}, registerResponseFilter: () => {} })
          destroy = () => new Promise<void>((r) => setTimeout(() => { events.push(`destroyed${this.id}`); r() }, 20))
        },
      },
    }))
    vi.resetModules()
    const { attachDash } = await import('./dashPlayer')
    const video = {} as HTMLVideoElement
    const first = await attachDash(video, mpd, { videoServer: server })
    void first.destroy() // callers don't await
    await attachDash(video, mpd, { videoServer: server })
    expect(events).toEqual(['attach1', 'destroyed1', 'attach2'])
    vi.doUnmock('shaka-player')
  })
})
