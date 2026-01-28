import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { loadExtension, getHomeContent, type HomeCategory } from '@/utils/tauri-commands'
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
  const [contentLoading, setContentLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [featuredAnime, setFeaturedAnime] = useState<SearchResult | null>(null)
  const [categories, setCategories] = useState<HomeCategory[]>([])

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

  // Load all home content in a single call
  useEffect(() => {
    if (!extensionId) return

    const loadHomeContent = async () => {
      setContentLoading(true)
      try {
        // Single API call that fetches and categorizes content in Rust
        const content = await getHomeContent(extensionId, nsfwFilter)

        setCategories(content.categories)
        setFeaturedAnime(content.featured)
        setContentLoading(false)
      } catch (err) {
        console.error('Failed to load home content:', err)
        setContentLoading(false)
      }
    }

    loadHomeContent()
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
          {contentLoading ? (
            // Show loading skeletons for 3 categories
            Array.from({ length: 3 }).map((_, i) => (
              <MediaCarousel
                key={`skeleton-${i}`}
                title="Loading..."
                items={[]}
                loading={true}
                onItemClick={handleMediaClick}
              />
            ))
          ) : (
            categories.map(category => (
              <MediaCarousel
                key={category.id}
                title={category.title}
                items={category.items}
                loading={false}
                onItemClick={handleMediaClick}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
