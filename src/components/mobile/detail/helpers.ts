/** Pure helpers shared by the phone detail screens. */

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

/** Split `total` items into 1-based inclusive ranges of `size` (the range-picker sheet rows). */
export function chunkRanges(total: number, size: number): { start: number; end: number; label: string }[] {
  if (total <= 0 || size <= 0) return []
  const out: { start: number; end: number; label: string }[] = []
  for (let start = 1; start <= total; start += size) {
    const end = Math.min(start + size - 1, total)
    out.push({ start, end, label: `${start}–${end}` })
  }
  return out
}

/** Released within 3 days: by releaseDate, else back-calculated from last update + broadcast interval. */
export function isRecentlyReleased(
  number: number,
  lastNumber: number,
  releaseDate: string | undefined,
  lastUpdateEnd: string | undefined,
  broadcastInterval: number | undefined
): boolean {
  if (releaseDate) {
    const age = Date.now() - new Date(releaseDate).getTime()
    return age >= 0 && age <= THREE_DAYS_MS
  }
  if (!lastUpdateEnd || !broadcastInterval) return false
  const lastMs = new Date(lastUpdateEnd).getTime()
  if (isNaN(lastMs)) return false
  const age = Date.now() - (lastMs - (lastNumber - number) * broadcastInterval)
  return age >= 0 && age <= THREE_DAYS_MS
}

/** "2 days ago" / "3 mo ago"; '' for missing or unparsable dates. */
export function timeAgo(date: string | undefined, now = Date.now()): string {
  if (!date) return ''
  const ms = now - new Date(date).getTime()
  if (isNaN(ms) || ms < 0) return ''
  const day = 86_400_000
  const d = Math.floor(ms / day)
  if (d < 1) return 'today'
  if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`
  if (d < 365) return `${Math.floor(d / 30)} mo ago`
  return `${Math.floor(d / 365)} yr ago`
}

/** Items whose `number` is within [from, to]; `already` ones are skipped from the download list. */
export function rangeSelection<T extends { id: string; number: number }>(
  items: T[],
  from: number,
  to: number,
  already: Set<string>
): { inRange: number; skipped: number; toDownload: T[] } {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const inRange = items.filter((i) => i.number >= lo && i.number <= hi)
  const toDownload = inRange.filter((i) => !already.has(i.id))
  return { inRange: inRange.length, skipped: inRange.length - toDownload.length, toDownload }
}
