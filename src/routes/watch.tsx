/**
 * Watch Route - Video Player Page
 *
 * Full-screen video player with episode list sidebar
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { getMediaDetails, getVideoSources } from '@/utils/tauri-commands'
import type { MediaDetails, VideoSources } from '@/types/extension'

interface WatchSearch {
  extensionId: string
  animeId: string
  episodeId?: string
}

export const Route = createFileRoute('/watch')({
  component: WatchPage,
  validateSearch: (search: Record<string, unknown>): WatchSearch => {
    return {
      extensionId: (search.extensionId as string) || '',
      animeId: (search.animeId as string) || '',
      episodeId: search.episodeId as string | undefined,
    }
  },
})

function WatchPage() {
  const navigate = useNavigate()
  const { extensionId, animeId, episodeId: initialEpisodeId } = Route.useSearch()

  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [sources, setSources] = useState<VideoSources | null>(null)
  const [currentEpisodeId, setCurrentEpisodeId] = useState<string>(initialEpisodeId || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load anime details
  useEffect(() => {
    if (!extensionId || !animeId) {
      setError('Missing extension ID or anime ID')
      return
    }

    const loadDetails = async () => {
      try {
        const result = await getMediaDetails(extensionId, animeId)
        setDetails(result)

        // Set initial episode if not provided
        if (!initialEpisodeId && result.episodes.length > 0) {
          setCurrentEpisodeId(result.episodes[0].id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load anime details')
      }
    }

    loadDetails()
  }, [extensionId, animeId, initialEpisodeId])

  // Load video sources for current episode
  useEffect(() => {
    if (!extensionId || !currentEpisodeId) return

    const loadSources = async () => {
      setLoading(true)
      setError(null)

      try {
        const result = await getVideoSources(extensionId, currentEpisodeId)
        setSources(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load video sources')
      } finally {
        setLoading(false)
      }
    }

    loadSources()
  }, [extensionId, currentEpisodeId])

  const currentEpisode = details?.episodes.find((ep) => ep.id === currentEpisodeId)
  const currentEpisodeIndex = details?.episodes.findIndex((ep) => ep.id === currentEpisodeId) ?? -1

  const handleNextEpisode = () => {
    if (!details || currentEpisodeIndex === -1) return

    const nextEpisode = details.episodes[currentEpisodeIndex + 1]
    if (nextEpisode) {
      setCurrentEpisodeId(nextEpisode.id)
    }
  }

  const handlePreviousEpisode = () => {
    if (!details || currentEpisodeIndex === -1) return

    const previousEpisode = details.episodes[currentEpisodeIndex - 1]
    if (previousEpisode) {
      setCurrentEpisodeId(previousEpisode.id)
    }
  }

  const handleEpisodeSelect = (episodeId: string) => {
    setCurrentEpisodeId(episodeId)
  }

  const handleGoBack = () => {
    navigate({ to: '/anime' })
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Top Bar */}
      <div className="h-14 bg-[var(--color-bg-secondary)]/95 backdrop-blur-sm border-b border-white/10 flex items-center px-4 z-10">
        <button
          onClick={handleGoBack}
          className="flex items-center gap-2 hover:bg-white/10 px-3 py-2 rounded-lg transition-colors"
        >
          <ArrowLeft size={20} />
          <span className="text-sm font-medium">Back to Browse</span>
        </button>

        {details && currentEpisode && (
          <div className="ml-6 flex-1 min-w-0">
            <h1 className="text-base font-bold truncate">{details.title}</h1>
            <p className="text-xs text-[var(--color-text-muted)]">
              Episode {currentEpisode.number}
              {currentEpisode.title && ` - ${currentEpisode.title}`}
            </p>
          </div>
        )}
      </div>

      {/* Player Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video Player */}
        <div className="flex-1">
          {loading && (
            <div className="w-full h-full flex items-center justify-center bg-black">
              <Loader2 className="w-12 h-12 animate-spin text-[var(--color-accent-primary)]" />
            </div>
          )}

          {error && (
            <div className="w-full h-full flex flex-col items-center justify-center bg-black text-white">
              <p className="text-lg font-semibold mb-2">Error Loading Video</p>
              <p className="text-[var(--color-text-secondary)]">{error}</p>
            </div>
          )}

          {!loading && !error && sources && sources.sources.length > 0 && (
            <VideoPlayer
              sources={sources.sources}
              animeTitle={details?.title}
              currentEpisode={currentEpisode?.number}
              totalEpisodes={details?.episodes.length}
              episodes={details?.episodes}
              onEpisodeSelect={handleEpisodeSelect}
              onNextEpisode={handleNextEpisode}
              onPreviousEpisode={handlePreviousEpisode}
              autoPlay
            />
          )}

          {!loading && !error && sources && sources.sources.length === 0 && (
            <div className="w-full h-full flex flex-col items-center justify-center bg-black text-white">
              <p className="text-lg font-semibold mb-2">No Video Sources Available</p>
              <p className="text-[var(--color-text-secondary)]">
                This episode does not have any available streaming sources.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
