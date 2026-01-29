import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import {
  loadExtension,
  streamHomeContent,
  onHomeContentCategory,
  type HomeCategory,
  type HomeCategoryEvent,
} from '@/utils/tauri-commands'
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

function HomeScreen() {
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const [extensionId, setExtensionId] = useState<string | null>(null)
  const [mangaExtensionId, setMangaExtensionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [featuredAnime, setFeaturedAnime] = useState<SearchResult | null>(null)
  const [categories, setCategories] = useState<HomeCategory[]>([])
  const [streamComplete, setStreamComplete] = useState(false)

  // Track if we've started streaming to avoid duplicate calls
  const streamingRef = useRef(false)

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

  // Handle incoming category events
  const handleCategoryEvent = useCallback((event: HomeCategoryEvent) => {
    console.log('[SSE] Received category:', event.category.title, 'is_last:', event.is_last)

    // Add the category to state (avoid duplicates)
    setCategories(prev => {
      const exists = prev.some(c => c.id === event.category.id)
      if (exists) {
        return prev.map(c => c.id === event.category.id ? event.category : c)
      }
      return [...prev, event.category]
    })

    // Set featured anime from first event if available
    if (event.featured) {
      setFeaturedAnime(event.featured)
    }

    // Mark stream as complete when last category received
    if (event.is_last) {
      setStreamComplete(true)
      console.log('[SSE] Stream complete')
    }
  }, [])

  // Stream home content via SSE
  useEffect(() => {
    if (!extensionId || streamingRef.current) return

    let unsubscribe: (() => void) | null = null

    const startStreaming = async () => {
      streamingRef.current = true
      setCategories([])
      setStreamComplete(false)

      try {
        // Set up event listener FIRST
        unsubscribe = await onHomeContentCategory(handleCategoryEvent)
        console.log('[SSE] Listener set up, starting stream...')

        // Then start streaming
        await streamHomeContent(extensionId, nsfwFilter)
        console.log('[SSE] Stream command completed')
      } catch (err) {
        console.error('Failed to stream home content:', err)
        setStreamComplete(true)
      }
    }

    startStreaming()

    // Cleanup on unmount
    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
      streamingRef.current = false
    }
  }, [extensionId, nsfwFilter, handleCategoryEvent])

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

  // Show skeleton loaders for categories not yet loaded
  const expectedCategories = ['trending', 'top-rated', 'recently-updated']
  const loadedCategoryIds = new Set(categories.map(c => c.id))
  const pendingCategories = expectedCategories.filter(id => !loadedCategoryIds.has(id))

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

        {/* Content Carousels - Progressive Loading */}
        <div className="space-y-8">
          {/* Render loaded categories */}
          {categories.map(category => (
            <MediaCarousel
              key={category.id}
              title={category.title}
              items={category.items}
              loading={false}
              onItemClick={handleMediaClick}
            />
          ))}

          {/* Show skeleton loaders for pending categories */}
          {!streamComplete && pendingCategories.map(id => (
            <MediaCarousel
              key={`skeleton-${id}`}
              title="Loading..."
              items={[]}
              loading={true}
              onItemClick={handleMediaClick}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
