/**
 * Manga Route - Manga Browser Page
 *
 * Browse, search, and discover manga with Jikan API-powered carousels.
 * Uses SWR caching via useJikanQuery for instant page loads.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Loader2, X, BookOpen } from 'lucide-react'
import {
  loadExtension,
  jikanTopManga,
  jikanSearchManga,
} from '@/utils/tauri-commands'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaCarousel } from '@/components/media/MediaCarousel'
import { MangaDetailModal } from '@/components/media/MangaDetailModal'
import { ContinueReadingSection } from '@/components/media/ContinueReadingSection'
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

  const [allanimeExtensionId, setAllanimeExtensionId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedManga, setSelectedManga] = useState<SearchResult | null>(null)

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

        {/* Search Results (hides carousels when active) */}
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
