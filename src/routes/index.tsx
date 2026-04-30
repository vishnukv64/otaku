import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadExtension, jikanTopAnime, jikanSeasonNow, jikanSeasonUpcoming, jikanWatchEpisodesPopular, getContentRecommendations, getSimilarToWatched, getUserTopGenres, jikanGenresAnime, jikanSearchAnimeFiltered } from '@/utils/tauri-commands'
import type { RecommendationEntry, SimilarToGroup } from '@/utils/tauri-commands'
import { MediaCarousel } from '@/components/media/MediaCarousel'
import { HeroSection } from '@/components/media/HeroSection'
import { MobileHeroSection } from '@/components/media/MobileHeroSection'
import { HeroSectionSkeleton } from '@/components/media/HeroSectionSkeleton'
import { Top10Section } from '@/components/media/Top10Section'
import { isMobile } from '@/utils/platform'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { ContinueWatchingSection } from '@/components/media/ContinueWatchingSection'
import { ContinueReadingSection } from '@/components/media/ContinueReadingSection'
import { RecommendationCarousel, SimilarToCarousel } from '@/components/home/RecommendationCarousel'
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

  // Recommendation engine state
  const [recommendations, setRecommendations] = useState<RecommendationEntry[]>([])
  const [similarGroups, setSimilarGroups] = useState<SimilarToGroup[]>([])
  const [recsLoading, setRecsLoading] = useState(true)

  const loadRecommendations = useCallback(async () => {
    setRecsLoading(true)
    try {
      const [recs, similar] = await Promise.all([
        getContentRecommendations(20).catch(() => []),
        getSimilarToWatched(8).catch(() => []),
      ])
      setRecommendations(recs)
      setSimilarGroups(similar)
    } finally {
      setRecsLoading(false)
    }
  }, [])

  // Genre-weighted discover state
  const [genreDiscoverItems, setGenreDiscoverItems] = useState<SearchResult[]>([])
  const [genreDiscoverTitle, setGenreDiscoverTitle] = useState('')
  const [genreDiscoverLoading, setGenreDiscoverLoading] = useState(true)

  // Load AllAnime extension lazily in background (for ContinueWatching and modal)
  useEffect(() => {
    loadExtension(ALLANIME_EXTENSION)
      .then(metadata => setAllanimeExtensionId(metadata.id))
      .catch(() => {})
  }, [])

  // Fetch personalized recommendations (fire-and-forget, errors silenced)
  useEffect(() => {
    void loadRecommendations()
  }, [loadRecommendations])

  // Genre-weighted discover: fetch user's top genres, map to MAL IDs, search Jikan
  useEffect(() => {
    (async () => {
      try {
        const profile = await getUserTopGenres(3)
        if (profile.top_genres.length === 0) return

        const genreNames = profile.top_genres.map((g) => g.genre)
        const { genres: allGenres } = await jikanGenresAnime()

        // Map genre names to MAL genre IDs (case-insensitive)
        const genreIds = genreNames
          .map((name) => allGenres.find((g) => g.name.toLowerCase() === name.toLowerCase())?.id)
          .filter((id): id is number => id != null)

        if (genreIds.length === 0) return

        setGenreDiscoverTitle(`Trending in ${genreNames.slice(0, 2).join(' & ')}`)

        const result = await jikanSearchAnimeFiltered({
          genres: genreIds.join(','),
          orderBy: 'score',
          sort: 'desc',
          sfw: true,
          status: 'airing',
        })

        setGenreDiscoverItems(result.results ?? [])
      } catch {
        // Silently ignore — genre discover is optional
      } finally {
        setGenreDiscoverLoading(false)
      }
    })()
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
    }, 5000)

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
    { title: 'Most Popular', hook: mostPopular, seeAllHref: '/anime', seeAllText: 'Browse all' },
    { title: 'This Season', hook: thisSeason, seeAllHref: '/anime' },
    { title: 'Top Rated', hook: topRated, seeAllHref: '/anime' },
    { title: 'Upcoming', hook: upcoming, seeAllHref: '/anime' },
  ]

  return (
    <div className="relative min-h-[calc(100vh-4rem)] pb-12 overflow-visible">
      {/* Background Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute rounded-full opacity-[0.12] animate-orb-float" style={{ width: 400, height: 400, background: '#e50914', filter: 'blur(80px)', top: '-10%', left: '-5%' }} />
        <div className="absolute rounded-full opacity-[0.12] animate-orb-float" style={{ width: 300, height: 300, background: '#b20710', filter: 'blur(80px)', top: '40%', right: '-8%', animationDelay: '-3s' }} />
        <div className="absolute rounded-full opacity-[0.12] animate-orb-float" style={{ width: 250, height: 250, background: '#8b0000', filter: 'blur(80px)', bottom: '-5%', left: '30%', animationDelay: '-5s' }} />
      </div>
      <div className="relative z-[1] px-4 sm:px-6 lg:px-8 3xl:px-12 pt-6 max-w-4k mx-auto overflow-visible">
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

        {/* Continue Reading Section */}
        <ContinueReadingSection />

        {/* Personalized Recommendations */}
        <RecommendationCarousel
          title="Recommended For You"
          items={recommendations}
          loading={recsLoading}
          onItemClick={handleMediaClick}
        />

        {/* "Because you watched X" Carousels */}
        {similarGroups.map((group) => (
          <SimilarToCarousel
            key={group.source_id}
            group={group}
            onItemClick={handleMediaClick}
          />
        ))}

        {/* Genre-weighted Discover */}
        {genreDiscoverTitle && (
          <MediaCarousel
            title={genreDiscoverTitle}
            items={genreDiscoverItems}
            loading={genreDiscoverLoading}
            onItemClick={handleMediaClick}
          />
        )}

        {/* Top 10 Anime */}
        <Top10Section
          items={trending.data}
          onItemClick={handleMediaClick}
        />

        {/* Content Carousels */}
        <div className="space-y-2 overflow-visible">
          {carousels.map(({ title, hook, seeAllHref, seeAllText }) => (
            <MediaCarousel
              key={title}
              title={title}
              items={hook.data}
              loading={hook.loading}
              onItemClick={handleMediaClick}
              seeAllHref={seeAllHref}
              seeAllText={seeAllText}
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
          onFeedbackChange={loadRecommendations}
        />
      )}
    </div>
  )
}
