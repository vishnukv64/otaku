import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef } from 'react'
import { Search, Loader2, AlertCircle } from 'lucide-react'
import { useMediaStore } from '@/store/mediaStore'
import { loadExtension, getRecommendations } from '@/utils/tauri-commands'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import type { SearchResult } from '@/types/extension'
import { useSettingsStore } from '@/store/settingsStore'

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

  // Grid density class mapping
  const gridClasses = {
    compact: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2',
    comfortable: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4',
    spacious: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6',
  }[gridDensity]

  const {
    searchQuery,
    searchResults,
    searchLoading,
    searchError,
    search,
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

  // Load recommendations when extension is ready
  useEffect(() => {
    const loadRecommendations = async () => {
      if (!extensionId) return

      setRecommendationsLoading(true)
      try {
        const results = await getRecommendations(extensionId)

        // Deduplicate recommendations by ID to avoid React key warnings
        const uniqueResults = results.results.reduce((acc, item) => {
          if (!acc.find(existing => existing.id === item.id)) {
            acc.push(item)
          }
          return acc
        }, [] as SearchResult[])

        setRecommendations(uniqueResults)
      } catch (err) {
        console.error('Failed to load recommendations:', err)
      } finally {
        setRecommendationsLoading(false)
      }
    }

    loadRecommendations()
  }, [extensionId])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (extensionId && searchInput.trim()) {
      search(extensionId, searchInput, 1)
    }
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
    <div className="min-h-[calc(100vh-4rem)] px-4 sm:px-6 lg:px-8 py-8 max-w-screen-2xl mx-auto">
      {/* Search Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-6">Anime Browser</h1>

        {/* Search Form */}
        <form onSubmit={handleSearch} className="max-w-2xl">
          <div className="relative">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
              size={20}
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search for anime... (Press / to focus)"
              className="w-full pl-12 pr-4 py-3 bg-[var(--color-bg-secondary)] border border-[var(--color-bg-hover)] rounded-lg text-white placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)] focus:border-transparent"
            />
          </div>
          {searchInput && (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              Press Enter to search or type to see suggestions
            </p>
          )}
        </form>
      </div>

      {/* Search Results */}
      {searchQuery && (
        <div>
          {/* Loading State */}
          {searchLoading && (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-12 h-12 animate-spin text-[var(--color-accent-primary)] mb-4" />
              <p className="text-lg text-[var(--color-text-secondary)]">
                Searching for "{searchQuery}"...
              </p>
            </div>
          )}

          {/* Results */}
          {!searchLoading && searchResults.length > 0 && (
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
          {!searchLoading && searchResults.length === 0 && !searchError && (
            <div className="text-center py-12">
              <p className="text-lg text-[var(--color-text-secondary)]">
                No results found for "{searchQuery}"
              </p>
            </div>
          )}
        </div>
      )}

      {/* Recommendations / Empty State */}
      {!searchQuery && (
        <div>
          {recommendationsLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-12 h-12 animate-spin text-[var(--color-accent-primary)] mb-4" />
              <p className="text-lg text-[var(--color-text-secondary)]">
                Loading recommendations...
              </p>
            </div>
          ) : recommendations.length > 0 ? (
            <div>
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <svg className="w-7 h-7 text-[var(--color-accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Recommended Anime

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
