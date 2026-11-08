import type { MediaDetails, SearchResult, SearchResults } from '@/types/extension'
import { getAppSetting, setAppSetting } from '@/utils/tauri-commands'
import {
  normalizeMediaType,
  resolveAnikotoSlug,
  scoreAnikotoCandidate,
  type AnikotoResolvedSlug,
} from '@/utils/anikotoResolver'

// Manual provider matches, persisted in the app settings table as one JSON map
// keyed by "{providerExtensionId}:{mediaId}".
const DB_KEY = 'provider_match_overrides'

export interface ProviderMatch {
  id: string
  title: string
}

let cache: Record<string, ProviderMatch> | null = null

const keyOf = (extId: string, mediaId: string | number) => `${extId}:${mediaId}`

async function load(): Promise<Record<string, ProviderMatch>> {
  if (cache) return cache
  try {
    const raw = await getAppSetting(DB_KEY)
    cache = raw ? (JSON.parse(raw) as Record<string, ProviderMatch>) : {}
  } catch {
    cache = {}
  }
  return cache
}

export async function getProviderMatch(extId: string, mediaId: string | number) {
  return (await load())[keyOf(extId, mediaId)] ?? null
}

export async function setProviderMatch(extId: string, mediaId: string | number, match: ProviderMatch) {
  const map = await load()
  map[keyOf(extId, mediaId)] = match
  await setAppSetting(DB_KEY, JSON.stringify(map))
}

/** The user's pick wins; otherwise the (strict) auto-matcher. */
export async function resolveProviderSlug(
  extId: string,
  mediaId: string | number,
  details: MediaDetails,
  search: (query: string) => Promise<SearchResults>,
): Promise<(AnikotoResolvedSlug & { manual?: boolean }) | null> {
  const picked = await getProviderMatch(extId, mediaId)
  if (picked) return { id: picked.id, title: picked.title, query: '', score: Infinity, manual: true }
  return resolveAnikotoSlug(details, search)
}

/** Distinct titles of the show (English, romaji, native, synonyms) for the picker chips. */
export function matchTitles(details: MediaDetails): string[] {
  const seen = new Set<string>()
  return [details.english_name, details.title, details.native_name, ...(details.title_synonyms || [])]
    .map((t) => t?.trim() ?? '')
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
}

export interface RankedMatches {
  best: SearchResult | null
  others: SearchResult[]
  /** Set only when exactly one result agrees on year, type and episode count. */
  preselectId: string | null
}

/** Closest year first, then same type, then title similarity. Nothing is preselected unless obvious. */
export function rankMatches(details: MediaDetails, results: SearchResult[]): RankedMatches {
  const type = normalizeMediaType(details.type)
  const yearGap = (r: SearchResult) =>
    details.year && r.year ? Math.abs(details.year - r.year) : 9999
  const typeOk = (r: SearchResult) => !!type && normalizeMediaType(r.media_type) === type
  const agrees = (r: SearchResult) =>
    yearGap(r) === 0 && typeOk(r) && !!details.episode_count && r.available_episodes === details.episode_count

  const ranked = [...results].sort(
    (a, b) =>
      yearGap(a) - yearGap(b) ||
      Number(typeOk(b)) - Number(typeOk(a)) ||
      scoreAnikotoCandidate(details, b) - scoreAnikotoCandidate(details, a),
  )
  const agreeing = ranked.filter(agrees)
  const top = ranked[0]
  const best = top && yearGap(top) <= 1 && typeOk(top) ? top : null
  return {
    best,
    others: best ? ranked.slice(1) : ranked,
    preselectId: agreeing.length === 1 ? agreeing[0].id : null,
  }
}
