import { MANGAKAKALOT_EXTENSION } from '@/extensions/mangakakalot-extension'
import type { ExtensionMetadata, SearchResult } from '@/types/extension'
import { loadExtension, searchManga } from '@/utils/tauri-commands'

export const MANGAKAKALOT_EXTENSION_ID = 'com.mangakakalot.source'

function normalize(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '').trim()
}

// Non-canonical works to exclude from matches unless the query explicitly contains them.
const DERIVATIVE_KEYWORDS = ['doujinshi', 'parody', 'fanmade', 'fan made', 'fan-made']

function hasDerivativeKeyword(title: string): boolean {
  const lower = title.toLowerCase()
  return DERIVATIVE_KEYWORDS.some((kw) => lower.includes(kw))
}

// Returns a 0-100 match score: 100=exact, 60-90=prefix, 0-40=substring, 0=no match.
function scoreMatch(queryTitle: string, candidateTitle: string): number {
  const a = normalize(queryTitle)
  const b = normalize(candidateTitle)
  if (!a || !b) return 0

  if (hasDerivativeKeyword(candidateTitle) && !hasDerivativeKeyword(queryTitle)) {
    return 0
  }

  if (a === b) return 100

  if (b.startsWith(a)) {
    const excess = b.length - a.length
    return Math.max(60, 90 - excess * 2)
  }
  if (a.startsWith(b)) {
    const excess = a.length - b.length
    return Math.max(60, 90 - excess * 2)
  }

  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
    if (ratio < 0.6) return 0
    return Math.round(40 * ratio)
  }

  return 0
}

export async function resolveJikanToMangakakalot(
  extensionId: string,
  jikanTitle: string,
  englishTitle?: string
): Promise<SearchResult | null> {
  const queries = [jikanTitle]
  if (englishTitle && normalize(englishTitle) !== normalize(jikanTitle)) {
    queries.push(englishTitle)
  }

  let best: { score: number; result: SearchResult } | null = null

  for (const query of queries) {
    try {
      const results = await searchManga(extensionId, query, 1, true)
      for (const r of results.results) {
        const scoreA = scoreMatch(jikanTitle, r.title)
        const scoreB = englishTitle ? scoreMatch(englishTitle, r.title) : 0
        const score = Math.max(scoreA, scoreB)
        if (score > 0 && (!best || score > best.score)) {
          best = { score, result: r }
          if (score === 100) return r
        }
      }
    } catch { /* continue */ }
  }

  return best?.result ?? null
}

export const MANGAKAKALOT_GENRES: { id: number; name: string; slug: string }[] = [
  { id: 10, name: 'Action', slug: 'action' },
  { id: 11, name: 'Adaptation', slug: 'adaptation' },
  { id: 12, name: 'Adult', slug: 'adult' },
  { id: 13, name: 'Adventure', slug: 'adventure' },
  { id: 14, name: 'Boys Love', slug: 'boys-love' },
  { id: 15, name: 'Childhood friends', slug: 'childhood-friends' },
  { id: 16, name: 'Comedy', slug: 'comedy' },
  { id: 17, name: 'Demons', slug: 'demons' },
  { id: 18, name: 'Doujinshi', slug: 'doujinshi' },
  { id: 19, name: 'Drama', slug: 'drama' },
  { id: 20, name: 'Ecchi', slug: 'ecchi' },
  { id: 21, name: 'Erotica', slug: 'erotica' },
  { id: 22, name: 'Fantasy', slug: 'fantasy' },
  { id: 23, name: 'Full Color', slug: 'full-color' },
  { id: 24, name: 'Gender bender', slug: 'gender-bender' },
  { id: 25, name: 'Harem', slug: 'harem' },
  { id: 26, name: 'Heartwarming', slug: 'heartwarming' },
  { id: 27, name: 'Hentai', slug: 'hentai' },
  { id: 28, name: 'Historical', slug: 'historical' },
  { id: 29, name: 'Isekai', slug: 'isekai' },
  { id: 30, name: 'Josei', slug: 'josei' },
  { id: 31, name: 'Long Strip', slug: 'long-strip' },
  { id: 32, name: 'Magic', slug: 'magic' },
  { id: 33, name: 'Manga', slug: 'manga' },
  { id: 34, name: 'Manhua', slug: 'manhua' },
  { id: 35, name: 'Manhwa', slug: 'manhwa' },
  { id: 36, name: 'Martial arts', slug: 'martial-arts' },
  { id: 37, name: 'Mature', slug: 'mature' },
  { id: 38, name: 'Mecha', slug: 'mecha' },
  { id: 39, name: 'Monsters', slug: 'monsters' },
  { id: 40, name: 'Mystery', slug: 'mystery' },
  { id: 41, name: 'Netorare', slug: 'netorare' },
  { id: 42, name: 'Office Workers', slug: 'office-workers' },
  { id: 43, name: 'One shot', slug: 'one-shot' },
  { id: 44, name: 'Pornographic', slug: 'pornographic' },
  { id: 45, name: 'Psychological', slug: 'psychological' },
  { id: 46, name: 'Reincarnation', slug: 'reincarnation' },
  { id: 47, name: 'Revenge', slug: 'revenge' },
  { id: 48, name: 'Romance', slug: 'romance' },
  { id: 49, name: 'School life', slug: 'school-life' },
  { id: 50, name: 'Shoujo', slug: 'shoujo' },
  { id: 51, name: 'Shounen', slug: 'shounen' },
  { id: 52, name: 'Slice of life', slug: 'slice-of-life' },
  { id: 53, name: 'Smut', slug: 'smut' },
  { id: 54, name: 'Sm_bdsm', slug: 'sm-bdsm' },
  { id: 55, name: 'Super Power', slug: 'super-power' },
  { id: 56, name: 'Supernatural', slug: 'supernatural' },
  { id: 57, name: 'Survival', slug: 'survival' },
  { id: 58, name: 'Time Travel', slug: 'time-travel' },
  { id: 59, name: 'Tragedy', slug: 'tragedy' },
  { id: 60, name: 'Transmigration', slug: 'transmigration' },
  { id: 61, name: 'Vampires', slug: 'vampires' },
  { id: 62, name: 'Villainess', slug: 'villainess' },
  { id: 63, name: 'Webtoons', slug: 'webtoons' },
  { id: 64, name: 'Yaoi', slug: 'yaoi' },
  { id: 65, name: 'Yuri', slug: 'yuri' },
]

export interface MangaExtensionIds {
  mangakakalot: string
}

export async function loadBundledMangaExtensions(): Promise<MangaExtensionIds> {
  const mangakakalot = await loadExtension(MANGAKAKALOT_EXTENSION)

  return {
    mangakakalot: mangakakalot.id,
  }
}

export function resolveMangaExtensionId(
  mediaExtensionId: string | null | undefined,
  ids: Partial<MangaExtensionIds>
): string {
  if (mediaExtensionId === MANGAKAKALOT_EXTENSION_ID) {
    return ids.mangakakalot || ''
  }

  if (mediaExtensionId === 'com.allanime.manga' || mediaExtensionId === 'jikan') {
    return ids.mangakakalot || ''
  }

  if (!mediaExtensionId) {
    return ids.mangakakalot || ''
  }

  if (mediaExtensionId === ids.mangakakalot) {
    return mediaExtensionId
  }

  return ids.mangakakalot || ''
}

export function buildBundledMangaExtensionMap(
  ids: Partial<MangaExtensionIds>
): Record<string, string> {
  const map: Record<string, string> = {}

  if (ids.mangakakalot) {
    map[MANGAKAKALOT_EXTENSION_ID] = ids.mangakakalot
    map['com.allanime.manga'] = ids.mangakakalot
    map.jikan = ids.mangakakalot
  }

  return map
}

export function asBundledMangaSelection(
  manga: { id: string; title: string },
  extensionId: string
): { manga: typeof manga; extensionId: string } {
  return { manga, extensionId }
}

export type BundledMangaMetadata = Record<'mangakakalot', ExtensionMetadata>
