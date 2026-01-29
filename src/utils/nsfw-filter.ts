/**
 * NSFW Content Filtering Utilities
 *
 * Provides functions to detect and filter adult/NSFW content
 * based on genre tags and title keywords.
 */

// Genres that indicate NSFW/adult content
export const NSFW_GENRES = [
  'hentai',
  'ecchi',
  'adult',
  'mature',
  'erotica',
  'smut',
  'adult cast',
  'sexual violence',
]

// Title keywords that indicate NSFW content (case-insensitive)
export const NSFW_TITLE_KEYWORDS = [
  'nsfw',
  "Ecchi",
  'sex',
  'hentai',
  'erotic',
  'porn',
  'xxx',
  'nude',
  'naked',
  'lewd',
  'nsfw',
  'r-18',
  'r18',
  '18+',
  'concubine',
  'brothel',
  'prostitute',
  'slave girl',
  'sex slave',
  'violated',
]

/**
 * Check if a genres string/array contains NSFW content
 * @param genres - JSON string array or comma-separated string of genres
 * @returns true if any NSFW genre is found
 */
export function hasNsfwGenres(genres: string | string[] | null | undefined): boolean {
  if (!genres) return false

  let genreList: string[]

  if (Array.isArray(genres)) {
    genreList = genres
  } else {
    // Try to parse as JSON array first
    try {
      const parsed = JSON.parse(genres)
      if (Array.isArray(parsed)) {
        genreList = parsed
      } else {
        // Fall back to comma-separated
        genreList = genres.split(',').map(g => g.trim())
      }
    } catch {
      // Not valid JSON, treat as comma-separated string
      genreList = genres.split(',').map(g => g.trim())
    }
  }

  return genreList.some(genre =>
    NSFW_GENRES.includes(genre.toLowerCase())
  )
}

/**
 * Check if a title contains NSFW keywords
 * @param title - The title to check
 * @returns true if any NSFW keyword is found in the title
 */
export function hasNsfwTitle(title: string | null | undefined): boolean {
  if (!title) return false

  const lowerTitle = title.toLowerCase()
  return NSFW_TITLE_KEYWORDS.some(keyword => lowerTitle.includes(keyword))
}

/**
 * Check if content is NSFW based on genres OR title
 * @param genres - Genres to check
 * @param title - Title to check
 * @returns true if content appears to be NSFW
 */
export function isNsfwContent(
  genres: string | string[] | null | undefined,
  title: string | null | undefined
): boolean {
  return hasNsfwGenres(genres) || hasNsfwTitle(title)
}

/**
 * Filter an array of items, removing NSFW content based on genres and/or title
 * @param items - Array of items to filter
 * @param getGenres - Function to extract genres from an item
 * @param filterEnabled - Whether NSFW filtering is enabled
 * @param getTitle - Optional function to extract title from an item (for keyword-based filtering)
 * @returns Filtered array without NSFW content (if filter enabled)
 */
export function filterNsfwContent<T>(
  items: T[],
  getGenres: (item: T) => string | string[] | null | undefined,
  filterEnabled: boolean,
  getTitle?: (item: T) => string | null | undefined
): T[] {
  if (!filterEnabled) return items
  return items.filter(item => {
    const genres = getGenres(item)
    const title = getTitle ? getTitle(item) : undefined
    return !isNsfwContent(genres, title)
  })
}
