/**
 * Manga Route - Manga Browser Page
 *
 * Browse, search, and discover manga with Jikan API-powered carousels.
 * Uses SWR caching via useJikanQuery for instant page loads.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Loader2, X, BookOpen, Tag as TagIcon } from 'lucide-react'
import {
  loadExtension,
  jikanTopManga,
  jikanSearchManga,
  jikanGenresManga,
  jikanSearchMangaFiltered,
} from '@/utils/tauri-commands'
import type { Tag } from '@/utils/tauri-commands'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaCarousel } from '@/components/media/MediaCarousel'
import { MangaDetailModal } from '@/components/media/MangaDetailModal'
import { ContinueReadingSection } from '@/components/media/ContinueReadingSection'
import { GenreFilterBar } from '@/components/media/GenreFilterBar'
import { ALLANIME_MANGA_EXTENSION } from '@/extensions/allanime-manga-extension'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import { useJikanQuery, CACHE_TTL } from '@/hooks/useJikanQuery'
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

  const genreLoadMoreRef = useRef<HTMLDivElement>(null)
  const [allanimeExtensionId, setAllanimeExtensionId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedManga, setSelectedManga] = useState<SearchResult | null>(null)

  // Restore modal state when returning from read page
  useEffect(() => {
    const saved = sessionStorage.getItem('otaku_return_manga')
    if (saved) {
      sessionStorage.removeItem('otaku_return_manga')
      try {
        setSelectedManga(JSON.parse(saved))
      } catch { /* ignore parse errors */ }
    }
  }, [])

  const [showGenres, setShowGenres] = useState(false)

  // Genre state
  const [mangaGenres, setMangaGenres] = useState<Tag[]>([])
  const [genresLoading, setGenresLoading] = useState(false)
  const [selectedGenreIds, setSelectedGenreIds] = useState<Set<number>>(new Set())
  const [genreFilters, setGenreFilters] = useState({ orderBy: '', sort: 'desc', status: '', type: '' })
  const [genreResults, setGenreResults] = useState<SearchResult[]>([])
  const [genreResultsLoading, setGenreResultsLoading] = useState(false)
  const [genrePage, setGenrePage] = useState(1)
  const [genreHasNextPage, setGenreHasNextPage] = useState(true)
  const [genreLoadingMore, setGenreLoadingMore] = useState(false)
  const genreSeenIdsRef = useRef<Set<string>>(new Set())

  // Grid density class mapping for search results grid
  const gridClasses = {
    compact: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 5xl:grid-cols-14 gap-x-2 gap-y-6 p-4 -m-4',
    comfortable: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 3xl:grid-cols-8 4xl:grid-cols-10 5xl:grid-cols-12 gap-x-4 gap-y-8 p-4 -m-4',
    spacious: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-8 5xl:grid-cols-10 gap-x-6 gap-y-10 p-4 -m-4',
  }[gridDensity]

  // Load AllAnime extension lazily (for ContinueReadingSection + MangaDetailModal)
  useEffect(() => {
    loadExtension(ALLANIME_MANGA_EXTENSION)
      .then(metadata => setAllanimeExtensionId(metadata.id))
      .catch(() => {})
  }, [])

  // SWR-cached data for each section (nsfwFilter in key for filter isolation)
  const trending = useJikanQuery({
    cacheKey: `manga:trending:sfw=${nsfwFilter}`,
    fetcher: () => jikanTopManga(1, undefined, undefined, nsfwFilter),
    ttlSeconds: CACHE_TTL.TOP_RATED,
    mediaType: 'manga',
  })

  const popular = useJikanQuery({
    cacheKey: `manga:popular:sfw=${nsfwFilter}`,
    fetcher: () => jikanTopManga(1, undefined, 'bypopularity', nsfwFilter),
    ttlSeconds: CACHE_TTL.POPULAR,
    mediaType: 'manga',
  })

  const favorite = useJikanQuery({
    cacheKey: `manga:favorite:sfw=${nsfwFilter}`,
    fetcher: () => jikanTopManga(1, undefined, 'favorite', nsfwFilter),
    ttlSeconds: CACHE_TTL.POPULAR,
    mediaType: 'manga',
  })

  const publishing = useJikanQuery({
    cacheKey: `manga:publishing:sfw=${nsfwFilter}`,
    fetcher: () => jikanTopManga(1, undefined, 'publishing', nsfwFilter),
    ttlSeconds: CACHE_TTL.AIRING,
    mediaType: 'manga',
  })

  // Debounced instant search via Jikan API
  useEffect(() => {
    if (!searchInput.trim()) {
      setSearchResults([])
      return
    }

    setSearchLoading(true)
    const timer = setTimeout(async () => {
      try {
        const results = await jikanSearchManga(searchInput, 1, nsfwFilter)
        const filtered = filterNsfwContent(results.results, (item) => item.genres, nsfwFilter, (item) => item.title)
        setSearchResults(filtered)
      } catch (err) {
        console.error('Manga search failed:', err)
      } finally {
        setSearchLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [searchInput, nsfwFilter])

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchInput('')
    setSearchResults([])
    searchInputRef.current?.focus()
  }, [])

  const handleMediaClick = (item: SearchResult) => {
    setSelectedManga(item)
  }

  // === GENRE: Fetch genres list ===
  useEffect(() => {
    if (!showGenres || mangaGenres.length > 0) return
    setGenresLoading(true)
    jikanGenresManga()
      .then(result => setMangaGenres(result.genres))
      .catch(err => console.error('Failed to load manga genres:', err))
      .finally(() => setGenresLoading(false))
  }, [showGenres, mangaGenres.length])

  // Genre: fetch results when genres/filters change
  useEffect(() => {
    if (!showGenres) return
    if (selectedGenreIds.size === 0 && !genreFilters.orderBy && !genreFilters.status && !genreFilters.type) {
      setGenreResults([])
      setGenreHasNextPage(false)
      return
    }

    const fetchGenreResults = async () => {
      setGenreResultsLoading(true)
      setGenrePage(1)
      genreSeenIdsRef.current.clear()
      try {
        const genreStr = Array.from(selectedGenreIds).join(',')
        const result = await jikanSearchMangaFiltered({
          page: 1,
          sfw: nsfwFilter,
          genres: genreStr || undefined,
          orderBy: genreFilters.orderBy || undefined,
          sort: genreFilters.sort || undefined,
          status: genreFilters.status || undefined,
          mangaType: genreFilters.type || undefined,
        })
        const filtered = filterNsfwContent(result.results, (item) => item.genres, nsfwFilter, (item) => item.title)
        filtered.forEach(item => genreSeenIdsRef.current.add(item.id))
        setGenreResults(filtered)
        setGenreHasNextPage(result.has_next_page)
      } catch (err) {
        console.error('Manga genre search failed:', err)
      } finally {
        setGenreResultsLoading(false)
      }
    }

    fetchGenreResults()
  }, [showGenres, selectedGenreIds, genreFilters, nsfwFilter])

  // Load more genre results
  const loadMoreGenreResults = useCallback(async () => {
    if (genreLoadingMore || !genreHasNextPage) return

    setGenreLoadingMore(true)
    try {
      const nextPage = genrePage + 1
      const genreStr = Array.from(selectedGenreIds).join(',')
      const result = await jikanSearchMangaFiltered({
        page: nextPage,
        sfw: nsfwFilter,
        genres: genreStr || undefined,
        orderBy: genreFilters.orderBy || undefined,
        sort: genreFilters.sort || undefined,
        status: genreFilters.status || undefined,
        mangaType: genreFilters.type || undefined,
      })

      const newResults = result.results.filter(item => {
        if (genreSeenIdsRef.current.has(item.id)) return false
        genreSeenIdsRef.current.add(item.id)
        return true
      })

      setGenreResults(prev => [...prev, ...newResults])
      setGenrePage(nextPage)
      setGenreHasNextPage(result.has_next_page)
    } catch (err) {
      console.error('Failed to load more manga genre results:', err)
    } finally {
      setGenreLoadingMore(false)
    }
  }, [genrePage, genreHasNextPage, genreLoadingMore, selectedGenreIds, genreFilters, nsfwFilter])

  // Intersection observer for genre tab infinite scroll
  useEffect(() => {
    if (!showGenres) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && genreHasNextPage && !genreLoadingMore && !genreResultsLoading) {
          loadMoreGenreResults()
        }
      },
      { threshold: 0.1 }
    )

    if (genreLoadMoreRef.current) {
      observer.observe(genreLoadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [showGenres, genreHasNextPage, genreLoadingMore, genreResultsLoading, loadMoreGenreResults])

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

  // Carousel sections config
  const carousels = [
    { title: 'Most Popular', hook: popular },
    { title: 'Recommended', hook: favorite },
    { title: 'Publishing Now', hook: publishing },
  ]

  return (
    <div className="min-h-[calc(100vh-4rem)] pb-12 overflow-visible">
      <div className="px-4 sm:px-6 lg:px-8 3xl:px-12 py-8 max-w-4k mx-auto overflow-visible">
        {/* Search Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <BookOpen className="w-8 h-8 text-[var(--color-accent-primary)]" />
            <h1 className="text-3xl font-bold">Manga</h1>
            <button
              onClick={() => setShowGenres(!showGenres)}
              className={`ml-auto px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                showGenres
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <TagIcon className="w-4 h-4" />
              Genres
            </button>
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

        {/* Search Results / Genre Browse / Carousels */}
        {searchInput ? (
          <div>
            {searchResults.length > 0 && (
              <div className="overflow-visible">
                <h2 className="text-xl font-semibold mb-4">
                  Search Results ({searchResults.length} results)
                </h2>
                <div className={`grid ${gridClasses} overflow-visible`}>
                  {searchResults.map((item) => (
                    <MediaCard
                      key={item.id}
                      media={item}
                      onClick={() => handleMediaClick(item)}
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
        ) : showGenres ? (
          // ========== GENRE BROWSE MODE ==========
          <div>
            <GenreFilterBar
              genres={mangaGenres}
              selectedGenreIds={selectedGenreIds}
              onToggleGenre={(id) => {
                setSelectedGenreIds(prev => {
                  const next = new Set(prev)
                  if (next.has(id)) {
                    next.delete(id)
                  } else {
                    next.add(id)
                  }
                  return next
                })
              }}
              filters={genreFilters}
              onFilterChange={setGenreFilters}
              mediaType="manga"
              loading={genresLoading}
            />

            <div className="mt-6">
              {genreResultsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
                </div>
              ) : genreResults.length > 0 ? (
                <div className="overflow-visible">
                  <p className="text-sm text-[var(--color-text-muted)] mb-4">
                    {genreResults.length} results
                  </p>
                  <div className={`grid ${gridClasses} overflow-visible`}>
                    {genreResults.map((item) => (
                      <MediaCard
                        key={item.id}
                        media={item}
                        onClick={() => handleMediaClick(item)}
                        status={getStatus(item.id)}
                      />
                    ))}
                  </div>

                  <div ref={genreLoadMoreRef} className="py-8 flex items-center justify-center">
                    {genreLoadingMore && (
                      <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
                    )}
                    {!genreHasNextPage && genreResults.length > 0 && (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        You've reached the end
                      </p>
                    )}
                  </div>
                </div>
              ) : selectedGenreIds.size > 0 || genreFilters.orderBy || genreFilters.status || genreFilters.type ? (
                <div className="text-center py-12">
                  <p className="text-[var(--color-text-secondary)]">
                    No manga found matching the selected filters
                  </p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <TagIcon className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-3" />
                  <p className="text-[var(--color-text-secondary)]">
                    Select one or more genres to browse manga
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Continue Reading Section */}
            {allanimeExtensionId && (
              <ContinueReadingSection extensionId={allanimeExtensionId} />
            )}

            {/* Top 10 Manga */}
            {trending.data.length >= 10 && (
              <MediaCarousel
                title="Top 10 Manga"
                items={trending.data.slice(0, 10)}
                loading={false}
                onItemClick={handleMediaClick}
                showRank
              />
            )}
            {/* Show loading state for Top 10 if still loading */}
            {trending.loading && (
              <MediaCarousel
                title="Top 10 Manga"
                items={[]}
                loading={true}
                onItemClick={handleMediaClick}
                showRank
              />
            )}

            {/* Content Carousels */}
            <div className="space-y-8 overflow-visible">
              {carousels.map(({ title, hook }) => (
                <MediaCarousel
                  key={title}
                  title={title}
                  items={hook.data}
                  loading={hook.loading}
                  onItemClick={handleMediaClick}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Manga Detail Modal */}
      {selectedManga && (
        <MangaDetailModal
          manga={selectedManga}
          extensionId={allanimeExtensionId || ''}
          onClose={() => {
            setSelectedManga(null)
            refreshStatus()
          }}
        />
      )}
    </div>
  )
}
