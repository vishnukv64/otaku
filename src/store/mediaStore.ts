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
  search: (query: string, page?: number, sfw?: boolean) => Promise<void>
  loadMoreResults: (sfw?: boolean) => Promise<void>
  selectMedia: (animeId: string) => Promise<void>
  clearSearch: () => void
}

const MIN_SEARCH_QUERY_LENGTH = 3
let searchRequestId = 0

function formatSearchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  if (!message) return 'Search failed'

  if (message.includes('429') || message.toLowerCase().includes('rate limited')) {
    return 'Jikan is rate limiting searches. Wait a moment and try again.'
  }

  if (
    message.includes('504')
    || message.toLowerCase().includes('myanimelist')
    || message.toLowerCase().includes('temporarily unavailable')
  ) {
    return 'Jikan is temporarily unavailable because MyAnimeList is not responding. Try again in a moment.'
  }

  return message
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

  search: async (query, page = 1, sfw = true) => {
    const normalizedQuery = query.trim()
    if (normalizedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
      get().clearSearch()
      return
    }

    const requestId = ++searchRequestId
    set({ searchLoading: true, searchError: null, searchQuery: normalizedQuery })

    try {
      const results = await tauri.jikanSearchAnime(normalizedQuery, page, sfw)
      if (requestId !== searchRequestId) return

      // Deduplicate results to avoid React key warnings
      const existingResults = page === 1 ? [] : get().searchResults
      const allResults = [...existingResults, ...results.results]

      const uniqueResults = allResults.reduce((acc, item) => {
        if (!acc.find(existing => existing.id === item.id)) {
          acc.push(item)
        }
        return acc
      }, [] as SearchResult[])

      set({
        searchResults: uniqueResults,
        hasNextPage: results.has_next_page,
        currentPage: page,
        searchLoading: false,
      })
    } catch (error) {
      if (requestId !== searchRequestId) return

      set({
        searchError: formatSearchError(error),
        searchLoading: false,
      })
    }
  },

  loadMoreResults: async (sfw = true) => {
    const { currentPage, hasNextPage, searchQuery, searchLoading } = get()

    if (!hasNextPage || searchLoading) return

    await get().search(searchQuery, currentPage + 1, sfw)
  },

  selectMedia: async (animeId) => {
    set({ selectedMediaLoading: true })

    try {
      const details = await tauri.jikanAnimeDetails(parseInt(animeId))
      set({ selectedMedia: details, selectedMediaLoading: false })
    } catch (error) {
      console.error('Failed to load media details:', error)
      set({ selectedMediaLoading: false })
    }
  },

  clearSearch: () => {
    searchRequestId++
    set({
      searchQuery: '',
      searchResults: [],
      searchLoading: false,
      searchError: null,
      hasNextPage: false,
      currentPage: 1,
    })
  },
}))
