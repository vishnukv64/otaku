import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { HAHO_EXTENSION } from '../src/extensions/haho-extension'

type Ext = {
  search: (q: string, page: number) => { results: { id: string }[] }
  getDetails: (id: string) => { episodes: { id: string }[] }
  getSources: (id: string) => { sources: { url: string; referrer: string; quality: string; type: string }[] }
}

// HAHO_LIVE=1 pnpm exec vitest run scripts/haho-live.test.ts
describe.skipIf(!process.env.HAHO_LIVE)('haho live', () => {
  const curl = (args: string[]) => execFileSync('curl', ['-s', '-A', 'Mozilla/5.0', ...args], { maxBuffer: 20e6 })
  const liveFetch = (url: string, o: { headers?: Record<string, string> }) => {
    const h = Object.entries(o.headers ?? {}).flatMap(([k, v]) => ['-H', `${k}: ${v}`])
    const out = curl(['-w', '\nSTATUS:%{http_code}', ...h, url]).toString()
    const i = out.lastIndexOf('\nSTATUS:')
    return JSON.stringify({ status: Number(out.slice(i + 8)), body: out.slice(0, i) })
  }
  const ext: Ext = new Function('__fetch', '__log', `${HAHO_EXTENSION}; return extensionObject;`)(liveFetch, vi.fn())

  // MAL 49335, title as a neutral search term
  it('search -> details -> sources -> ranged GET answers 200/206', () => {
    const hit = ext.search('torokase', 1).results.find((r) => r.id === 'h99abcb0')
    expect(hit).toBeTruthy()
    const details = ext.getDetails(hit!.id)
    expect(details.episodes.length).toBe(1)
    const { sources } = ext.getSources(details.episodes[0].id)
    expect(sources.length).toBeGreaterThan(0)
    const code = curl(['-H', `Referer: ${sources[0].referrer}`, '-r', '0-15', '-o', '/dev/null', '-w', '%{http_code}', sources[0].url]).toString()
    console.log('haho source', sources[0].quality, sources[0].type, 'ranged GET ->', code)
    expect(code).toMatch(/^20[06]$/)
  }, 60000)
})
