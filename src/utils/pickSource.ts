import type { VideoSource } from '../types/extension'

export type QualityPreference = 'Auto' | 'best' | 'worst' | number

// Sort sources low-to-high resolution. Unknown resolution (adaptive HLS)
// gets treated as "best" (Infinity) so it sorts to the end and wins "best"
// selection for its server. This matches anipy-cli's principle of
// preferring the most capable stream when ambiguous.
//
// Secondary tiebreaker: presence of subtitles (+0.5) so a subtitled
// variant beats an identical-resolution one without subs.
function sourceScore(s: VideoSource): number {
  const r = s.resolution ?? Number.POSITIVE_INFINITY
  const subBonus = s.subtitles && s.subtitles.length > 0 ? 0.5 : 0
  return r + subBonus
}

export function sortByResolution(sources: VideoSource[]): VideoSource[] {
  return [...sources].sort((a, b) => sourceScore(a) - sourceScore(b))
}

export function uniqueServers(sources: VideoSource[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of sources) {
    if (!seen.has(s.server)) {
      seen.add(s.server)
      out.push(s.server)
    }
  }
  return out
}

export function sourcesForServer(sources: VideoSource[], server: string): VideoSource[] {
  return sources.filter((s) => s.server === server)
}

// Return the numeric resolutions available for a given server, sorted
// high-to-low. Excludes adaptive HLS sources (no concrete resolution).
export function resolutionsForServer(sources: VideoSource[], server: string): number[] {
  const res = new Set<number>()
  for (const s of sources) {
    if (s.server === server && typeof s.resolution === 'number') res.add(s.resolution)
  }
  return [...res].sort((a, b) => b - a)
}

export function isAdaptive(source: VideoSource): boolean {
  return source.resolution === undefined && source.type === 'hls'
}

// Pick the best VideoSource for a given server + preferred quality.
//
// Semantics (mirrors anipy-cli's `Anime.get_video` fallback chain):
//   'Auto'  -> if the server exposes an adaptive HLS source, prefer it;
//              else pick the highest concrete resolution for that server.
//   'best'  -> highest concrete resolution on that server; falls through
//              to adaptive if no concrete variants exist.
//   'worst' -> lowest concrete resolution on that server.
//   <num>   -> exact resolution match; if missing, fall back to 'best'.
//
// Returns undefined only if the server has no sources at all.
export function pickSource(
  sources: VideoSource[],
  server: string,
  preferred: QualityPreference,
): VideoSource | undefined {
  const forServer = sourcesForServer(sources, server)
  if (forServer.length === 0) return undefined

  const sorted = sortByResolution(forServer)
  const adaptive = forServer.find(isAdaptive)
  const concrete = sorted.filter((s) => typeof s.resolution === 'number')

  if (preferred === 'Auto') {
    return adaptive ?? concrete[concrete.length - 1] ?? sorted[sorted.length - 1]
  }
  if (preferred === 'best') {
    return concrete[concrete.length - 1] ?? adaptive ?? sorted[sorted.length - 1]
  }
  if (preferred === 'worst') {
    return concrete[0] ?? adaptive ?? sorted[0]
  }

  const exact = concrete.find((s) => s.resolution === preferred)
  if (exact) return exact
  return concrete[concrete.length - 1] ?? adaptive ?? sorted[sorted.length - 1]
}

// Parse legacy preferredQuality strings ('Auto', '720p', etc.) into the
// typed preference used by pickSource. Used once on store init to migrate
// values persisted before v1.3.0.
export function parseQualityPreference(value: unknown): QualityPreference {
  if (value === 'Auto' || value === 'best' || value === 'worst') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const m = value.match(/^(\d+)p?$/i)
    if (m) {
      const n = Number.parseInt(m[1]!, 10)
      if (Number.isFinite(n)) return n
    }
  }
  return 'Auto'
}

// Human label for a VideoSource. Used only for UI display; never feed
// this back into selection logic.
export function qualityLabel(source: VideoSource): string {
  if (typeof source.resolution === 'number') return `${source.resolution}p`
  if (source.quality && source.quality !== 'Auto' && source.quality !== '') return source.quality
  return 'Auto'
}
