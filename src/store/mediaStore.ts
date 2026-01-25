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
import type { SearchResult, MediaDetails } from '@/types/extension'
import * as tauri from '@/utils/tauri-commands'

interface MediaState {
  // Search state
  searchQuery: string
  searchResults: SearchResult[]
  searchLoading: boolean
  searchError: string | null
  hasNextPage: boolean
  currentPage: number

  // Selected media
  selectedMedia: MediaDetails | null
  selectedMediaLoading: boolean

  // Actions
  setSearchQuery: (query: string) => void
  search: (extensionId: string, query: string, page?: number) => Promise<void>
  loadMoreResults: (extensionId: string) => Promise<void>
  selectMedia: (extensionId: string, animeId: string) => Promise<void>
  clearSearch: () => void
}

export const useMediaStore = create<MediaState>((set, get) => ({
  // Initial state
  searchQuery: '',
  searchResults: [],
  searchLoading: false,
  searchError: null,
  hasNextPage: false,
  currentPage: 1,
  selectedMedia: null,
  selectedMediaLoading: false,

  // Actions
  setSearchQuery: (query) => set({ searchQuery: query }),

  search: async (extensionId, query, page = 1) => {
    set({ searchLoading: true, searchError: null })

    try {
      const results = await tauri.searchAnime(extensionId, query, page)

      set({
        searchResults: page === 1 ? results.results : [...get().searchResults, ...results.results],
        hasNextPage: results.has_next_page,
        currentPage: page,
        searchLoading: false,
      })
    } catch (error) {
      set({
        searchError: error instanceof Error ? error.message : 'Search failed',
        searchLoading: false,
      })
    }
  },

  loadMoreResults: async (extensionId) => {
    const { currentPage, hasNextPage, searchQuery, searchLoading } = get()

    if (!hasNextPage || searchLoading) return

    await get().search(extensionId, searchQuery, currentPage + 1)
  },

  selectMedia: async (extensionId, animeId) => {
    set({ selectedMediaLoading: true })

    try {
      const details = await tauri.getAnimeDetails(extensionId, animeId)
      set({ selectedMedia: details, selectedMediaLoading: false })
    } catch (error) {
      console.error('Failed to load media details:', error)
      set({ selectedMediaLoading: false })
    }
  },

  clearSearch: () =>
    set({
      searchQuery: '',
      searchResults: [],
      searchError: null,
      hasNextPage: false,
      currentPage: 1,
    }),
}))
