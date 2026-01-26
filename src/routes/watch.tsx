/**
 * Watch Route - Video Player Page
 *
 * Full-screen video player with episode list sidebar
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2, Download } from 'lucide-react'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { getMediaDetails, getVideoSources, saveMediaDetails, getEpisodeFilePath, getWatchProgress, type MediaEntry } from '@/utils/tauri-commands'
import type { MediaDetails, VideoSources } from '@/types/extension'
import { convertFileSrc } from '@tauri-apps/api/core'
import toast from 'react-hot-toast'

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
  const [resumeTime, setResumeTime] = useState<number>(0)

  // Load anime details
  useEffect(() => {
    if (!extensionId || !animeId) {
      setError('Missing extension ID or anime ID')
      return
    }

    const loadDetails = async () => {
      try {
        const result = await getMediaDetails(extensionId, animeId)

        // Sort episodes in ascending order by episode number
        if (result.episodes) {
          result.episodes.sort((a, b) => a.number - b.number)
        }

        setDetails(result)

        // Save media details to database for continue watching
        try {
          const mediaEntry: MediaEntry = {
            id: result.id,
            extension_id: extensionId,
            title: result.title,
            english_name: result.english_name,
            native_name: result.native_name,
            description: result.description,
            cover_url: result.cover_url,
            banner_url: result.cover_url, // Use cover as banner if no separate banner
            trailer_url: result.trailer_url,
            media_type: 'anime',
            content_type: result.type,
            status: result.status,
            year: result.year,
            rating: result.rating,
            episode_count: result.episodes.length,
            episode_duration: result.episode_duration,
            season_quarter: result.season?.quarter,
            season_year: result.season?.year,
            aired_start_year: result.aired_start?.year,
            aired_start_month: result.aired_start?.month,
            aired_start_date: result.aired_start?.date,
            genres: result.genres ? JSON.stringify(result.genres) : undefined,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          await saveMediaDetails(mediaEntry)
        } catch (saveErr) {
          console.error('Failed to save media details:', saveErr)
          // Non-fatal error, continue anyway
        }

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

  // Define current episode variables
  const currentEpisode = details?.episodes.find((ep) => ep.id === currentEpisodeId)
  const currentEpisodeIndex = details?.episodes.findIndex((ep) => ep.id === currentEpisodeId) ?? -1

  // Load watch progress and video sources for current episode
  // IMPORTANT: Load watch progress BEFORE sources to ensure resume time is set
  useEffect(() => {
    if (!extensionId || !currentEpisodeId || !currentEpisode) return

    const loadProgressAndSources = async () => {
      setLoading(true)
      setError(null)

      try {
        // Step 1: Load watch progress FIRST
        console.log(`📖 Loading watch progress for episode: ${currentEpisodeId}`)
        try {
          const progress = await getWatchProgress(currentEpisodeId)

          if (progress && progress.progress_seconds > 0) {
            const minutes = Math.floor(progress.progress_seconds / 60)
            const seconds = Math.floor(progress.progress_seconds % 60)
            const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`
            console.log(`✓ Found saved progress: ${timeStr} (${progress.progress_seconds}s)`)
            setResumeTime(progress.progress_seconds)

            // Show resume notification with unique ID to prevent duplicates
            toast.success(`Resuming from ${timeStr}`, {
              id: `resume-${currentEpisodeId}`,
              duration: 3000,
              position: 'bottom-center',
            })
          } else {
            console.log('No saved progress found, starting from beginning')
            setResumeTime(0)
          }
        } catch (error) {
          console.error('Failed to load watch progress:', error)
          setResumeTime(0)
        }

        // Step 2: Load video sources AFTER watch progress is loaded
        // Check if episode is downloaded first
        const filePath = await getEpisodeFilePath(animeId, currentEpisode.number)

        if (filePath) {
          // Use local file for offline playback
          const localUrl = convertFileSrc(filePath)
          setSources({
            sources: [{
              url: localUrl,
              quality: 'Downloaded',
              type: 'video/mp4',
              server: 'Local'
            }],
            subtitles: []
          })
          console.log('Playing from local file:', filePath)
        } else {
          // Fetch from extension
          const result = await getVideoSources(extensionId, currentEpisodeId)
          setSources(result)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load video sources')
      } finally {
        setLoading(false)
      }
    }

    loadProgressAndSources()
  }, [extensionId, currentEpisodeId, currentEpisode, animeId])

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
    <div className="fixed inset-0 bg-black z-50" style={{ paddingTop: '64px' }}>
      {/* Player Container */}
      <div className="w-full h-full">
        {/* Video Player */}
        <div className="w-full h-full">
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
              mediaId={animeId}
              episodeId={currentEpisodeId}
              animeTitle={details?.title}
              episodeTitle={currentEpisode?.title}
              currentEpisode={currentEpisode?.number}
              totalEpisodes={details?.episodes.length}
              episodes={details?.episodes}
              onEpisodeSelect={handleEpisodeSelect}
              onNextEpisode={handleNextEpisode}
              onPreviousEpisode={handlePreviousEpisode}
              onGoBack={handleGoBack}
              initialTime={resumeTime}
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
