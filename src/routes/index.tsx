import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { jikanTopAnime, jikanSeasonNow, jikanSeasonUpcoming, jikanWatchEpisodesPopular, loadExtension, getDiscoverCache, saveDiscoverCache } from '@/utils/tauri-commands'
import { MediaCarousel } from '@/components/media/MediaCarousel'
import { HeroSection } from '@/components/media/HeroSection'
import { HeroSectionSkeleton } from '@/components/media/HeroSectionSkeleton'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { ContinueWatchingSection } from '@/components/media/ContinueWatchingSection'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import type { SearchResult } from '@/types/extension'

export const Route = createFileRoute('/')({
  component: HomeScreen,
})

// Content categories for the home page using Jikan API
// Note: 'trending' is fetched separately (used by hero + Top 10, not rendered as its own carousel)
const CATEGORIES = [
  { id: 'most-popular', title: 'Most Popular', fetch: () => jikanWatchEpisodesPopular() },
  { id: 'this-season', title: 'This Season', fetch: () => jikanSeasonNow(1, true) },
  { id: 'top-rated', title: 'Top Rated', fetch: () => jikanTopAnime(1, undefined, undefined, true) },
  { id: 'upcoming', title: 'Upcoming', fetch: () => jikanSeasonUpcoming(1, true) },
]

interface CategoryContent {
  id: string
  items: SearchResult[]
  loading: boolean
  error: string | null
}

function HomeScreen() {
  const [allanimeExtensionId, setAllanimeExtensionId] = useState<string | null>(null)

  const [featuredAnime, setFeaturedAnime] = useState<SearchResult | null>(null)
  const [featuredIndex, setFeaturedIndex] = useState(0)
  const [categories, setCategories] = useState<Record<string, CategoryContent>>({})
  const trailerPlayingRef = useRef(false)

  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Load AllAnime extension lazily in background (for ContinueWatching and modal)
  useEffect(() => {
    loadExtension(ALLANIME_EXTENSION)
      .then(metadata => setAllanimeExtensionId(metadata.id))
      .catch(() => {})
  }, [])

  // Load trending (for hero + Top 10) and categories concurrently
  useEffect(() => {
    const loadAll = async () => {
      // Initialize categories state
      const initialState: Record<string, CategoryContent> = {}
      CATEGORIES.forEach(cat => {
        initialState[cat.id] = { id: cat.id, items: [], loading: true, error: null }
      })
      // Also init trending (not rendered as carousel, but needed for hero + Top 10)
      initialState['trending'] = { id: 'trending', items: [], loading: true, error: null }
      setCategories(initialState)

      // Load trending + all categories concurrently
      await Promise.allSettled([
        // Trending (hero section + Top 10)
        (async () => {
          const cacheKey = 'home:trending'
          try {
            const results = await jikanTopAnime(1, undefined, 'airing', true)
            const uniqueResults = results.results.reduce((acc, item) => {
              if (!acc.find(existing => existing.id === item.id)) acc.push(item)
              return acc
            }, [] as SearchResult[])

            setCategories(prev => ({
              ...prev,
              trending: { id: 'trending', items: uniqueResults, loading: false, error: null },
            }))
            setFeaturedAnime(prev => prev || uniqueResults[0] || null)
            saveDiscoverCache(cacheKey, JSON.stringify(uniqueResults), 'anime').catch(() => {})
          } catch (err) {
            console.error('Trending API failed, trying cache:', err)
            try {
              const cached = await getDiscoverCache(cacheKey)
              if (cached) {
                const cachedResults: SearchResult[] = JSON.parse(cached.data)
                if (cachedResults.length > 0) {
                  setCategories(prev => ({
                    ...prev,
                    trending: { id: 'trending', items: cachedResults, loading: false, error: null },
                  }))
                  setFeaturedAnime(prev => prev || cachedResults[0])
                  return
                }
              }
            } catch { /* cache failed too */ }
            setCategories(prev => ({
              ...prev,
              trending: { id: 'trending', items: [], loading: false, error: 'Failed to load' },
            }))
          }
        })(),

        // Other categories
        ...CATEGORIES.map(async (category) => {
          const cacheKey = `home:${category.id}`
          try {
            const results = await category.fetch()
            const uniqueResults = results.results.reduce((acc, item) => {
              if (!acc.find(existing => existing.id === item.id)) acc.push(item)
              return acc
            }, [] as SearchResult[])

            setCategories(prev => ({
              ...prev,
              [category.id]: { id: category.id, items: uniqueResults, loading: false, error: null },
            }))
            saveDiscoverCache(cacheKey, JSON.stringify(uniqueResults), 'anime').catch(() => {})
          } catch (err) {
            console.error(`Category ${category.id} API failed, trying cache:`, err)
            try {
              const cached = await getDiscoverCache(cacheKey)
              if (cached) {
                const cachedResults: SearchResult[] = JSON.parse(cached.data)
                if (cachedResults.length > 0) {
                  setCategories(prev => ({
                    ...prev,
                    [category.id]: { id: category.id, items: cachedResults, loading: false, error: null },
                  }))
                  return
                }
              }
            } catch { /* cache failed too */ }
            setCategories(prev => ({
              ...prev,
              [category.id]: { id: category.id, items: [], loading: false, error: err instanceof Error ? err.message : 'Failed to load' },
            }))
          }
        }),
      ])
    }

    loadAll()
  }, [])

  // Auto-rotate hero section every 10 seconds
  useEffect(() => {
    const trendingContent = categories['trending']
    if (!trendingContent || trendingContent.items.length === 0) return

    const interval = setInterval(() => {
      if (trailerPlayingRef.current) return
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

  return (
    <div className="min-h-[calc(100vh-4rem)] pb-12 overflow-visible">
      <div className="px-4 sm:px-6 lg:px-8 3xl:px-12 py-8 max-w-4k mx-auto overflow-visible">
        {/* Hero Section */}
        {featuredAnime ? (
          <HeroSection
            key={featuredAnime.id}
            media={featuredAnime}
            onWatch={handleWatch}
            onMoreInfo={handleMoreInfo}
            totalItems={categories['trending']?.items.length || 1}
            currentIndex={featuredIndex}
            onIndexChange={handleFeaturedIndexChange}
            onTrailerStateChange={(playing) => { trailerPlayingRef.current = playing }}
          />
        ) : (
          <HeroSectionSkeleton />
        )}

        {/* Continue Watching Section */}
        <ContinueWatchingSection extensionId={allanimeExtensionId || undefined} />

        {/* Top 10 Anime */}
        {categories['trending']?.items.length >= 10 && (
          <MediaCarousel
            title="Top 10 Anime"
            items={categories['trending'].items.slice(0, 10)}
            loading={categories['trending']?.loading}
            onItemClick={handleMediaClick}
            showRank
          />
        )}

        {/* Content Carousels */}
        <div className="space-y-8 overflow-visible">
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
      {selectedMedia && (
        <MediaDetailModal
          media={selectedMedia}
          extensionId={allanimeExtensionId || undefined}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onMediaChange={setSelectedMedia}
        />
      )}
    </div>
  )
}
