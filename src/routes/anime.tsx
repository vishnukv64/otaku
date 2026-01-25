import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Search, Loader2, AlertCircle } from 'lucide-react'
import { useMediaStore } from '@/store/mediaStore'
import { loadExtension } from '@/utils/tauri-commands'
import { MediaCarousel } from '@/components/media/MediaCarousel'

export const Route = createFileRoute('/anime')({
  component: AnimeScreen,
})

// Example extension code
const EXAMPLE_EXTENSION_CODE = `
const extensionObject = {
  id: "com.example.anime",
  name: "Example Anime Source",
  version: "1.0.0",
  type: "anime",
  language: "en",
  baseUrl: "https://example.com",

  search: async (query, page) => {
    const results = Array.from({ length: 12 }, (_, i) => ({
      id: \`anime-\${page}-\${i + 1}\`,
      title: \`\${query} - Result \${(page - 1) * 12 + i + 1}\`,
      coverUrl: "https://via.placeholder.com/300x400/1a1a1a/e50914?text=Anime",
      description: "An exciting anime about adventures and friendships.",
      year: 2024,
      status: i % 3 === 0 ? "Ongoing" : "Completed"
    }));

    return {
      results: results,
      hasNextPage: page < 5
    };
  },

  getDetails: async (id) => {
    return {
      id: id,
      title: "Example Anime Title",
      coverUrl: "https://via.placeholder.com/300x400/1a1a1a/e50914?text=Anime",
      description: "This is a detailed description of the anime.",
      genres: ["Action", "Adventure", "Fantasy"],
      status: "Ongoing",
      year: 2024,
      rating: 8.5,
      episodes: Array.from({ length: 12 }, (_, i) => ({
        id: \`ep-\${i + 1}\`,
        number: i + 1,
        title: \`Episode \${i + 1}\`,
        thumbnail: "https://via.placeholder.com/320x180/1a1a1a/e50914"
      }))
    };
  },

  getSources: async (episodeId) => {
    return {
      sources: [
        { url: "https://example.com/1080p.m3u8", quality: "1080p", type: "hls" },
        { url: "https://example.com/720p.m3u8", quality: "720p", type: "hls" }
      ],
      subtitles: [
        { url: "https://example.com/en.vtt", language: "en", label: "English" }
      ]
    };
  }
};
`

function AnimeScreen() {
  const [extensionId, setExtensionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')

  const {
    searchQuery,
    searchResults,
    searchLoading,
    searchError,
    search,
    selectMedia,
  } = useMediaStore()

  // Load example extension on mount
  useEffect(() => {
    const initExtension = async () => {
      try {
        const metadata = await loadExtension(EXAMPLE_EXTENSION_CODE)
        setExtensionId(metadata.id)
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load extension')
        setLoading(false)
      }
    }

    initExtension()
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (extensionId && searchInput.trim()) {
      search(extensionId, searchInput, 1)
    }
  }

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
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search for anime..."
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
          <MediaCarousel
            title={`Search Results for "${searchQuery}"`}
            items={searchResults}
            loading={searchLoading}
            onItemClick={(item) => extensionId && selectMedia(extensionId, item.id)}
          />

          {searchError && (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 text-[var(--color-accent-primary)] mx-auto mb-3" />
              <p className="text-[var(--color-text-secondary)]">{searchError}</p>
            </div>
          )}

          {!searchLoading && searchResults.length === 0 && !searchError && (
            <div className="text-center py-12">
              <p className="text-lg text-[var(--color-text-secondary)]">
                No results found for "{searchQuery}"
              </p>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!searchQuery && (
        <div className="text-center py-20">
          <div className="text-6xl mb-6">🔍</div>
          <h2 className="text-2xl font-semibold mb-3">Start Searching</h2>
          <p className="text-[var(--color-text-secondary)] max-w-md mx-auto">
            Use the search bar above to find anime. Try searching for anything - the example
            extension will return mock results!
          </p>
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">
            Using: Example Anime Source (Demo)
          </p>
        </div>
      )}
    </div>
  )
}
