import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Loader2, AlertCircle, X, Sparkles } from 'lucide-react'
import { useMediaStore } from '@/store/mediaStore'
import {
  loadExtension,
  discoverAnime,
  getContinueWatchingWithDetails,
  streamDiscoverAnime,
  onAnimeDiscoverResults,
  type DiscoverResultsEvent,
} from '@/utils/tauri-commands'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { ContinueWatchingSection } from '@/components/media/ContinueWatchingSection'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import type { SearchResult } from '@/types/extension'
import { useSettingsStore } from '@/store/settingsStore'

// Debounce delay for instant search (ms)
const SEARCH_DEBOUNCE_MS = 300

export const Route = createFileRoute('/anime')({
  component: AnimeScreen,
})

// Use real AllAnime extension
const EXTENSION_CODE = ALLANIME_EXTENSION

function AnimeScreen() {
  const gridDensity = useSettingsStore((state) => state.gridDensity)
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const { getStatus, refresh: refreshStatus } = useMediaStatusContext()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const [extensionId, setExtensionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null)
  const [recommendations, setRecommendations] = useState<SearchResult[]>([])
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(true)
  const [userWatchingGenres, setUserWatchingGenres] = useState<string[]>([])
  const [hasWatchHistory, setHasWatchHistory] = useState(false)

  // Grid density class mapping (extended for 4K displays)
  const gridClasses = {
    compact: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 5xl:grid-cols-14 gap-2',
    comfortable: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 3xl:grid-cols-8 4xl:grid-cols-10 5xl:grid-cols-12 gap-4',
    spacious: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-8 5xl:grid-cols-10 gap-6',
  }[gridDensity]

  const {
    searchQuery,
    searchResults,
    searchLoading,
    searchError,
    search,
    clearSearch,
  } = useMediaStore()

  // Load AllAnime extension on mount
  useEffect(() => {
    const initExtension = async () => {
      try {
        const metadata = await loadExtension(EXTENSION_CODE)
        setExtensionId(metadata.id)
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load extension')
        setLoading(false)
      }
    }

    initExtension()
  }, [])

  // Load user's watching genres for personalized recommendations
  useEffect(() => {
    const loadUserGenres = async () => {
      try {
        const continueWatching = await getContinueWatchingWithDetails(20)
        console.log('[Anime] Continue watching entries:', continueWatching.length)

        if (continueWatching.length > 0) {
          setHasWatchHistory(true)

          // Count genre occurrences from all watching history
          const genreCounts = new Map<string, number>()
          continueWatching.forEach(entry => {
            console.log('[Anime] Entry genres for', entry.media.title, ':', entry.media.genres)
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

          console.log('[Anime] Top genres from watch history:', sortedGenres, 'counts:', Object.fromEntries(genreCounts))
          setUserWatchingGenres(sortedGenres)
        }
      } catch (err) {
        console.error('Failed to load user watching genres:', err)
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
        const unsub = await onAnimeDiscoverResults((event) => {
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
        await streamDiscoverAnime(extensionId, 'score', userWatchingGenres, nsfwFilter, 3)
      } catch (err) {
        console.error('Failed to stream anime:', err)
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
  }, [extensionId, userWatchingGenres, nsfwFilter])

  // Load more recommendations when scrolling to bottom
  // SSE loads pages 1-3 initially, so infinite scroll starts from page 4
  const loadMoreRecommendations = useCallback(async () => {
    if (!extensionId || loadingMore || !hasNextPage || searchInput) return

    setLoadingMore(true)
    try {
      // Start from page after SSE (which loads pages 1-3)
      const nextPage = Math.max(currentPage + 1, 4)
      const results = await discoverAnime(extensionId, nextPage, 'score', userWatchingGenres, nsfwFilter)

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
      console.error('Failed to load more anime:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [extensionId, currentPage, hasNextPage, loadingMore, searchInput, userWatchingGenres, nsfwFilter])

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

  // Debounced instant search - triggers as user types
  useEffect(() => {
    if (!extensionId) return

    // If input is empty, clear search results
    if (!searchInput.trim()) {
      if (searchQuery) {
        clearSearch()
      }
      return
    }

    // Debounce the search
    const timer = setTimeout(() => {
      search(extensionId, searchInput, 1, nsfwFilter)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, extensionId, nsfwFilter])

  // Clear search input
  const handleClearSearch = useCallback(() => {
    setSearchInput('')
    clearSearch()
    searchInputRef.current?.focus()
  }, [clearSearch])

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
        <h1 className="text-3xl font-bold mb-6">Anime Browser</h1>

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
              placeholder="Search for anime..."
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

      {/* Continue Watching Section - Below search */}
      {extensionId && !searchInput && (
        <ContinueWatchingSection extensionId={extensionId} />
      )}

      {/* Search Results */}
      {searchInput && (
        <div>
          {/* Results */}
          {searchResults.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold mb-4">
                Search Results for "{searchQuery}" ({searchResults.length} results)
              </h2>
              <div className={`grid ${gridClasses}`}>
                {searchResults.map((item) => (
                  <MediaCard
                    key={item.id}
                    media={item}
                    onClick={() => setSelectedMedia(item)}
                    status={getStatus(item.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Error State */}
          {searchError && (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 text-[var(--color-accent-primary)] mx-auto mb-3" />
              <p className="text-[var(--color-text-secondary)]">{searchError}</p>
            </div>
          )}

          {/* No Results */}
          {!searchLoading && searchResults.length === 0 && !searchError && searchQuery && (
            <div className="text-center py-12">
              <p className="text-lg text-[var(--color-text-secondary)]">
                No results found for "{searchQuery}"
              </p>
            </div>
          )}
        </div>
      )}

      {/* Recommendations / Browse */}
      {!searchInput && (
        <div>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            {hasWatchHistory && userWatchingGenres.length > 0 ? (
              <>
                <Sparkles className="w-5 h-5 text-[var(--color-accent-primary)]" />
                Recommended for You
              </>
            ) : (
              'Popular Anime'
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
                    onClick={() => setSelectedMedia(item)}
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
                No anime found
              </p>
            </div>
          )}
        </div>
      )}

      {/* Media Detail Modal */}
      {selectedMedia && extensionId && (
        <MediaDetailModal
          media={selectedMedia}
          extensionId={extensionId}
          isOpen={true}
          onClose={() => {
            setSelectedMedia(null)
            // Refresh status to update badges if user changed library/favorite status
            refreshStatus()
          }}
          onMediaChange={setSelectedMedia}
        />
      )}
    </div>
  )
}
