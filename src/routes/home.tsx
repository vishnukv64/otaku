import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { loadExtension, discoverAnime } from '@/utils/tauri-commands'
import { MediaCarousel } from '@/components/media/MediaCarousel'
import { HeroSection } from '@/components/media/HeroSection'
import { ContinueWatchingSection } from '@/components/media/ContinueWatchingSection'
import { ContinueReadingSection } from '@/components/media/ContinueReadingSection'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { ALLANIME_MANGA_EXTENSION } from '@/extensions/allanime-manga-extension'
import { useSettingsStore } from '@/store/settingsStore'
import type { SearchResult } from '@/types/extension'

export const Route = createFileRoute('/home')({
  component: HomeScreen,
})

// Content categories for the home page
const CATEGORIES = [
  { id: 'trending', title: 'Trending Now', sortType: 'view', genres: [] },
  { id: 'top-rated', title: 'Top Rated Anime', sortType: 'score', genres: [] },
  { id: 'recently-updated', title: 'Recently Updated', sortType: 'update', genres: [] },
  { id: 'action', title: 'Action & Adventure', sortType: 'score', genres: ['Action'] },
  { id: 'romance', title: 'Romance', sortType: 'score', genres: ['Romance'] },
  { id: 'comedy', title: 'Comedy', sortType: 'score', genres: ['Comedy'] },
  { id: 'thriller', title: 'Thriller & Mystery', sortType: 'score', genres: ['Thriller', 'Mystery'] },
  { id: 'fantasy', title: 'Fantasy & Magic', sortType: 'score', genres: ['Fantasy'] },
]

interface CategoryContent {
  id: string
  items: SearchResult[]
  loading: boolean
  error: string | null
}

function HomeScreen() {
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const [extensionId, setExtensionId] = useState<string | null>(null)
  const [mangaExtensionId, setMangaExtensionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [featuredAnime, setFeaturedAnime] = useState<SearchResult | null>(null)
  const [categories, setCategories] = useState<Record<string, CategoryContent>>({})

  // Load extensions on mount
  useEffect(() => {
    const initExtensions = async () => {
      try {
        // Load anime extension
        const animeMetadata = await loadExtension(ALLANIME_EXTENSION)
        setExtensionId(animeMetadata.id)

        // Load manga extension (non-blocking)
        try {
          const mangaMetadata = await loadExtension(ALLANIME_MANGA_EXTENSION)
          setMangaExtensionId(mangaMetadata.id)
        } catch (mangaErr) {
          console.error('Failed to load manga extension:', mangaErr)
        }

        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load extension')
        setLoading(false)
      }
    }

    initExtensions()
  }, [])

  // Load content for all categories
  useEffect(() => {
    if (!extensionId) return

    const loadCategories = async () => {
      // Initialize categories state
      const initialState: Record<string, CategoryContent> = {}
      CATEGORIES.forEach(cat => {
        initialState[cat.id] = { id: cat.id, items: [], loading: true, error: null }
      })
      setCategories(initialState)

      // Load each category
      for (const category of CATEGORIES) {
        try {
          const results = await discoverAnime(
            extensionId,
            1,
            category.sortType,
            category.genres,
            nsfwFilter
          )

          setCategories(prev => ({
            ...prev,
            [category.id]: {
              id: category.id,
              items: results.results,
              loading: false,
              error: null,
            },
          }))

          // Use first result from trending as featured
          if (category.id === 'trending' && results.results.length > 0 && !featuredAnime) {
            setFeaturedAnime(results.results[0])
          }
        } catch (err) {
          setCategories(prev => ({
            ...prev,
            [category.id]: {
              id: category.id,
              items: [],
              loading: false,
              error: err instanceof Error ? err.message : 'Failed to load',
            },
          }))
        }
      }
    }

    loadCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensionId, nsfwFilter])

  const handleWatch = () => {
    // TODO: Navigate to watch screen or show details
  }

  const handleMoreInfo = () => {
    // TODO: Show details modal or navigate to details page
  }

  const handleMediaClick = (_item: SearchResult) => {
    // TODO: Navigate to details page
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
    <div className="min-h-[calc(100vh-4rem)] pb-12">
      <div className="px-4 sm:px-6 lg:px-8 3xl:px-12 py-8 max-w-4k mx-auto">
        {/* Hero Section */}
        {featuredAnime && (
          <HeroSection
            media={featuredAnime}
            onWatch={handleWatch}
            onMoreInfo={handleMoreInfo}
          />
        )}

        {/* Continue Watching Section */}
        {extensionId && (
          <ContinueWatchingSection extensionId={extensionId} />
        )}

        {/* Continue Reading Section */}
        {mangaExtensionId && (
          <ContinueReadingSection extensionId={mangaExtensionId} />
        )}

        {/* Content Carousels */}
        <div className="space-y-8">
          {CATEGORIES.map(category => {
            const content = categories[category.id]
            if (!content) return null

            return (
              <MediaCarousel
                key={category.id}
                title={category.title}
                items={content.items}
                loading={content.loading}
                onItemClick={handleMediaClick}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
