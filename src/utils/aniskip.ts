export interface SkipInterval {
  start: number
  end: number
  label: string
}

const LABELS: Record<string, string> = {
  op: 'Skip Intro',
  'mixed-op': 'Skip Intro',
  ed: 'Skip Outro',
  'mixed-ed': 'Skip Outro',
  recap: 'Skip Recap',
}

/** Map an AniSkip v2 response to sorted skip intervals (unknown types dropped). */
export function mapSkipResults(json: unknown): SkipInterval[] {
  const results = (json as { found?: boolean; results?: unknown[] } | null)?.results
  if (!Array.isArray(results)) return []
  const out: SkipInterval[] = []
  for (const r of results as Array<{ interval?: { startTime?: number; endTime?: number }; skipType?: string }>) {
    const label = LABELS[r.skipType ?? '']
    const start = r.interval?.startTime
    const end = r.interval?.endTime
    if (label && typeof start === 'number' && typeof end === 'number' && end > start) {
      out.push({ start, end, label })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

const cache = new Map<string, Promise<SkipInterval[]>>()

/** Cached per (malId, episode). Resolves [] on any failure so callers just show no button. */
export function fetchSkipTimes(malId: string, episode: number, episodeLength: number): Promise<SkipInterval[]> {
  const key = `${malId}:${episode}`
  let hit = cache.get(key)
  if (!hit) {
    const types = ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed'].map((t) => `types=${t}`).join('&')
    hit = fetch(
      `https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${episode}?${types}&episodeLength=${Math.round(episodeLength)}`,
    )
      .then((r) => {
        // 404 = AniSkip has no times for this episode (cache that); other failures retry next time.
        if (r.status === 404) return null
        if (!r.ok) throw new Error(`aniskip ${r.status}`)
        return r.json()
      })
      .then(mapSkipResults)
      .catch(() => {
        cache.delete(key)
        return []
      })
    cache.set(key, hit)
  }
  return hit
}
