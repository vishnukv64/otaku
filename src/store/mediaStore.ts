/**
 * Media Store - Zustand state management for anime/manga data
 *
 * Handles:
 * - Search results
 * - Media details
 * - Continue watching/reading lists
 * - Trending and popular content
 */

import { create } from 'zustand'

interface MediaState {
  // State will be defined as we implement features
}

export const useMediaStore = create<MediaState>(() => ({
  // Initial state
}))
