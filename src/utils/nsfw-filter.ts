/**
 * NSFW Content Filtering Utilities
 *
 * Provides functions to detect and filter adult/NSFW content
 * based on genre tags.
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
 * Filter an array of items with genres, removing NSFW content
 * @param items - Array of items with a genres field
 * @param getGenres - Function to extract genres from an item
 * @param filterEnabled - Whether NSFW filtering is enabled
 * @returns Filtered array without NSFW content (if filter enabled)
 */
export function filterNsfwContent<T>(
  items: T[],
  getGenres: (item: T) => string | string[] | null | undefined,
  filterEnabled: boolean
): T[] {
  if (!filterEnabled) return items
  return items.filter(item => !hasNsfwGenres(getGenres(item)))
}
