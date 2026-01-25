import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { loadExtension, discoverAnime } from '@/utils/tauri-commands'
import { MediaCarousel } from '@/components/media/MediaCarousel'
import { HeroSection } from '@/components/media/HeroSection'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import type { SearchResult } from '@/types/extension'

export const Route = createFileRoute('/')({
  component: HomeScreen,
})

// Content categories for the home page
// sortType: 'view'/'update' = daily popular (dateRange: 1), 'score' = monthly popular (dateRange: 30)
const CATEGORIES = [
  { id: 'trending', title: 'Trending Now', sortType: 'view', page: 1 },
  { id: 'recently-updated', title: 'Recently Updated', sortType: 'update', page: 1 },
  { id: 'top-rated', title: 'Top Rated All Time', sortType: 'score', page: 1 },
  { id: 'hot-today', title: 'Hot Today', sortType: 'view', page: 2 },
  { id: 'new-episodes', title: 'New Episodes', sortType: 'update', page: 2 },
  { id: 'all-time-classics', title: 'All-Time Classics', sortType: 'score', page: 2 },
  { id: 'popular-series', title: 'Popular Series', sortType: 'view', page: 3 },
  { id: 'must-watch', title: 'Must Watch', sortType: 'score', page: 3 },
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
  const [featuredIndex, setFeaturedIndex] = useState(0)
  const [categories, setCategories] = useState<Record<string, CategoryContent>>({})

  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

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
          console.log(`Loading category: ${category.id}`, category)
          const results = await discoverAnime(
            extensionId,
            category.page,
            category.sortType,
            []
          )

          console.log(`Category ${category.id} results:`, results)

          setCategories(prev => ({
            ...prev,
            [category.id]: {
              id: category.id,
              items: results.results,
              loading: false,
              error: null,
            },
          }))

          // Set initial featured anime from trending
          if (category.id === 'trending' && results.results.length > 0 && !featuredAnime) {
            setFeaturedAnime(results.results[0])
          }
        } catch (err) {
          console.error(`Category ${category.id} error:`, err)
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

  // Auto-rotate hero section every 10 seconds
  useEffect(() => {
    const trendingContent = categories['trending']
    if (!trendingContent || trendingContent.items.length === 0) return

    const interval = setInterval(() => {
      setFeaturedIndex(prevIndex => {
        const nextIndex = (prevIndex + 1) % trendingContent.items.length
        setFeaturedAnime(trendingContent.items[nextIndex])
        return nextIndex
      })
    }, 10000) // 10 seconds

    return () => clearInterval(interval)
  }, [categories])

  // Update featured anime when index changes
  const handleFeaturedIndexChange = (index: number) => {
    const trendingContent = categories['trending']
    if (trendingContent && trendingContent.items[index]) {
      setFeaturedIndex(index)
      setFeaturedAnime(trendingContent.items[index])
    }
  }

  const handleWatch = () => {
    // TODO: Navigate to watch screen with first episode
    if (featuredAnime) {
      handleMediaClick(featuredAnime)
    }
  }

  const handleMoreInfo = () => {
    if (featuredAnime) {
      setSelectedMedia(featuredAnime)
      setIsModalOpen(true)
    }
  }

  const handleMediaClick = (item: SearchResult) => {
    setSelectedMedia(item)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedMedia(null)
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
            totalItems={categories['trending']?.items.length || 1}
            currentIndex={featuredIndex}
            onIndexChange={handleFeaturedIndexChange}
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

      {/* Media Detail Modal */}
      {selectedMedia && extensionId && (
        <MediaDetailModal
          media={selectedMedia}
          extensionId={extensionId}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}
