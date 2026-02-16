import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Loader2, AlertCircle, X, Sparkles, Calendar, Star } from 'lucide-react'
import { useMediaStore } from '@/store/mediaStore'
import {
  loadExtension,
  jikanTopAnime,
  jikanSeasonNow,
  jikanSeason,
  getContinueWatchingWithDetails,
  getDiscoverCache,
  saveDiscoverCache,
} from '@/utils/tauri-commands'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import type { SearchResult } from '@/types/extension'
import { useSettingsStore } from '@/store/settingsStore'
import { filterNsfwContent } from '@/utils/nsfw-filter'

// Debounce delay for instant search (ms)
const SEARCH_DEBOUNCE_MS = 300

/**
 * Calculate the current anime season based on date.
 * Anime seasons: Winter (Jan-Mar), Spring (Apr-Jun), Summer (Jul-Sep), Fall (Oct-Dec)
 */
function getCurrentAnimeSeason(): { season: string; year: number } {
  const now = new Date()
  const month = now.getMonth() // 0-indexed
  const year = now.getFullYear()

  // Determine season based on month
  if (month >= 0 && month <= 2) {
    return { season: 'Winter', year }
  } else if (month >= 3 && month <= 5) {
    return { season: 'Spring', year }
  } else if (month >= 6 && month <= 8) {
    return { season: 'Summer', year }
  } else {
    return { season: 'Fall', year }
  }
}

export const Route = createFileRoute('/anime')({
  component: AnimeScreen,
})

type TabType = 'browse' | 'season'

function AnimeScreen() {
  const gridDensity = useSettingsStore((state) => state.gridDensity)
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const { getStatus, refresh: refreshStatus } = useMediaStatusContext()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const seasonLoadMoreRef = useRef<HTMLDivElement>(null)
  const [allanimeExtId, setAllanimeExtId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null)
  const [recommendations, setRecommendations] = useState<SearchResult[]>([])
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(true)
  const [userWatchingGenres, setUserWatchingGenres] = useState<string[]>([])
  const [hasWatchHistory, setHasWatchHistory] = useState(false)

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('browse')

  // Current season info (for tab label) - calculated from current date
  const [currentSeasonInfo] = useState<{ season: string; year: number }>(getCurrentAnimeSeason)

  // Season browser selection state
  const seasonOptions = ['winter', 'spring', 'summer', 'fall']
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: currentYear - 1999 }, (_, i) => currentYear - i)
  const [selectedYear, setSelectedYear] = useState(currentSeasonInfo.year)
  const [selectedSeason, setSelectedSeason] = useState(currentSeasonInfo.season.toLowerCase())

  // Full season state (for Season tab with infinite scroll)
  const [fullSeasonAnime, setFullSeasonAnime] = useState<SearchResult[]>([])
  const [fullSeasonLoading, setFullSeasonLoading] = useState(false)
  const [fullSeasonPage, setFullSeasonPage] = useState(1)
  const [fullSeasonHasNextPage, setFullSeasonHasNextPage] = useState(true)
  const [fullSeasonLoadingMore, setFullSeasonLoadingMore] = useState(false)
  const fullSeasonSeenIdsRef = useRef<Set<string>>(new Set())
  const fullSeasonLoadedRef = useRef(false) // Track if initial load has happened
  const prevNsfwFilterRef = useRef(nsfwFilter) // Track previous nsfwFilter

  // Reset season data when nsfwFilter or season/year selection changes
  useEffect(() => {
    if (prevNsfwFilterRef.current !== nsfwFilter) {
      prevNsfwFilterRef.current = nsfwFilter
      fullSeasonLoadedRef.current = false
      setFullSeasonAnime([])
      fullSeasonSeenIdsRef.current.clear()
    }
  }, [nsfwFilter])

  // Reset and reload when season/year selection changes
  useEffect(() => {
    fullSeasonLoadedRef.current = false
    setFullSeasonAnime([])
    fullSeasonSeenIdsRef.current.clear()
  }, [selectedYear, selectedSeason])

  // Grid density class mapping (extended for 4K displays)
  // Added p-4 -m-4 to allow cards to scale on hover without being clipped
  const gridClasses = {
    compact: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 5xl:grid-cols-14 gap-x-2 gap-y-6 p-4 -m-4',
    comfortable: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 3xl:grid-cols-8 4xl:grid-cols-10 5xl:grid-cols-12 gap-x-4 gap-y-8 p-4 -m-4',
    spacious: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-8 5xl:grid-cols-10 gap-x-6 gap-y-10 p-4 -m-4',
  }[gridDensity]

  const {
    searchQuery,
    searchResults: rawSearchResults,
    searchLoading,
    searchError,
    search,
    clearSearch,
  } = useMediaStore()

  // Filter NSFW content from search results on the frontend
  // Filter NSFW content from search results using both genres and title keywords
  const searchResults = filterNsfwContent(rawSearchResults, (item) => item.genres, nsfwFilter, (item) => item.title)

  // Load AllAnime extension lazily in background (for modal downloads)
  useEffect(() => {
    loadExtension(ALLANIME_EXTENSION)
      .then(metadata => setAllanimeExtId(metadata.id))
      .catch(() => {})
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

  // Load full season anime via Jikan API when Season tab is activated (API first, cache fallback)
  useEffect(() => {
    if (activeTab !== 'season') return

    // Only load if we haven't loaded yet (use ref to avoid dependency issues)
    if (fullSeasonLoadedRef.current) return
    fullSeasonLoadedRef.current = true

    const isCurrentSeason = selectedYear === currentSeasonInfo.year &&
      selectedSeason === currentSeasonInfo.season.toLowerCase()
    const cacheKey = `anime:season:${selectedYear}:${selectedSeason}`

    const loadSeasonAnime = async () => {
      setFullSeasonLoading(true)
      setFullSeasonAnime([])
      fullSeasonSeenIdsRef.current.clear()
      setFullSeasonPage(1)
      setFullSeasonHasNextPage(true)

      try {
        const results = isCurrentSeason
          ? await jikanSeasonNow(1, nsfwFilter)
          : await jikanSeason(selectedYear, selectedSeason, 1, nsfwFilter)

        const uniqueResults = results.results.filter(item => {
          if (fullSeasonSeenIdsRef.current.has(item.id)) return false
          fullSeasonSeenIdsRef.current.add(item.id)
          return true
        })

        setFullSeasonAnime(uniqueResults.sort((a, b) => (b.rating || 0) - (a.rating || 0)))
        setFullSeasonPage(1)
        setFullSeasonHasNextPage(results.has_next_page)

        // Save to cache
        saveDiscoverCache(cacheKey, JSON.stringify(uniqueResults), 'anime').catch(() => {})
      } catch (err) {
        console.error('Failed to load season anime, trying cache:', err)

        try {
          const cached = await getDiscoverCache(cacheKey)
          if (cached) {
            const cachedResults: SearchResult[] = JSON.parse(cached.data)
            const uniqueCached = cachedResults.filter(item => {
              if (fullSeasonSeenIdsRef.current.has(item.id)) return false
              fullSeasonSeenIdsRef.current.add(item.id)
              return true
            })
            if (uniqueCached.length > 0) {
              setFullSeasonAnime(uniqueCached.sort((a, b) => (b.rating || 0) - (a.rating || 0)))
            }
          }
        } catch {
          // Cache also failed
        }
      } finally {
        setFullSeasonLoading(false)
      }
    }

    loadSeasonAnime()
  }, [activeTab, nsfwFilter, currentSeasonInfo, selectedYear, selectedSeason])

  // Load more season anime
  const loadMoreSeasonAnime = useCallback(async () => {
    if (fullSeasonLoadingMore || !fullSeasonHasNextPage) return

    setFullSeasonLoadingMore(true)
    try {
      const nextPage = fullSeasonPage + 1
      const isCurrentSeason = selectedYear === currentSeasonInfo.year &&
        selectedSeason === currentSeasonInfo.season.toLowerCase()
      const result = isCurrentSeason
        ? await jikanSeasonNow(nextPage, nsfwFilter)
        : await jikanSeason(selectedYear, selectedSeason, nextPage, nsfwFilter)

      // Deduplicate
      const newResults = result.results.filter(item => {
        if (fullSeasonSeenIdsRef.current.has(item.id)) return false
        fullSeasonSeenIdsRef.current.add(item.id)
        return true
      })

      // Add new results and re-sort entire list
      setFullSeasonAnime(prev => {
        const combined = [...prev, ...newResults]
        return combined.sort((a, b) => (b.rating || 0) - (a.rating || 0))
      })
      setFullSeasonPage(nextPage)
      setFullSeasonHasNextPage(result.has_next_page)
    } catch (err) {
      console.error('Failed to load more season anime:', err)
    } finally {
      setFullSeasonLoadingMore(false)
    }
  }, [fullSeasonPage, fullSeasonHasNextPage, fullSeasonLoadingMore, nsfwFilter, selectedYear, selectedSeason, currentSeasonInfo])

  // Intersection observer for season tab infinite scroll
  useEffect(() => {
    if (activeTab !== 'season') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && fullSeasonHasNextPage && !fullSeasonLoadingMore && !fullSeasonLoading) {
          loadMoreSeasonAnime()
        }
      },
      { threshold: 0.1 }
    )

    if (seasonLoadMoreRef.current) {
      observer.observe(seasonLoadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [activeTab, fullSeasonHasNextPage, fullSeasonLoadingMore, fullSeasonLoading, loadMoreSeasonAnime])

  // Track seen IDs to avoid duplicates
  const seenIdsRef = useRef<Set<string>>(new Set())

  // Cache key ref for browse results (updated when genres/filters change)
  const browseCacheKeyRef = useRef('')
  const recommendationsLoadedRef = useRef(false)
  const prevRecNsfwRef = useRef(nsfwFilter)

  // Reset browse data when nsfwFilter changes after initial load
  useEffect(() => {
    if (prevRecNsfwRef.current !== nsfwFilter) {
      prevRecNsfwRef.current = nsfwFilter
      recommendationsLoadedRef.current = false
      setRecommendations([])
      seenIdsRef.current.clear()
    }
  }, [nsfwFilter])

  // Load recommendations via Jikan API (API first with cache fallback)
  useEffect(() => {
    if (recommendationsLoadedRef.current) return
    recommendationsLoadedRef.current = true

    const cacheKey = 'anime:browse:top'
    browseCacheKeyRef.current = cacheKey

    // Only show loading if we have no existing data
    setRecommendationsLoading(true)
    seenIdsRef.current.clear()
    setCurrentPage(1)
    setHasNextPage(true)

    const loadRecommendations = async () => {
      try {
        const results = await jikanTopAnime(1, undefined, 'favorite', nsfwFilter)

        const uniqueResults = results.results.filter(item => {
          if (seenIdsRef.current.has(item.id)) return false
          seenIdsRef.current.add(item.id)
          return true
        })

        setRecommendations(uniqueResults)
        setCurrentPage(1)
        setHasNextPage(results.has_next_page)

        // Save to cache
        if (uniqueResults.length > 0) {
          saveDiscoverCache(cacheKey, JSON.stringify(uniqueResults), 'anime').catch(() => {})
        }
      } catch (err) {
        console.error('Failed to load anime, trying cache:', err)

        try {
          const cached = await getDiscoverCache(cacheKey)
          if (cached) {
            const cachedResults: SearchResult[] = JSON.parse(cached.data)
            const uniqueCached = cachedResults.filter(item => {
              if (seenIdsRef.current.has(item.id)) return false
              seenIdsRef.current.add(item.id)
              return true
            })
            if (uniqueCached.length > 0) {
              setRecommendations(uniqueCached)
            }
          }
        } catch {
          // Cache also failed
        }
      } finally {
        setRecommendationsLoading(false)
      }
    }

    loadRecommendations()
  }, [nsfwFilter])

  // Load more recommendations when scrolling to bottom
  const loadMoreRecommendations = useCallback(async () => {
    if (loadingMore || !hasNextPage || searchInput) return

    setLoadingMore(true)
    try {
      const nextPage = currentPage + 1
      const results = await jikanTopAnime(nextPage, undefined, 'favorite', nsfwFilter)

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
  }, [currentPage, hasNextPage, loadingMore, searchInput, nsfwFilter])

  // Intersection observer for infinite scroll (Browse tab)
  useEffect(() => {
    if (activeTab !== 'browse') return

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
  }, [activeTab, hasNextPage, loadingMore, recommendationsLoading, loadMoreRecommendations])

  // Debounced instant search - triggers as user types
  useEffect(() => {
    // If input is empty, clear search results
    if (!searchInput.trim()) {
      if (searchQuery) {
        clearSearch()
      }
      return
    }

    // Debounce the search
    const timer = setTimeout(() => {
      search(searchInput, 1, nsfwFilter)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, nsfwFilter])

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

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 sm:px-6 lg:px-8 3xl:px-12 py-8 max-w-4k mx-auto">
      {/* Search Header */}
      <div className="mb-6">
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

      {/* Search Results (shown when searching, hides tabs) */}
      {searchInput ? (
        <div>
          {/* Results */}
          {searchResults.length > 0 && (
            <div className="overflow-visible">
              <h2 className="text-xl font-semibold mb-4">
                Search Results for "{searchQuery}" ({searchResults.length} results)
              </h2>
              <div className={`grid ${gridClasses} overflow-visible`}>
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
      ) : (
        <>
          {/* Tab Navigation */}
          <div className="flex items-center gap-1 mb-6 border-b border-[var(--color-bg-hover)]">
            <button
              onClick={() => setActiveTab('browse')}
              className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab === 'browse'
                  ? 'text-[var(--color-accent-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Browse
              </span>
              {activeTab === 'browse' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-accent-primary)]" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('season')}
              className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab === 'season'
                  ? 'text-[var(--color-accent-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Seasons
              </span>
              {activeTab === 'season' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-accent-primary)]" />
              )}
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'browse' ? (
            // ========== BROWSE TAB ==========
            <div>
              {/* Recommendations / Popular */}
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
                  <div className="overflow-visible">
                    <div className={`grid ${gridClasses} overflow-visible`}>
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
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-[var(--color-text-secondary)]">
                      No anime found
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // ========== SEASON TAB ==========
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-6">
                {/* Season Chips */}
                <div className="flex gap-1.5">
                  {seasonOptions.map(s => (
                    <button
                      key={s}
                      onClick={() => setSelectedSeason(s)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        selectedSeason === s
                          ? 'bg-[var(--color-accent-primary)] text-white'
                          : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                      }`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Year Dropdown */}
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="bg-[var(--color-bg-secondary)] border border-[var(--color-bg-hover)]
                             rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-primary)]
                             focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]"
                >
                  {yearOptions.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>

                {/* Sort indicator */}
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] ml-auto">
                  <Star className="w-4 h-4 text-yellow-400" />
                  Sorted by Rating
                </div>
              </div>

              {fullSeasonLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
                </div>
              ) : fullSeasonAnime.length > 0 ? (
                <div className="overflow-visible">
                  <div className={`grid ${gridClasses} overflow-visible`}>
                    {fullSeasonAnime.map((item) => (
                      <MediaCard
                        key={item.id}
                        media={item}
                        onClick={() => setSelectedMedia(item)}
                        status={getStatus(item.id)}
                      />
                    ))}
                  </div>

                  {/* Infinite scroll sentinel */}
                  <div ref={seasonLoadMoreRef} className="py-8 flex items-center justify-center">
                    {fullSeasonLoadingMore && (
                      <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
                    )}
                    {!fullSeasonHasNextPage && fullSeasonAnime.length > 0 && (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        All {fullSeasonAnime.length} anime from {selectedSeason.charAt(0).toUpperCase() + selectedSeason.slice(1)} {selectedYear} loaded
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-[var(--color-text-secondary)]">
                    No anime found for {selectedSeason.charAt(0).toUpperCase() + selectedSeason.slice(1)} {selectedYear}
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Media Detail Modal */}
      {selectedMedia && (
        <MediaDetailModal
          media={selectedMedia}
          extensionId={allanimeExtId || undefined}
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
