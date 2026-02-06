/**
 * Media Helper Utilities
 *
 * Functions for determining media states like new episodes, watch status, etc.
 */

import type { SearchResult } from '@/types/extension'
import { getLatestWatchProgressForMedia } from './tauri-commands'

/**
 * Check if anime is currently airing (not finished)
 */
function isAiring(status?: string): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s === 'releasing' || s === 'ongoing' || s === 'airing' || s === 'currently airing' || s.includes('airing') || s.includes('ongoing') || s.includes('releasing')
}

/**
 * Determines if an anime has new episodes available since the user last watched
 *
 * IMPORTANT: Only returns true for currently airing anime, not finished ones
 *
 * @deprecated Use the `useReleaseState` hook from `@/hooks/useReleaseStates` instead.
 * The V2 release tracking system provides more reliable detection using multiple signals
 * (episode number, episode ID, and count) rather than just comparing latest_episode
 * from search results against watch progress.
 *
 * @param media - The anime/manga search result
 * @returns Promise<boolean> - true if there are new unwatched episodes
 */
export async function hasNewEpisode(media: SearchResult): Promise<boolean> {
  // Must be currently airing to have "new" episodes
  if (!isAiring(media.status)) {
    return false
  }

  // Must have a latest_episode number to determine if new
  if (!media.latest_episode) {
    return false
  }

  try {
    // Get the user's latest watch progress for this media
    const watchProgress = await getLatestWatchProgressForMedia(media.id)

    // If no watch history, not "new" - just available
    if (!watchProgress) {
      return false
    }

    // Check if the latest episode is newer than what they've watched
    // The user has "new" content if latest_episode > their last watched episode
    return media.latest_episode > watchProgress.episode_number
  } catch (error) {
    console.error('Error checking for new episodes:', error)
    return false
  }
}

/**
 * Determines the next episode the user should watch
 *
 * @param episodes - Array of available episodes
 * @returns Promise with next episode info
 */
export async function getNextEpisodeToWatch(
  episodes: Array<{ id: string; number: number }>
): Promise<{
  episodeId: string
  episodeNumber: number
  isNew: boolean // true if this is a newly released episode
  shouldResume: boolean // true if partially watched
} | null> {
  if (episodes.length === 0) return null

  try {
    const { getWatchProgress } = await import('./tauri-commands')

    // Find the last watched episode
    let lastWatchedIndex = -1

    for (let i = 0; i < episodes.length; i++) {
      const progress = await getWatchProgress(episodes[i].id)
      if (progress) {
        if (progress.completed) {
          lastWatchedIndex = i
        } else if (progress.progress_seconds > 0) {
          // Found partially watched episode
          return {
            episodeId: episodes[i].id,
            episodeNumber: episodes[i].number,
            isNew: false,
            shouldResume: true,
          }
        }
      }
    }

    // If all episodes watched, suggest the latest
    if (lastWatchedIndex === episodes.length - 1) {
      return {
        episodeId: episodes[lastWatchedIndex].id,
        episodeNumber: episodes[lastWatchedIndex].number,
        isNew: false,
        shouldResume: false,
      }
    }

    // Otherwise, suggest the next unwatched episode
    const nextIndex = lastWatchedIndex + 1
    return {
      episodeId: episodes[nextIndex].id,
      episodeNumber: episodes[nextIndex].number,
      isNew: lastWatchedIndex >= 0, // It's "new" if they've watched previous episodes
      shouldResume: false,
    }
  } catch (error) {
    console.error('Error determining next episode:', error)
    // Fallback to first episode
    return {
      episodeId: episodes[0].id,
      episodeNumber: episodes[0].number,
      isNew: false,
      shouldResume: false,
    }
  }
}
