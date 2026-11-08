/**
 * Provider-supplied extras (KickAssAnime): audio locales, age rating, broadcast slot,
 * banner, dates. Jikan/AniList data wins; callers use these only to fill gaps.
 */
import { useEffect, useState } from 'react'
import type { MediaDetails } from '@/types/extension'
import { getAnimeDetails } from '@/utils/tauri-commands'

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WEEK_MS = 7 * 24 * 3600 * 1000

/** "ja-JP" -> "Japanese", "es-419" -> "Latin American Spanish". */
export function localeLabel(tag: string): string {
  const base = tag.split('-')[0] ?? tag
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'language' })
    return (tag === 'en-US' || tag === 'ja-JP' ? dn.of(base) : dn.of(tag)) || tag
  } catch {
    return tag
  }
}

/** Label for a player audio mode: 'sub' | 'dub' | a locale tag. */
export function audioModeLabel(mode: string): string {
  if (mode === 'sub' || mode === 'dub') return mode.toUpperCase()
  return mode === 'ja-JP' ? 'Japanese (Sub)' : `${localeLabel(mode)} (Dub)`
}

/** "Sub: Japanese · Dub: English, Spanish" (empty when there is nothing to say). */
export function audioSummary(locales?: string[]): string {
  if (!locales?.length) return ''
  const sub = locales.filter((l) => l === 'ja-JP').map(localeLabel)
  const dub = locales.filter((l) => l !== 'ja-JP').map(localeLabel)
  return [sub.length ? `Sub: ${sub.join(', ')}` : '', dub.length ? `Dub: ${dub.join(', ')}` : '']
    .filter(Boolean)
    .join(' · ')
}

/** Next UTC occurrence (ms) of a weekly "friday" + "14:00" slot, strictly after `now`. */
export function nextBroadcastMs(day: string, time: string, now = Date.now()): number | null {
  const dow = DAYS.indexOf(day.toLowerCase())
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (dow < 0 || !m) return null
  const d = new Date(now)
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(m[1]), Number(m[2]))
  t += ((dow - new Date(t).getUTCDay() + 7) % 7) * 86400000
  while (t <= now) t += WEEK_MS
  return t
}

/** "Airs Fridays 7:30 PM GMT+5:30" in the viewer's timezone. */
export function formatBroadcast(day: string, time: string, now = Date.now()): string {
  const t = nextBroadcastMs(day, time, now)
  if (t === null) return ''
  const d = new Date(t)
  const wd = d.toLocaleDateString('en-US', { weekday: 'long' })
  const clock = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  return `Airs ${wd}s ${clock}`
}

/** ISO date -> "Sep 29, 2023" (UTC so the day does not shift). */
export function formatIsoDate(iso?: string): string {
  const d = iso ? new Date(iso) : null
  return d && !isNaN(d.getTime())
    ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : ''
}

/** "Sep 29, 2023 – Mar 22, 2024" / "Sep 29, 2023 – ?" */
export function formatDateRange(start?: string, end?: string): string {
  const a = formatIsoDate(start)
  return a ? `${a} – ${formatIsoDate(end) || '?'}` : ''
}

/** Props for NextEpisodeCountdown synthesised from a broadcast slot. */
export function countdownFromBroadcast(b: { day: string; time: string }, now = Date.now()) {
  const next = nextBroadcastMs(b.day, b.time, now)
  return next === null ? null : { lastUpdateEnd: new Date(next - WEEK_MS).toISOString(), broadcastInterval: WEEK_MS }
}

const cache = new Map<string, Promise<MediaDetails | null>>()

/** Provider details (cached per session); null until loaded or when unavailable. */
export function useProviderExtras(extId?: string | null, providerMediaId?: string | null): MediaDetails | null {
  const key = extId && providerMediaId ? `${extId}::${providerMediaId}` : ''
  const [loaded, setLoaded] = useState<{ key: string; data: MediaDetails | null } | null>(null)
  useEffect(() => {
    if (!key || !extId || !providerMediaId) return
    let p = cache.get(key)
    if (!p) {
      p = getAnimeDetails(extId, providerMediaId).catch(() => null)
      cache.set(key, p)
    }
    let live = true
    void p.then((data) => live && setLoaded({ key, data }))
    return () => {
      live = false
    }
  }, [key, extId, providerMediaId])
  return loaded?.key === key ? loaded.data : null
}
