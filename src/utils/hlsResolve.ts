import type { VideoSource } from '../types/extension'
import type { QualityPreference } from './pickSource'
import { proxyHlsPlaylist } from './tauri-commands'

export interface HlsVariant {
  url: string
  resolution: number
}

// Parse an HLS master playlist (m3u8 text) into its #EXT-X-STREAM-INF
// variants, resolving each relative URI against the master's base URL.
//
// We do a minimal text-level parse rather than pulling in a full m3u8
// library: only #EXT-X-STREAM-INF + the URI line following it matter,
// and the RESOLUTION=WxH attribute gives us the height. Anything without
// a parseable resolution is dropped (non-video media, audio-only, etc.).
export function parseHlsMaster(masterText: string, masterUrl: string): HlsVariant[] {
  const lines = masterText.split(/\r?\n/)
  const out: HlsVariant[] = []
  const baseUri = masterUrl.replace(/\/[^/]*$/, '/')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.startsWith('#EXT-X-STREAM-INF')) continue
    const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i)
    if (!resMatch) continue
    const height = Number.parseInt(resMatch[2]!, 10)
    if (!Number.isFinite(height) || height <= 0) continue
    let uri = (lines[i + 1] || '').trim()
    if (!uri || uri.startsWith('#')) continue
    if (!/^https?:\/\//i.test(uri)) {
      uri = new URL(uri, baseUri).toString()
    }
    out.push({ url: uri, resolution: height })
  }
  return out
}

// Pick the best variant from a parsed master playlist for a given
// preference. Mirrors the fallback chain in pickSource but operates on
// HlsVariant instead of VideoSource.
export function pickHlsVariant(
  variants: HlsVariant[],
  preferred: QualityPreference,
): HlsVariant | undefined {
  if (variants.length === 0) return undefined
  const sorted = [...variants].sort((a, b) => a.resolution - b.resolution)
  if (preferred === 'worst') return sorted[0]
  if (preferred === 'best' || preferred === 'Auto') return sorted[sorted.length - 1]
  const exact = sorted.find((v) => v.resolution === preferred)
  return exact ?? sorted[sorted.length - 1]
}

// Given an adaptive HLS VideoSource and a quality preference, fetch the
// master playlist (via the Rust video proxy so CORS and Referer are
// correctly handled), parse it, and return the concrete variant URL.
//
// Used by the download pipeline: saving the master .m3u8 would save a
// text file, not the video; we must resolve to a specific variant URL
// first. Returns the master URL unchanged if parsing fails (caller may
// still attempt the download, even if suboptimal).
export async function resolveAdaptiveToVariant(
  source: VideoSource,
  preferred: QualityPreference,
): Promise<{ url: string; resolution?: number }> {
  try {
    // proxyHlsPlaylist fetches the m3u8 server-side (handles CORS + Referer)
    // and returns text with segment URLs already rewritten to route through
    // the proxy. The STREAM-INF variant URIs inside stay as-is, which is
    // what we want (we're extracting the direct variant URLs).
    const text = await proxyHlsPlaylist(source.url)
    const variants = parseHlsMaster(text, source.url)
    const pick = pickHlsVariant(variants, preferred)
    if (pick) return { url: pick.url, resolution: pick.resolution }
  } catch (err) {
    console.warn('[hlsResolve] master parse failed, falling back to master URL', err)
  }
  return { url: source.url }
}
