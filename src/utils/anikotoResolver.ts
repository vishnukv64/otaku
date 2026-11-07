import type { MediaDetails, SearchResult, SearchResults } from '@/types/extension'

export interface AnikotoResolvedSlug {
  id: string
  title: string
  query: string
  score: number
}

type AnikotoSearch = (query: string) => Promise<SearchResults>

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#34;': '"',
  '&#039;': "'",
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
}

function decodeEntities(value: string): string {
  return value.replace(/&(amp|quot|apos|lt|gt);|&#0?39;|&#0?34;/gi, (entity) => (
    ENTITY_MAP[entity.toLowerCase()] || entity
  ))
}

function normalizeTitle(value: string): string {
  return decodeEntities(value)
    .toLowerCase()
    .replace(/\b2nd\b/g, 'second')
    .replace(/\b3rd\b/g, 'third')
    .replace(/\b4th\b/g, 'fourth')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function dedupe(
  values: Array<string | null | undefined>,
  keyOf: (value: string) => string = normalizeTitle,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    const key = keyOf(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }

  return out
}

export function buildAnikotoSearchQueries(details: MediaDetails): string[] {
  // Keep spellings that only differ in punctuation: provider search engines
  // treat "One-Punch Man" and "One Punch Man" differently.
  return dedupe([
    details.english_name,
    details.title,
    details.native_name,
    ...(details.title_synonyms || []),
  ], (value) => value.toLowerCase()).slice(0, 8)
}

function compactTitle(value: string): string {
  return normalizeTitle(value).replace(/\s+/g, '')
}

function seasonNumber(value: string): number | null {
  const raw = decodeEntities(value).toLowerCase()
  const patterns = [
    /\bseason\s*0*(\d+)\b/,
    /\bs\s*0*(\d+)\b/,
    /\b0*(\d+)(?:st|nd|rd|th)\s+season\b/,
  ]

  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match?.[1]) return Number.parseInt(match[1], 10)
  }

  return null
}

function stripSeason(value: string): string {
  return normalizeTitle(value)
    .replace(/\bseason\s*0*\d+\b/g, '')
    .replace(/\bs\s*0*\d+\b/g, '')
    .replace(/\b0*\d+(?:st|nd|rd|th)\s+season\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstSeason(values: string[]): number | null {
  for (const value of values) {
    const number = seasonNumber(value)
    if (number != null) return number
  }
  return null
}

function seasonsCompatible(targetSeason: number | null, candidateSeason: number | null): boolean {
  if (targetSeason != null && candidateSeason != null) return targetSeason === candidateSeason
  if (targetSeason != null && targetSeason > 1) return false
  if (candidateSeason != null && candidateSeason > 1) return false
  return true
}

function titleVariants(details: MediaDetails): string[] {
  return dedupe([
    details.title,
    details.english_name,
    details.native_name,
    ...(details.title_synonyms || []),
  ])
}

// Provider-side labels such as "(Uncensored)" or "(Dub)" are not part of the title.
function withoutTrailingLabel(value: string | null | undefined): string | undefined {
  return value?.replace(/\s*\([^()]*\)\s*$/, '')
}

function candidateVariants(candidate: SearchResult): string[] {
  const titles = [candidate.title, candidate.native_name, ...(candidate.title_synonyms || [])]
  return dedupe([...titles, ...titles.map(withoutTrailingLabel)])
}

function tokenScore(a: string, b: string): number {
  const aTokens = new Set(normalizeTitle(a).split(' ').filter(Boolean))
  const bTokens = new Set(normalizeTitle(b).split(' ').filter(Boolean))
  if (!aTokens.size || !bTokens.size) return 0

  let intersection = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1
  }
  const union = new Set([...aTokens, ...bTokens]).size
  return union > 0 ? intersection / union : 0
}

function bestTitleScore(targets: string[], candidates: string[]): number {
  let best = 0

  for (const target of targets) {
    for (const candidate of candidates) {
      const normalizedTarget = normalizeTitle(target)
      const normalizedCandidate = normalizeTitle(candidate)
      if (!normalizedTarget || !normalizedCandidate) continue

      if (normalizedTarget === normalizedCandidate) best = Math.max(best, 120)
      if (compactTitle(target) === compactTitle(candidate)) best = Math.max(best, 115)
      if (stripSeason(target) === stripSeason(candidate)) best = Math.max(best, 90)

      if (normalizedTarget.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedTarget)) {
        const shorter = Math.min(normalizedTarget.length, normalizedCandidate.length)
        const longer = Math.max(normalizedTarget.length, normalizedCandidate.length)
        best = Math.max(best, 70 * Math.sqrt(shorter / longer))
      }

      best = Math.max(best, 55 * tokenScore(target, candidate))
    }
  }

  return best
}

function normalizeMediaType(value?: string): string | null {
  const lower = value?.toLowerCase().trim()
  if (!lower) return null
  if (lower === 'tv' || lower === 'tv series') return 'tv'
  if (lower === 'movie' || lower === 'film') return 'movie'
  if (lower === 'ova' || lower === 'oav') return 'ova'
  if (lower === 'ona' || lower === 'web') return 'ona'
  if (lower === 'special' || lower === 'sp') return 'special'
  return lower
}

export function scoreAnikotoCandidate(details: MediaDetails, candidate: SearchResult): number {
  const targets = titleVariants(details)
  const candidates = candidateVariants(candidate)
  if (!targets.length || !candidates.length) return 0

  const targetSeason = firstSeason(targets)
  const candidateSeason = firstSeason(candidates)
  let score = bestTitleScore(targets, candidates)
  if (score <= 0) return 0

  if (!seasonsCompatible(targetSeason, candidateSeason)) {
    // Arc-named seasons ("Shimetsu Kaiyuu - Zenpen") carry no season number on
    // one side; accept those only on an exact title match.
    if (targetSeason != null && candidateSeason != null) return 0
    if (score < 115) return 0
  }

  if (targetSeason != null && candidateSeason === targetSeason) score += 20
  if (details.episode_count && candidate.available_episodes) {
    if (details.episode_count === candidate.available_episodes) {
      score += 10
    } else {
      score -= Math.min(20, Math.abs(details.episode_count - candidate.available_episodes))
    }
  }

  const targetType = normalizeMediaType(details.type)
  const candidateType = normalizeMediaType(candidate.media_type)
  if (targetType && candidateType && targetType === candidateType) score += 5

  return score
}

export function pickBestAnikotoMatch(
  details: MediaDetails,
  candidates: Array<SearchResult & { query?: string }>,
): AnikotoResolvedSlug | null {
  let best: AnikotoResolvedSlug | null = null

  for (const candidate of candidates) {
    const score = scoreAnikotoCandidate(details, candidate)
    if (score < 80) continue
    if (!best || score > best.score) {
      best = {
        id: candidate.id,
        title: candidate.title,
        query: candidate.query || '',
        score,
      }
    }
  }

  return best
}

export async function resolveAnikotoSlug(
  details: MediaDetails,
  search: AnikotoSearch,
): Promise<AnikotoResolvedSlug | null> {
  const byId = new Map<string, SearchResult & { query?: string }>()

  let lastError: unknown = null
  let anySucceeded = false
  for (const query of buildAnikotoSearchQueries(details)) {
    // One failed query (timeout, odd characters) must not sink the others.
    let result: SearchResults
    try {
      result = await search(query)
      anySucceeded = true
    } catch (error) {
      lastError = error
      continue
    }
    for (const item of result.results || []) {
      if (!item.id || byId.has(item.id)) continue
      byId.set(item.id, { ...item, query })
    }
  }

  // Every query failed: the provider is down, which callers report differently
  // from "no match".
  if (!anySucceeded && lastError) throw lastError

  return pickBestAnikotoMatch(details, [...byId.values()])
}
