import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Loader2, AlertCircle, X, ChevronDown, ChevronUp, Filter } from 'lucide-react'
import { useMediaStore } from '@/store/mediaStore'
import { loadExtension, getRecommendations, discoverAnime, getTags, type Tag } from '@/utils/tauri-commands'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
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
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [extensionId, setExtensionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null)
  const [recommendations, setRecommendations] = useState<SearchResult[]>([])
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [availableTags, setAvailableTags] = useState<Tag[]>([])
  const [_availableStudios, setAvailableStudios] = useState<Tag[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [showAllGenres, setShowAllGenres] = useState(false)
  const [filterExpanded, setFilterExpanded] = useState(true)

  // Toggle genre selection
  const toggleGenre = useCallback((genre: string) => {
    setSelectedGenres(prev =>
      prev.includes(genre)
        ? prev.filter(g => g !== genre)
        : [...prev, genre]
    )
  }, [])

  // Clear all genre selections
  const clearGenres = useCallback(() => {
    setSelectedGenres([])
  }, [])

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

  // Load available tags when extension is ready
  useEffect(() => {
    const loadTags = async () => {
      if (!extensionId) return

      setTagsLoading(true)
      try {
        // Load multiple pages to get more tags
        const allGenres: Tag[] = []
        const allStudios: Tag[] = []

        for (let page = 1; page <= 3; page++) {
          const result = await getTags(extensionId, page)
          allGenres.push(...result.genres)
          allStudios.push(...result.studios)
          if (!result.has_next_page) break
        }

        // Deduplicate and sort by count
        const uniqueGenres = Array.from(new Map(allGenres.map(t => [t.slug, t])).values())
          .sort((a, b) => b.count - a.count)
        const uniqueStudios = Array.from(new Map(allStudios.map(t => [t.slug, t])).values())
          .sort((a, b) => b.count - a.count)

        setAvailableTags(uniqueGenres)
        setAvailableStudios(uniqueStudios)
      } catch (err) {
        console.error('Failed to load tags:', err)
      } finally {
        setTagsLoading(false)
      }
    }

    loadTags()
  }, [extensionId])

  // Load recommendations or filtered results when extension is ready or genres change
  useEffect(() => {
    const loadAnime = async () => {
      if (!extensionId) return

      setRecommendationsLoading(true)
      try {
        let results
        if (selectedGenres.length > 0) {
          // Filter by genres using discover endpoint
          results = await discoverAnime(extensionId, 1, 'score', selectedGenres)
        } else {
          // Default recommendations
          results = await getRecommendations(extensionId)
        }

        // Deduplicate results by ID to avoid React key warnings
        const uniqueResults = results.results.reduce((acc, item) => {
          if (!acc.find(existing => existing.id === item.id)) {
            acc.push(item)
          }
          return acc
        }, [] as SearchResult[])

        setRecommendations(uniqueResults)
      } catch (err) {
        console.error('Failed to load anime:', err)
      } finally {
        setRecommendationsLoading(false)
      }
    }

    loadAnime()
  }, [extensionId, selectedGenres])

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
      search(extensionId, searchInput, 1)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, extensionId])

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

        {/* Genre Filter - only show when not searching */}
        {!searchInput && (
          <div className="mt-6">
            {/* Filter Header */}
            <button
              onClick={() => setFilterExpanded(!filterExpanded)}
              className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-white transition-colors mb-3"
            >
              <Filter size={18} />
              <span className="font-medium">Filters</span>
              {selectedGenres.length > 0 && (
                <span className="px-2 py-0.5 bg-[var(--color-accent-primary)] text-white text-xs rounded-full">
                  {selectedGenres.length}
                </span>
              )}
              {filterExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {filterExpanded && (
              <div className="space-y-4">
                {/* Tags loading state */}
                {tagsLoading ? (
                  <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading genres...</span>
                  </div>
                ) : (
                  <>
                    {/* Genre chips */}
                    <div className="flex flex-wrap gap-2">
                      {/* All button to clear filters */}
                      <button
                        onClick={clearGenres}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                          selectedGenres.length === 0
                            ? 'bg-[var(--color-accent-primary)] text-white'
                            : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                        }`}
                      >
                        All
                      </button>

                      {/* Dynamic genre chips from API */}
                      {(showAllGenres ? availableTags : availableTags.slice(0, 20)).map((tag) => (
                        <button
                          key={tag.slug}
                          onClick={() => toggleGenre(tag.name)}
                          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-2 ${
                            selectedGenres.includes(tag.name)
                              ? 'bg-[var(--color-accent-primary)] text-white'
                              : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                          }`}
                        >
                          <span>{tag.name}</span>
                          <span className={`text-xs ${
                            selectedGenres.includes(tag.name)
                              ? 'text-white/70'
                              : 'text-[var(--color-text-muted)]'
                          }`}>
                            {tag.count.toLocaleString()}
                          </span>
                        </button>
                      ))}

                      {/* Show more/less button */}
                      {availableTags.length > 20 && (
                        <button
                          onClick={() => setShowAllGenres(!showAllGenres)}
                          className="px-4 py-2 rounded-full text-sm font-medium bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-white transition-colors"
                        >
                          {showAllGenres ? 'Show Less' : `+${availableTags.length - 20} More`}
                        </button>
                      )}
                    </div>

                    {/* Selected genres summary */}
                    {selectedGenres.length > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-[var(--color-text-muted)]">
                          Filtering by:
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {selectedGenres.map(genre => (
                            <span
                              key={genre}
                              className="px-2 py-1 bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-primary)] rounded text-xs font-medium flex items-center gap-1"
                            >
                              {genre}
                              <button
                                onClick={() => toggleGenre(genre)}
                                className="hover:text-white"
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        </div>
                        <button
                          onClick={clearGenres}
                          className="text-[var(--color-text-muted)] hover:text-white text-xs underline"
                        >
                          Clear all
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

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

      {/* Recommendations / Empty State */}
      {!searchInput && (
        <div>
          {recommendationsLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-12 h-12 animate-spin text-[var(--color-accent-primary)] mb-4" />
              <p className="text-lg text-[var(--color-text-secondary)]">
                {selectedGenres.length > 0
                  ? `Finding ${selectedGenres.slice(0, 2).join(' & ')} anime...`
                  : 'Loading recommendations...'}
              </p>
            </div>
          ) : recommendations.length > 0 ? (
            <div>
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <svg className="w-7 h-7 text-[var(--color-accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {selectedGenres.length > 0
                  ? `${selectedGenres.slice(0, 3).join(' & ')}${selectedGenres.length > 3 ? ` +${selectedGenres.length - 3}` : ''} Anime`
                  : 'Recommended Anime'}
              </h2>
              <div className={`grid ${gridClasses}`}>
                {recommendations.map((item) => (
                  <MediaCard
                    key={item.id}
                    media={item}
                    onClick={() => setSelectedMedia(item)}
                  />
                ))}
              </div>
            </div>
          ) : selectedGenres.length > 0 ? (
            <div className="text-center py-20">
              <div className="text-6xl mb-6">🎭</div>
              <h2 className="text-2xl font-semibold mb-3">No Results Found</h2>
              <p className="text-[var(--color-text-secondary)] max-w-md mx-auto">
                No anime found for the selected genres. Try selecting fewer genres or different combinations.
              </p>
              <button
                onClick={clearGenres}
                className="mt-6 px-6 py-2 bg-[var(--color-accent-primary)] text-white rounded-lg hover:bg-[var(--color-accent-primary-hover)] transition-colors"
              >
                Clear Filters
              </button>
            </div>
          ) : (
            <div className="text-center py-20">
              <div className="text-6xl mb-6">🔍</div>
              <h2 className="text-2xl font-semibold mb-3">Start Searching</h2>
              <p className="text-[var(--color-text-secondary)] max-w-md mx-auto">
                Use the search bar above to find anime. Try searching for "Demon Slayer", "Naruto", or any other anime title!
              </p>
              <p className="mt-4 text-sm text-[var(--color-text-muted)]">
                Using: AllAnime (Real Data)
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
          onClose={() => setSelectedMedia(null)}
          onMediaChange={setSelectedMedia}
        />
      )}
    </div>
  )
}
