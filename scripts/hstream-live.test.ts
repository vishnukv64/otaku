import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { HSTREAM_EXTENSION } from '../src/extensions/hstream-extension'

type Fetch = (url: string, options: { method: string; headers?: Record<string, string>; body?: string }) => string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ext = any

function loadExtension(fetchImpl: Fetch): Ext {
  return new Function('__fetch', '__log', `${HSTREAM_EXTENSION}; return extensionObject;`)(fetchImpl, vi.fn())
}

// HSTREAM_LIVE=1 pnpm exec vitest run scripts/hstream-live.test.ts
describe.skipIf(!process.env.HSTREAM_LIVE)('hstream live', () => {
  const curl = (args: string[]) => execFileSync('curl', ['-s', '-A', 'Mozilla/5.0', ...args], { maxBuffer: 20e6 })
  const liveFetch: Fetch = (url, o) => {
    const h = Object.entries(o.headers ?? {}).flatMap(([k, v]) => ['-H', `${k}: ${v}`])
    const out = curl(['-D', '-', '-w', '\nSTATUS:%{http_code}', ...h, ...(o.body ? ['-d', o.body] : []), url]).toString()
    const status = Number(out.slice(out.lastIndexOf('STATUS:') + 7))
    const [head, ...rest] = out.slice(0, out.lastIndexOf('\nSTATUS:')).split(/\r?\n\r?\n/)
    const set_cookie = head.split(/\r?\n/).filter((l: string) => /^set-cookie:/i.test(l)).map((l: string) => l.replace(/^set-cookie:\s*/i, ''))
    return JSON.stringify({ status, body: rest.join('\n\n'), set_cookie })
  }

  it('search -> episodes -> sources -> manifest + first segment return 200', () => {
    const ext = loadExtension(liveFetch)
    const hit = ext.search('overflow', 1).results.find((r: { id: string }) => r.id === 'overflow')!
    expect(hit).toBeTruthy()
    const details = ext.getDetails(hit.id)
    expect(details.episodes.length).toBeGreaterThan(1)
    const { sources } = ext.getSources(details.episodes[0].id)
    expect(sources.map((s: { resolution: number }) => s.resolution)).toEqual([1080, 720])
    const base = sources[0].url.replace('manifest.mpd', '')
    const hdr = ['-H', `Referer: ${sources[0].referrer}`, '-H', 'Origin: https://hstream.moe']
    const code = (u: string, r?: string[]) => curl([...hdr, ...(r ?? []), '-o', '/dev/null', '-w', '%{http_code}', u]).toString()
    expect(code(sources[0].url)).toBe('200')
    expect(code(base + 'chunks/init-stream0.webp', ['-r', '0-15'])).toMatch(/^20[06]$/)
    expect(code(base + 'chunks/chunk-stream0-00001.webp', ['-r', '0-15'])).toMatch(/^20[06]$/)
  }, 60000)
})
