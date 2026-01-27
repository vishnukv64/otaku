import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { loadExtension, discoverAnime } from '@/utils/tauri-commands'
import { MediaCarousel } from '@/components/media/MediaCarousel'
import { HeroSection } from '@/components/media/HeroSection'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
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
  const [extensionId, setExtensionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [featuredAnime, setFeaturedAnime] = useState<SearchResult | null>(null)
  const [categories, setCategories] = useState<Record<string, CategoryContent>>({})

  // Load extension on mount
  useEffect(() => {
    const initExtension = async () => {
      try {
        const metadata = await loadExtension(ALLANIME_EXTENSION)
        setExtensionId(metadata.id)
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load extension')
        setLoading(false)
      }
    }

    initExtension()
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
            category.genres
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
  }, [extensionId])

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
      <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-screen-2xl mx-auto">
        {/* Hero Section */}
        {featuredAnime && (
          <HeroSection
            media={featuredAnime}
            onWatch={handleWatch}
            onMoreInfo={handleMoreInfo}
          />
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
