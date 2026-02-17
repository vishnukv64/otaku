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
} from '@/utils/tauri-commands'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import { useJikanQuery, CACHE_TTL } from '@/hooks/useJikanQuery'
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

  // Browse tab infinite scroll state (pages 2+)
  const [browseExtraItems, setBrowseExtraItems] = useState<SearchResult[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [browseHasNextPage, setBrowseHasNextPage] = useState(true)
  const browseSeenIdsRef = useRef<Set<string>>(new Set())

  // Personalized recommendations state
  const [userWatchingGenres, setUserWatchingGenres] = useState<string[]>([])
  const [hasWatchHistory, setHasWatchHistory] = useState(false)

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('browse')

  // Current season info (for tab label)
  const [currentSeasonInfo] = useState<{ season: string; year: number }>(getCurrentAnimeSeason)

  // Season browser selection state
  const seasonOptions = ['winter', 'spring', 'summer', 'fall']
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: currentYear - 1999 }, (_, i) => currentYear - i)
  const [selectedYear, setSelectedYear] = useState(currentSeasonInfo.year)
  const [selectedSeason, setSelectedSeason] = useState(currentSeasonInfo.season.toLowerCase())

  // Season tab infinite scroll state (pages 2+)
  const [seasonExtraItems, setSeasonExtraItems] = useState<SearchResult[]>([])
  const [fullSeasonLoadingMore, setFullSeasonLoadingMore] = useState(false)
  const [fullSeasonPage, setFullSeasonPage] = useState(1)
  const [fullSeasonHasNextPage, setFullSeasonHasNextPage] = useState(true)
  const fullSeasonSeenIdsRef = useRef<Set<string>>(new Set())

  // Grid density class mapping
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

  // Filter NSFW content from search results
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

          const genreCounts = new Map<string, number>()
          continueWatching.forEach(entry => {
            console.log('[Anime] Entry genres for', entry.media.title, ':', entry.media.genres)
            if (entry.media.genres) {
              try {
                const genres = JSON.parse(entry.media.genres)
                if (Array.isArray(genres)) {
                  genres.forEach((g: string) => {
                    genreCounts.set(g, (genreCounts.get(g) || 0) + 1)
                  })
                }
              } catch {
                entry.media.genres.split(',').forEach(g => {
                  const genre = g.trim()
                  genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1)
                })
              }
            }
          })

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

  // === BROWSE TAB: SWR hook for page 1 ===
  const browseAnime = useJikanQuery({
    cacheKey: `anime:browse:top:sfw=${nsfwFilter}`,
    fetcher: () => jikanTopAnime(1, undefined, 'favorite', nsfwFilter),
    ttlSeconds: CACHE_TTL.POPULAR,
    mediaType: 'anime',
    enabled: activeTab === 'browse' && !searchQuery,
  })

  // Sync browse hook's hasNextPage and reset extra items when hook data changes
  useEffect(() => {
    setBrowseHasNextPage(browseAnime.hasNextPage)
    // Reset pagination when hook data reloads (e.g., filter change)
    setBrowseExtraItems([])
    setCurrentPage(1)
    browseSeenIdsRef.current.clear()
    // Populate seen IDs from hook data
    browseAnime.data.forEach(item => browseSeenIdsRef.current.add(item.id))
  }, [browseAnime.data, browseAnime.hasNextPage])

  // Combined browse items: hook page 1 + extra pages
  const recommendations = [...browseAnime.data, ...browseExtraItems]
  const recommendationsLoading = browseAnime.loading
  const hasNextPage = browseHasNextPage

  // === SEASON TAB: SWR hook for page 1 ===
  const isCurrentSeason = selectedYear === currentSeasonInfo.year &&
    selectedSeason === currentSeasonInfo.season.toLowerCase()

  const seasonAnime = useJikanQuery({
    cacheKey: `anime:season:${selectedYear}:${selectedSeason}:sfw=${nsfwFilter}`,
    fetcher: () => isCurrentSeason
      ? jikanSeasonNow(1, nsfwFilter)
      : jikanSeason(selectedYear, selectedSeason, 1, nsfwFilter),
    ttlSeconds: isCurrentSeason ? CACHE_TTL.AIRING : CACHE_TTL.SEASON_ARCHIVE,
    mediaType: 'anime',
    enabled: activeTab === 'season',
  })

  // Sync season hook's hasNextPage and reset extra items when hook data changes
  useEffect(() => {
    setFullSeasonHasNextPage(seasonAnime.hasNextPage)
    setSeasonExtraItems([])
    setFullSeasonPage(1)
    fullSeasonSeenIdsRef.current.clear()
    seasonAnime.data.forEach(item => fullSeasonSeenIdsRef.current.add(item.id))
  }, [seasonAnime.data, seasonAnime.hasNextPage])

  // Combined season items: hook page 1 + extra pages, sorted by rating
  const fullSeasonAnime = [...seasonAnime.data, ...seasonExtraItems]
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
  const fullSeasonLoading = seasonAnime.loading

  // Load more browse anime (pages 2+)
  const loadMoreRecommendations = useCallback(async () => {
    if (loadingMore || !browseHasNextPage || searchInput) return

    setLoadingMore(true)
    try {
      const nextPage = currentPage + 1
      const results = await jikanTopAnime(nextPage, undefined, 'favorite', nsfwFilter)

      const newResults = results.results.filter(item => {
        if (browseSeenIdsRef.current.has(item.id)) return false
        browseSeenIdsRef.current.add(item.id)
        return true
      })

      setBrowseExtraItems(prev => [...prev, ...newResults])
      setCurrentPage(nextPage)
      setBrowseHasNextPage(results.has_next_page)
    } catch (err) {
      console.error('Failed to load more anime:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [currentPage, browseHasNextPage, loadingMore, searchInput, nsfwFilter])

  // Load more season anime (pages 2+)
  const loadMoreSeasonAnime = useCallback(async () => {
    if (fullSeasonLoadingMore || !fullSeasonHasNextPage) return

    setFullSeasonLoadingMore(true)
    try {
      const nextPage = fullSeasonPage + 1
      const result = isCurrentSeason
        ? await jikanSeasonNow(nextPage, nsfwFilter)
        : await jikanSeason(selectedYear, selectedSeason, nextPage, nsfwFilter)

      const newResults = result.results.filter(item => {
        if (fullSeasonSeenIdsRef.current.has(item.id)) return false
        fullSeasonSeenIdsRef.current.add(item.id)
        return true
      })

      setSeasonExtraItems(prev => [...prev, ...newResults])
      setFullSeasonPage(nextPage)
      setFullSeasonHasNextPage(result.has_next_page)
    } catch (err) {
      console.error('Failed to load more season anime:', err)
    } finally {
      setFullSeasonLoadingMore(false)
    }
  }, [fullSeasonPage, fullSeasonHasNextPage, fullSeasonLoadingMore, nsfwFilter, selectedYear, selectedSeason, isCurrentSeason])

  // Intersection observer for infinite scroll (Browse tab)
  useEffect(() => {
    if (activeTab !== 'browse') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && browseHasNextPage && !loadingMore && !recommendationsLoading) {
          loadMoreRecommendations()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [activeTab, browseHasNextPage, loadingMore, recommendationsLoading, loadMoreRecommendations])

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

  // Debounced instant search
  useEffect(() => {
    if (!searchInput.trim()) {
      if (searchQuery) {
        clearSearch()
      }
      return
    }

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
            refreshStatus()
          }}
          onMediaChange={setSelectedMedia}
        />
      )}
    </div>
  )
}
