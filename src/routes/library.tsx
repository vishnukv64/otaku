/**
 * Library Route - User's Media Collection
 *
 * Displays user's anime/manga library organized by status
 * - Tabs: Watching, Completed, On Hold, Dropped, Plan to Watch
 * - Grid layout with MediaCards
 * - Filters and sorting
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, BookMarked, Download, Tv, BookOpen } from 'lucide-react'
import { getLibraryWithMedia, loadExtension, getDownloadsWithMedia, getDownloadedMangaWithMedia, type LibraryEntryWithMedia, type LibraryStatus, type DownloadWithMedia, type DownloadedMangaWithMedia } from '@/utils/tauri-commands'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { MangaDetailModal } from '@/components/media/MangaDetailModal'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { ALLANIME_MANGA_EXTENSION } from '@/extensions/allanime-manga-extension'
import type { SearchResult } from '@/types/extension'
import { useSettingsStore } from '@/store/settingsStore'

export const Route = createFileRoute('/library')({
  component: LibraryScreen,
})

type MediaFilter = 'all' | 'anime' | 'manga'

const ANIME_TABS: { id: LibraryStatus | 'all' | 'downloaded'; label: string }[] = [
  { id: 'watching', label: 'Watching' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'plan_to_watch', label: 'Plan to Watch' },
  { id: 'downloaded', label: 'Downloaded' },
  { id: 'all', label: 'All' },
]

const MANGA_TABS: { id: LibraryStatus | 'all' | 'downloaded'; label: string }[] = [
  { id: 'reading', label: 'Reading' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'plan_to_read', label: 'Plan to Read' },
  { id: 'downloaded', label: 'Downloaded' },
  { id: 'all', label: 'All' },
]

function LibraryScreen() {
  const gridDensity = useSettingsStore((state) => state.gridDensity)
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const [extensionId, setExtensionId] = useState<string | null>(null)
  const [mangaExtensionId, setMangaExtensionId] = useState<string | null>(null)
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('anime')
  const [activeTab, setActiveTab] = useState<LibraryStatus | 'all' | 'downloaded'>('watching')
  const [library, setLibrary] = useState<LibraryEntryWithMedia[]>([])
  const [downloadedAnime, setDownloadedAnime] = useState<DownloadWithMedia[]>([])
  const [downloadedManga, setDownloadedManga] = useState<DownloadedMangaWithMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null)
  const [selectedMediaType, setSelectedMediaType] = useState<'anime' | 'manga'>('anime')
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Grid density class mapping (extended for 4K displays)
  const gridClasses = {
    compact: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 5xl:grid-cols-14 gap-2',
    comfortable: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 3xl:grid-cols-8 4xl:grid-cols-10 5xl:grid-cols-12 gap-4',
    spacious: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-8 5xl:grid-cols-10 gap-6',
  }[gridDensity]

  // Load extensions on mount
  useEffect(() => {
    const initExtensions = async () => {
      try {
        const animeMetadata = await loadExtension(ALLANIME_EXTENSION)
        setExtensionId(animeMetadata.id)

        try {
          const mangaMetadata = await loadExtension(ALLANIME_MANGA_EXTENSION)
          setMangaExtensionId(mangaMetadata.id)
        } catch (mangaErr) {
          console.error('Failed to load manga extension:', mangaErr)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load extension')
      }
    }

    initExtensions()
  }, [])

  // Reset active tab when media filter changes
  useEffect(() => {
    if (mediaFilter === 'anime') {
      setActiveTab('watching')
    } else if (mediaFilter === 'manga') {
      setActiveTab('reading')
    }
  }, [mediaFilter])

  // Load library for active tab and media filter
  useEffect(() => {
    const loadLibrary = async () => {
      setLoading(true)
      setError(null)
      try {
        if (activeTab === 'downloaded') {
          if (mediaFilter === 'manga') {
            // Load downloaded manga with media details
            const downloads = await getDownloadedMangaWithMedia()
            setDownloadedManga(downloads)
          } else {
            // Load downloaded anime with media details
            const downloads = await getDownloadsWithMedia()
            setDownloadedAnime(downloads)
          }
        } else {
          // Load from library
          const results = await getLibraryWithMedia(activeTab === 'all' ? undefined : activeTab)

          // Filter by media type
          let filtered = results.filter(entry => {
            if (mediaFilter === 'all') return true
            return entry.media.media_type === mediaFilter
          })

          // Filter out NSFW content if filter is enabled
          filtered = filterNsfwContent(
            filtered,
            entry => entry.media.genres,
            nsfwFilter
          )

          setLibrary(filtered)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load library')
      } finally {
        setLoading(false)
      }
    }

    loadLibrary()
  }, [activeTab, mediaFilter, nsfwFilter])

  const handleMediaClick = (entry: LibraryEntryWithMedia) => {
    // Convert to SearchResult for modal
    const media: SearchResult = {
      id: entry.media.id,
      title: entry.media.title,
      cover_url: entry.media.cover_url,
    }
    setSelectedMedia(media)
    setSelectedMediaType(entry.media.media_type === 'manga' ? 'manga' : 'anime')
    setIsModalOpen(true)
  }

  const handleDownloadedClick = (anime: DownloadWithMedia) => {
    // Convert to SearchResult for modal
    const media: SearchResult = {
      id: anime.media_id,
      title: anime.title,
      cover_url: anime.cover_url,
    }
    setSelectedMedia(media)
    setSelectedMediaType('anime')
    setIsModalOpen(true)
  }

  const handleDownloadedMangaClick = (manga: DownloadedMangaWithMedia) => {
    // Convert to SearchResult for modal
    const media: SearchResult = {
      id: manga.media_id,
      title: manga.title,
      cover_url: manga.cover_url,
    }
    setSelectedMedia(media)
    setSelectedMediaType('manga')
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedMedia(null)
    // Reload library to reflect any changes
    const loadLibrary = async () => {
      try {
        if (activeTab === 'downloaded') {
          if (mediaFilter === 'manga') {
            const downloads = await getDownloadedMangaWithMedia()
            setDownloadedManga(downloads)
          } else {
            const downloads = await getDownloadsWithMedia()
            setDownloadedAnime(downloads)
          }
        } else {
          const results = await getLibraryWithMedia(activeTab === 'all' ? undefined : activeTab)
          let filtered = results.filter(entry => {
            if (mediaFilter === 'all') return true
            return entry.media.media_type === mediaFilter
          })
          // Filter out NSFW content if filter is enabled
          filtered = filterNsfwContent(
            filtered,
            entry => entry.media.genres,
            nsfwFilter
          )
          setLibrary(filtered)
        }
      } catch (err) {
        console.error('Failed to reload library:', err)
      }
    }
    loadLibrary()
  }

  // Get appropriate tabs based on media filter
  const currentTabs = mediaFilter === 'manga' ? MANGA_TABS : ANIME_TABS

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 sm:px-6 lg:px-8 3xl:px-12 py-8 max-w-4k mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
          <BookMarked className="w-8 h-8 text-[var(--color-accent-primary)]" />
          My Library
        </h1>
        <p className="text-[var(--color-text-secondary)]">
          Your collection organized by status
        </p>
      </div>

      {/* Media Type Filter */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setMediaFilter('anime')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            mediaFilter === 'anime'
              ? 'bg-[var(--color-accent-primary)] text-white'
              : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
          }`}
        >
          <Tv className="w-4 h-4" />
          Anime
        </button>
        <button
          onClick={() => setMediaFilter('manga')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            mediaFilter === 'manga'
              ? 'bg-[var(--color-accent-primary)] text-white'
              : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          Manga
        </button>
      </div>

      {/* Status Tabs */}
      <div className="mb-8 border-b border-[var(--color-bg-hover)]">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {currentTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-3 font-semibold whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'text-white border-b-2 border-[var(--color-accent-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-bg-hover)] rounded-t-lg'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-12 h-12 animate-spin text-[var(--color-accent-primary)] mb-4" />
          <p className="text-lg text-[var(--color-text-secondary)]">
            Loading your library...
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20">
          <AlertCircle className="w-16 h-16 text-[var(--color-accent-primary)] mb-4" />
          <h2 className="text-2xl font-bold mb-2">Error</h2>
          <p className="text-[var(--color-text-secondary)]">{error}</p>
        </div>
      ) : activeTab === 'downloaded' ? (
        // Downloaded Tab Content
        mediaFilter === 'manga' ? (
          // Downloaded Manga
          downloadedManga.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Download className="w-16 h-16 text-[var(--color-text-muted)] mb-4" />
              <h2 className="text-2xl font-semibold mb-3">No Downloaded Manga</h2>
              <p className="text-[var(--color-text-secondary)] max-w-md mx-auto text-center">
                Download chapters from manga details to read them offline. They'll appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 text-[var(--color-text-secondary)]">
                {downloadedManga.length} {downloadedManga.length === 1 ? 'manga' : 'manga'}
              </div>

              <div className={`grid ${gridClasses}`}>
                {downloadedManga.map((manga) => {
                  const formatBytes = (bytes: number) => {
                    if (bytes === 0) return '0 B'
                    const k = 1024
                    const sizes = ['B', 'KB', 'MB', 'GB']
                    const i = Math.floor(Math.log(bytes) / Math.log(k))
                    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
                  }

                  // Convert to SearchResult for MediaCard
                  const media: SearchResult = {
                    id: manga.media_id,
                    title: manga.title,
                    cover_url: manga.cover_url,
                  }

                  return (
                    <div key={manga.media_id} className="relative">
                      <MediaCard
                        media={media}
                        onClick={() => handleDownloadedMangaClick(manga)}
                      />

                      {/* Chapter count badge */}
                      <div className="absolute top-2 left-2 bg-green-500/90 text-white px-2 py-1 rounded text-xs font-medium flex items-center gap-1">
                        <BookOpen size={12} />
                        {manga.chapter_count} ch
                      </div>

                      {/* Storage badge */}
                      <div className="absolute top-2 right-2 bg-blue-600/90 text-white px-2 py-1 rounded text-xs font-medium">
                        {formatBytes(manga.total_size)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )
        ) : (
          // Downloaded Anime
          downloadedAnime.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Download className="w-16 h-16 text-[var(--color-text-muted)] mb-4" />
              <h2 className="text-2xl font-semibold mb-3">No Downloaded Anime</h2>
              <p className="text-[var(--color-text-secondary)] max-w-md mx-auto text-center">
                Download episodes from anime details to watch them offline. They'll appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 text-[var(--color-text-secondary)]">
                {downloadedAnime.length} {downloadedAnime.length === 1 ? 'anime' : 'anime'}
              </div>

              <div className={`grid ${gridClasses}`}>
                {downloadedAnime.map((anime) => {
                  const formatBytes = (bytes: number) => {
                    if (bytes === 0) return '0 B'
                    const k = 1024
                    const sizes = ['B', 'KB', 'MB', 'GB']
                    const i = Math.floor(Math.log(bytes) / Math.log(k))
                    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
                  }

                  // Convert to SearchResult for MediaCard
                  const media: SearchResult = {
                    id: anime.media_id,
                    title: anime.title,
                    cover_url: anime.cover_url,
                  }

                  return (
                    <div key={anime.media_id} className="relative">
                      <MediaCard
                        media={media}
                        onClick={() => handleDownloadedClick(anime)}
                      />

                      {/* Download badge */}
                      <div className="absolute top-2 left-2 bg-green-500/90 text-white px-2 py-1 rounded text-xs font-medium flex items-center gap-1">
                        <Download size={12} />
                        {anime.episode_count}
                      </div>

                      {/* Storage badge */}
                      <div className="absolute top-2 right-2 bg-blue-600/90 text-white px-2 py-1 rounded text-xs font-medium">
                        {formatBytes(anime.total_size)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )
        )
      ) : library.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="text-6xl mb-6">{mediaFilter === 'manga' ? '📖' : '📚'}</div>
          <h2 className="text-2xl font-semibold mb-3">
            No {mediaFilter === 'manga' ? 'Manga' : 'Anime'} in This List
          </h2>
          <p className="text-[var(--color-text-secondary)] max-w-md mx-auto text-center">
            {mediaFilter === 'manga' ? (
              activeTab === 'reading'
                ? "You're not currently reading any manga. Start reading to add titles here!"
                : activeTab === 'completed'
                ? "You haven't completed any manga yet. Keep reading!"
                : activeTab === 'plan_to_read'
                ? 'Your reading list is empty. Add manga from search or browse to start planning!'
                : `Your ${currentTabs.find(t => t.id === activeTab)?.label.toLowerCase()} list is empty.`
            ) : (
              activeTab === 'watching'
                ? "You're not currently watching any anime. Start watching to add shows here!"
                : activeTab === 'completed'
                ? "You haven't completed any anime yet. Keep watching!"
                : activeTab === 'plan_to_watch'
                ? 'Your watchlist is empty. Add anime from search or browse to start planning!'
                : `Your ${currentTabs.find(t => t.id === activeTab)?.label.toLowerCase()} list is empty.`
            )}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 text-[var(--color-text-secondary)]">
            {library.length} {library.length === 1 ? 'item' : 'items'}
          </div>

          <div className={`grid ${gridClasses}`}>
            {library.map((entry) => {
              // Convert media entry to SearchResult for MediaCard
              const media: SearchResult = {
                id: entry.media.id,
                title: entry.media.title,
                cover_url: entry.media.cover_url,
              }

              return (
                <div key={entry.library_entry.media_id} className="relative">
                  <MediaCard
                    media={media}
                    onClick={() => handleMediaClick(entry)}
                  />
                  {entry.library_entry.favorite && (
                    <div className="absolute top-2 right-2 text-yellow-400">
                      ★
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Media Detail Modal */}
      {selectedMedia && selectedMediaType === 'anime' && extensionId && (
        <MediaDetailModal
          media={selectedMedia}
          extensionId={extensionId}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onMediaChange={setSelectedMedia}
        />
      )}

      {/* Manga Detail Modal */}
      {selectedMedia && selectedMediaType === 'manga' && mangaExtensionId && (
        <MangaDetailModal
          manga={selectedMedia}
          extensionId={mangaExtensionId}
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}
