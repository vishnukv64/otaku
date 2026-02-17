import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { loadExtension, jikanTopAnime, jikanSeasonNow, jikanSeasonUpcoming, jikanWatchEpisodesPopular } from '@/utils/tauri-commands'
import { MediaCarousel } from '@/components/media/MediaCarousel'
import { HeroSection } from '@/components/media/HeroSection'
import { MobileHeroSection } from '@/components/media/MobileHeroSection'
import { HeroSectionSkeleton } from '@/components/media/HeroSectionSkeleton'
import { isMobile } from '@/utils/platform'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { ContinueWatchingSection } from '@/components/media/ContinueWatchingSection'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { useJikanQuery, CACHE_TTL } from '@/hooks/useJikanQuery'
import type { SearchResult } from '@/types/extension'

export const Route = createFileRoute('/')({
  component: HomeScreen,
})

function HomeScreen() {
  const [allanimeExtensionId, setAllanimeExtensionId] = useState<string | null>(null)

  const [featuredAnime, setFeaturedAnime] = useState<SearchResult | null>(null)
  const [featuredIndex, setFeaturedIndex] = useState(0)
  const trailerPlayingRef = useRef(false)

  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Load AllAnime extension lazily in background (for ContinueWatching and modal)
  useEffect(() => {
    loadExtension(ALLANIME_EXTENSION)
      .then(metadata => setAllanimeExtensionId(metadata.id))
      .catch(() => {})
  }, [])

  // SWR-cached data for each section
  const trending = useJikanQuery({
    cacheKey: 'home:trending',
    fetcher: () => jikanTopAnime(1, undefined, 'airing', true),
    ttlSeconds: CACHE_TTL.TRENDING,
    mediaType: 'anime',
  })

  const mostPopular = useJikanQuery({
    cacheKey: 'home:most-popular',
    fetcher: () => jikanWatchEpisodesPopular(),
    ttlSeconds: CACHE_TTL.POPULAR,
    mediaType: 'anime',
  })

  const thisSeason = useJikanQuery({
    cacheKey: 'home:this-season',
    fetcher: () => jikanSeasonNow(1, true),
    ttlSeconds: CACHE_TTL.AIRING,
    mediaType: 'anime',
  })

  const topRated = useJikanQuery({
    cacheKey: 'home:top-rated',
    fetcher: () => jikanTopAnime(1, undefined, undefined, true),
    ttlSeconds: CACHE_TTL.TOP_RATED,
    mediaType: 'anime',
  })

  const upcoming = useJikanQuery({
    cacheKey: 'home:upcoming',
    fetcher: () => jikanSeasonUpcoming(1, true),
    ttlSeconds: CACHE_TTL.UPCOMING,
    mediaType: 'anime',
  })

  // Set initial featured anime when trending data arrives
  useEffect(() => {
    if (trending.data.length > 0 && !featuredAnime) {
      setFeaturedAnime(trending.data[0]) // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [trending.data, featuredAnime])

  // Auto-rotate hero section every 10 seconds
  useEffect(() => {
    if (trending.data.length === 0) return

    const interval = setInterval(() => {
      if (trailerPlayingRef.current) return
      setFeaturedIndex(prevIndex => {
        const nextIndex = (prevIndex + 1) % trending.data.length
        setFeaturedAnime(trending.data[nextIndex])
        return nextIndex
      })
    }, 10000)

    return () => clearInterval(interval)
  }, [trending.data])

  // Update featured anime when index changes
  const handleFeaturedIndexChange = (index: number) => {
    if (trending.data[index]) {
      setFeaturedIndex(index)
      setFeaturedAnime(trending.data[index])
    }
  }

  const handleWatch = () => {
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

  // Carousel sections config — maps hook results to titles
  const carousels = [
    { title: 'Most Popular', hook: mostPopular },
    { title: 'This Season', hook: thisSeason },
    { title: 'Top Rated', hook: topRated },
    { title: 'Upcoming', hook: upcoming },
  ]

  return (
    <div className="min-h-[calc(100vh-4rem)] pb-12 overflow-visible">
      <div className="px-4 sm:px-6 lg:px-8 3xl:px-12 py-8 max-w-4k mx-auto overflow-visible">
        {/* Hero Section */}
        {featuredAnime ? (
          isMobile() ? (
            <MobileHeroSection
              key={featuredAnime.id}
              media={featuredAnime}
              onWatch={handleWatch}
              onMoreInfo={handleMoreInfo}
              totalItems={trending.data.length || 1}
              currentIndex={featuredIndex}
              onIndexChange={handleFeaturedIndexChange}
            />
          ) : (
            <HeroSection
              key={featuredAnime.id}
              media={featuredAnime}
              onWatch={handleWatch}
              onMoreInfo={handleMoreInfo}
              totalItems={trending.data.length || 1}
              currentIndex={featuredIndex}
              onIndexChange={handleFeaturedIndexChange}
              onTrailerStateChange={(playing) => { trailerPlayingRef.current = playing }}
            />
          )
        ) : (
          <HeroSectionSkeleton />
        )}

        {/* Continue Watching Section */}
        <ContinueWatchingSection extensionId={allanimeExtensionId || undefined} />

        {/* Top 10 Anime */}
        {trending.data.length >= 10 && (
          <MediaCarousel
            title="Top 10 Anime"
            items={trending.data.slice(0, 10)}
            loading={false}
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
