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
import { Loader2, AlertCircle, BookMarked, Download } from 'lucide-react'
import { getLibraryWithMedia, loadExtension, getDownloadsWithMedia, type LibraryEntryWithMedia, type LibraryStatus, type DownloadWithMedia } from '@/utils/tauri-commands'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import type { SearchResult } from '@/types/extension'

export const Route = createFileRoute('/library')({
  component: LibraryScreen,
})

const TABS: { id: LibraryStatus | 'all' | 'downloaded'; label: string }[] = [
  { id: 'watching', label: 'Watching' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'plan_to_watch', label: 'Plan to Watch' },
  { id: 'downloaded', label: 'Downloaded' },
  { id: 'all', label: 'All' },
]

function LibraryScreen() {
  const [extensionId, setExtensionId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<LibraryStatus | 'all' | 'downloaded'>('watching')
  const [library, setLibrary] = useState<LibraryEntryWithMedia[]>([])
  const [downloadedAnime, setDownloadedAnime] = useState<DownloadWithMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Load extension on mount
  useEffect(() => {
    const initExtension = async () => {
      try {
        const metadata = await loadExtension(ALLANIME_EXTENSION)
        setExtensionId(metadata.id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load extension')
      }
    }

    initExtension()
  }, [])

  // Load library for active tab
  useEffect(() => {
    const loadLibrary = async () => {
      setLoading(true)
      setError(null)
      try {
        if (activeTab === 'downloaded') {
          // Load downloaded anime with media details
          const downloads = await getDownloadsWithMedia()
          setDownloadedAnime(downloads)
        } else {
          // Load from library
          const results = await getLibraryWithMedia(activeTab === 'all' ? undefined : activeTab)
          setLibrary(results)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load library')
      } finally {
        setLoading(false)
      }
    }

    loadLibrary()
  }, [activeTab])

  const handleMediaClick = (entry: LibraryEntryWithMedia) => {
    // Convert to SearchResult for modal
    const media: SearchResult = {
      id: entry.media.id,
      title: entry.media.title,
      cover_url: entry.media.cover_url,
    }
    setSelectedMedia(media)
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
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedMedia(null)
    // Reload library to reflect any changes
    const loadLibrary = async () => {
      try {
        if (activeTab === 'downloaded') {
          const downloads = await getDownloadsWithMedia()
          setDownloadedAnime(downloads)
        } else {
          const results = await getLibraryWithMedia(activeTab === 'all' ? undefined : activeTab)
          setLibrary(results)
        }
      } catch (err) {
        console.error('Failed to reload library:', err)
      }
    }
    loadLibrary()
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 sm:px-6 lg:px-8 py-8 max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
          <BookMarked className="w-8 h-8 text-[var(--color-accent-primary)]" />
          My Library
        </h1>
        <p className="text-[var(--color-text-secondary)]">
          Your anime collection organized by watch status
        </p>
      </div>

      {/* Status Tabs */}
      <div className="mb-8 border-b border-[var(--color-bg-hover)]">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {TABS.map((tab) => (
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

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
      ) : library.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="text-6xl mb-6">📚</div>
          <h2 className="text-2xl font-semibold mb-3">No Anime in This List</h2>
          <p className="text-[var(--color-text-secondary)] max-w-md mx-auto text-center">
            {activeTab === 'watching'
              ? "You're not currently watching any anime. Start watching to add shows here!"
              : activeTab === 'completed'
              ? "You haven't completed any anime yet. Keep watching!"
              : activeTab === 'plan_to_watch'
              ? 'Your watchlist is empty. Add anime from search or browse to start planning!'
              : `Your ${TABS.find(t => t.id === activeTab)?.label.toLowerCase()} list is empty.`}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 text-[var(--color-text-secondary)]">
            {library.length} {library.length === 1 ? 'item' : 'items'}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
      {selectedMedia && extensionId && (
        <MediaDetailModal
          media={selectedMedia}
          extensionId={extensionId}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onMediaChange={setSelectedMedia}
        />
      )}
    </div>
  )
}
