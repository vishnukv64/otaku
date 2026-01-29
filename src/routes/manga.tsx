/**
 * Manga Route - Manga Browser Page
 *
 * Browse, search, and discover manga with genre filtering
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Loader2, AlertCircle, X, BookOpen, Sparkles } from 'lucide-react'
import {
  loadExtension,
  discoverManga,
  searchManga,
  getContinueReadingWithDetails,
  streamDiscoverManga,
  onMangaDiscoverResults,
  type DiscoverResultsEvent,
} from '@/utils/tauri-commands'
import { MediaCard } from '@/components/media/MediaCard'
import { MangaDetailModal } from '@/components/media/MangaDetailModal'
import { ContinueReadingSection } from '@/components/media/ContinueReadingSection'
import { ALLANIME_MANGA_EXTENSION } from '@/extensions/allanime-manga-extension'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import type { SearchResult } from '@/types/extension'
import { useSettingsStore } from '@/store/settingsStore'
import { filterNsfwContent } from '@/utils/nsfw-filter'

// Debounce delay for instant search (ms)
const SEARCH_DEBOUNCE_MS = 300

export const Route = createFileRoute('/manga')({
  component: MangaScreen,
})

function MangaScreen() {
  const gridDensity = useSettingsStore((state) => state.gridDensity)
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const { getStatus, refresh: refreshStatus } = useMediaStatusContext()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const [extensionId, setExtensionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedManga, setSelectedManga] = useState<SearchResult | null>(null)
  const [recommendations, setRecommendations] = useState<SearchResult[]>([])
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(true)
  const [userReadingGenres, setUserReadingGenres] = useState<string[]>([])
  const [hasReadingHistory, setHasReadingHistory] = useState(false)

  // Grid density class mapping (extended for 4K displays)
  const gridClasses = {
    compact: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 5xl:grid-cols-14 gap-2',
    comfortable: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 3xl:grid-cols-8 4xl:grid-cols-10 5xl:grid-cols-12 gap-4',
    spacious: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-8 5xl:grid-cols-10 gap-6',
  }[gridDensity]

  // Load manga extension on mount
  useEffect(() => {
    const initExtension = async () => {
      try {
        const metadata = await loadExtension(ALLANIME_MANGA_EXTENSION)
        setExtensionId(metadata.id)
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load manga extension')
        setLoading(false)
      }
    }

    initExtension()
  }, [])

  // Load user's reading genres for personalized recommendations
  useEffect(() => {
    const loadUserGenres = async () => {
      try {
        const continueReading = await getContinueReadingWithDetails(20)
        console.log('[Manga] Continue reading entries:', continueReading.length)

        if (continueReading.length > 0) {
          setHasReadingHistory(true)

          // Count genre occurrences from all reading history
          const genreCounts = new Map<string, number>()
          continueReading.forEach(entry => {
            console.log('[Manga] Entry genres for', entry.media.title, ':', entry.media.genres)
            if (entry.media.genres) {
              try {
                const genres = JSON.parse(entry.media.genres)
                if (Array.isArray(genres)) {
                  // Count each genre occurrence (use original case from API)
                  genres.forEach((g: string) => {
                    genreCounts.set(g, (genreCounts.get(g) || 0) + 1)
                  })
                }
              } catch {
                // Genres might be a comma-separated string
                entry.media.genres.split(',').forEach(g => {
                  const genre = g.trim()
                  genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1)
                })
              }
            }
          })

          // Sort by count (descending) and get top 4 genres
          const sortedGenres = Array.from(genreCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([genre]) => genre)

          console.log('[Manga] Top genres from reading history:', sortedGenres, 'counts:', Object.fromEntries(genreCounts))
          setUserReadingGenres(sortedGenres)
        }
      } catch (err) {
        console.error('Failed to load user reading genres:', err)
      }
    }

    loadUserGenres()
  }, [])

  // Track seen IDs to avoid duplicates across SSE events
  const seenIdsRef = useRef<Set<string>>(new Set())

  // Handle SSE discover results
  const handleDiscoverResults = useCallback((event: DiscoverResultsEvent) => {
    // Deduplicate results using ref to track seen IDs
    const newUniqueResults = event.results.filter(item => {
      if (seenIdsRef.current.has(item.id)) return false
      seenIdsRef.current.add(item.id)
      return true
    })

    if (newUniqueResults.length > 0) {
      setRecommendations(prev => [...prev, ...newUniqueResults])
    }

    // Update pagination state
    setCurrentPage(event.page)
    setHasNextPage(event.has_next_page)

    // Mark loading complete when last page is received
    if (event.is_last) {
      setRecommendationsLoading(false)
    }
  }, [])

  // Load recommendations via SSE (streams 3 pages progressively)
  useEffect(() => {
    if (!extensionId) return

    // Reset state for new stream
    setRecommendationsLoading(true)
    setRecommendations([])
    seenIdsRef.current.clear()
    setCurrentPage(1)
    setHasNextPage(true)

    // Track mounted state to handle async cleanup properly
    let isMounted = true
    let unsubscribe: (() => void) | null = null

    const startStreaming = async () => {
      try {
        // Set up listener first
        const unsub = await onMangaDiscoverResults((event) => {
          // Only process events if still mounted
          if (isMounted) {
            handleDiscoverResults(event)
          }
        })

        // Store unsubscribe if still mounted, otherwise cleanup immediately
        if (isMounted) {
          unsubscribe = unsub
        } else {
          unsub()
          return
        }

        // Start streaming (fetches 3 pages progressively)
        // nsfwFilter=true means "hide adult", so allowAdult should be !nsfwFilter
        console.log('[Manga] Starting SSE streaming with genres:', userReadingGenres)
        await streamDiscoverManga(extensionId, 'score', userReadingGenres, !nsfwFilter, 3)
      } catch (err) {
        console.error('Failed to stream manga:', err)
        if (isMounted) {
          setRecommendationsLoading(false)
        }
      }
    }

    startStreaming()

    return () => {
      isMounted = false
      unsubscribe?.()
    }
    // Note: handleDiscoverResults is stable (empty deps) and used inside closure, so not needed in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensionId, userReadingGenres, nsfwFilter])

  // Load more recommendations when scrolling to bottom
  // SSE loads pages 1-3 initially, so infinite scroll starts from page 4
  const loadMoreRecommendations = useCallback(async () => {
    if (!extensionId || loadingMore || !hasNextPage || searchInput) return

    setLoadingMore(true)
    try {
      // Start from page after SSE (which loads pages 1-3)
      const nextPage = Math.max(currentPage + 1, 4)
      const results = await discoverManga(extensionId, nextPage, 'score', userReadingGenres, !nsfwFilter)

      // Deduplicate using the seenIds ref
      const newResults = results.results.filter(item => {
        if (seenIdsRef.current.has(item.id)) return false
        seenIdsRef.current.add(item.id)
        return true
      })

      setRecommendations(prev => [...prev, ...newResults])
      setCurrentPage(nextPage)
      setHasNextPage(results.has_next_page)
    } catch (err) {
      console.error('Failed to load more manga:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [extensionId, currentPage, hasNextPage, loadingMore, searchInput, userReadingGenres, nsfwFilter])

  // Intersection observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !loadingMore && !recommendationsLoading) {
          loadMoreRecommendations()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [hasNextPage, loadingMore, recommendationsLoading, loadMoreRecommendations])

  // Debounced instant search
  useEffect(() => {
    if (!extensionId) return

    if (!searchInput.trim()) {
      setSearchResults([])
      return
    }

    setSearchLoading(true)
    // nsfwFilter=true means "hide adult", so allowAdult should be !nsfwFilter
    const timer = setTimeout(async () => {
      try {
        const results = await searchManga(extensionId, searchInput, 1, !nsfwFilter)
        // Also filter on frontend in case API doesn't filter properly
        // Filter NSFW using both genres and title keywords
        const filtered = filterNsfwContent(results.results, (item) => item.genres, nsfwFilter, (item) => item.title)
        setSearchResults(filtered)
      } catch (err) {
        console.error('Search failed:', err)
      } finally {
        setSearchLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [searchInput, extensionId, nsfwFilter])

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchInput('')
    setSearchResults([])
    searchInputRef.current?.focus()
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcut(
    {
      '/': (e) => {
        e.preventDefault()
        searchInputRef.current?.focus()
      },
    },
    []
  )

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-[var(--color-accent-primary)] mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Extension Error</h2>
          <p className="text-[var(--color-text-secondary)]">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 sm:px-6 lg:px-8 3xl:px-12 py-8 max-w-4k mx-auto">
      {/* Search Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-6">
          <BookOpen className="w-8 h-8 text-[var(--color-accent-primary)]" />
          <h1 className="text-3xl font-bold">Manga Browser</h1>
        </div>

        {/* Instant Search */}
        <div className="max-w-2xl">
          <div className="relative">
            {searchLoading ? (
              <Loader2
                className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-accent-primary)] animate-spin"
                size={20}
              />
            ) : (
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
                size={20}
              />
            )}
            <input
              ref={searchInputRef}
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search for manga..."
              className="w-full pl-12 pr-12 py-3 bg-[var(--color-bg-secondary)] border border-[var(--color-bg-hover)] rounded-lg text-white placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)] focus:border-transparent"
            />
            {searchInput && (
              <button
                onClick={handleClearSearch}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                aria-label="Clear search"
              >
                <X size={20} />
              </button>
            )}
          </div>
          {searchInput && !searchLoading && (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              Showing results as you type
            </p>
          )}
        </div>

      </div>

      {/* Continue Reading Section - Below filters */}
      {extensionId && !searchInput && (
        <ContinueReadingSection extensionId={extensionId} />
      )}

      {/* Search Results */}
      {searchInput && (
        <div>
          {searchResults.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold mb-4">
                Search Results ({searchResults.length} results)
              </h2>
              <div className={`grid ${gridClasses}`}>
                {searchResults.map((item) => (
                  <MediaCard
                    key={item.id}
                    media={item}
                    onClick={() => setSelectedManga(item)}
                    status={getStatus(item.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {!searchLoading && searchInput && searchResults.length === 0 && (
            <div className="text-center py-12">
              <p className="text-[var(--color-text-secondary)]">
                No manga found for "{searchInput}"
              </p>
            </div>
          )}
        </div>
      )}

      {/* Recommendations / Browse */}
      {!searchInput && (
        <div>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            {hasReadingHistory && userReadingGenres.length > 0 ? (
              <>
                <Sparkles className="w-5 h-5 text-[var(--color-accent-primary)]" />
                Recommended for You
              </>
            ) : (
              'Popular Manga'
            )}
          </h2>

          {recommendationsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
            </div>
          ) : recommendations.length > 0 ? (
            <>
              <div className={`grid ${gridClasses}`}>
                {recommendations.map((item) => (
                  <MediaCard
                    key={item.id}
                    media={item}
                    onClick={() => setSelectedManga(item)}
                    status={getStatus(item.id)}
                  />
                ))}
              </div>

              {/* Infinite scroll sentinel */}
              <div ref={loadMoreRef} className="py-8 flex items-center justify-center">
                {loadingMore && (
                  <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
                )}
                {!hasNextPage && recommendations.length > 0 && (
                  <p className="text-sm text-[var(--color-text-muted)]">
                    You've reached the end
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <p className="text-[var(--color-text-secondary)]">
                No manga found
              </p>
            </div>
          )}
        </div>
      )}

      {/* Manga Detail Modal */}
      {selectedManga && extensionId && (
        <MangaDetailModal
          manga={selectedManga}
          extensionId={extensionId}
          onClose={() => {
            setSelectedManga(null)
            // Refresh status to update badges if user changed library/favorite status
            refreshStatus()
          }}
        />
      )}
    </div>
  )
}
