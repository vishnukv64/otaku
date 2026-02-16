/**
 * Watch Route - Video Player Page
 *
 * Full-screen video player with episode list sidebar
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { jikanAnimeDetails, loadExtension, resolveAllanimeId, clearAllanimeMapping, getVideoSources, saveMediaDetails, saveEpisodes, getCachedMediaDetails, getEpisodeFilePath, getWatchProgress, getLocalVideoUrl, getVideoServerInfo, type MediaEntry, type EpisodeEntry, type VideoServerUrls } from '@/utils/tauri-commands'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import type { MediaDetails, VideoSources } from '@/types/extension'
import { toastInfo } from '@/utils/notify'

interface WatchSearch {
  malId: string
  episodeId?: string
}

export const Route = createFileRoute('/watch')({
  component: WatchPage,
  validateSearch: (search: Record<string, unknown>): WatchSearch => {
    return {
      malId: (search.malId as string) || '',
      episodeId: search.episodeId as string | undefined,
    }
  },
})

function WatchPage() {
  const navigate = useNavigate()
  const { malId, episodeId: initialEpisodeId } = Route.useSearch()

  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [sources, setSources] = useState<VideoSources | null>(null)
  const [currentEpisodeId, setCurrentEpisodeId] = useState<string>(initialEpisodeId || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resumeTime, setResumeTime] = useState<number>(0)
  const [videoServerInfo, setVideoServerInfo] = useState<VideoServerUrls | null>(null)
  const [allanimeExtId, setAllanimeExtId] = useState<string | null>(null)
  const [allanimeId, setAllanimeId] = useState<string | null>(null)
  const shownResumeToastRef = useRef<string | null>(null)
  const shownOfflineToastRef = useRef<string | null>(null)

  // Load video server info on mount
  useEffect(() => {
    getVideoServerInfo()
      .then(setVideoServerInfo)
      .catch((err) => console.error('Failed to get video server info:', err))
  }, [])

  // Load anime details from Jikan API
  useEffect(() => {
    if (!malId) {
      setError('Missing anime ID')
      return
    }

    const loadDetails = async () => {
      let result: MediaDetails | null = null

      // Try to load from Jikan API first
      try {
        result = await jikanAnimeDetails(parseInt(malId))

        // Sort episodes in ascending order by episode number
        if (result.episodes) {
          result.episodes.sort((a, b) => a.number - b.number)
        }

        // Save media details and episodes to database for offline use
        try {
          const mediaEntry: MediaEntry = {
            id: result.id,
            extension_id: 'jikan',
            title: result.title,
            english_name: result.english_name,
            native_name: result.native_name,
            description: result.description,
            cover_url: result.cover_url,
            banner_url: result.cover_url,
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

          // Also cache episodes for offline playback
          if (result.episodes.length > 0) {
            const episodeEntries: EpisodeEntry[] = result.episodes.map(ep => ({
              id: ep.id,
              media_id: result!.id,
              extension_id: 'jikan',
              number: ep.number,
              title: ep.title,
              description: undefined,
              thumbnail_url: ep.thumbnail,
              aired_date: undefined,
              duration: undefined,
            }))
            await saveEpisodes(result.id, 'jikan', episodeEntries)
          }
        } catch (saveErr) {
          console.error('Failed to save media details:', saveErr)
        }
      } catch (apiErr) {
        console.warn('[Watch] API failed, trying cache:', apiErr)

        // API failed - try to load from cache
        try {
          const cached = await getCachedMediaDetails(malId)
          if (cached) {
            // Convert cached data to MediaDetails format
            result = {
              id: cached.media.id,
              title: cached.media.title,
              english_name: cached.media.english_name,
              native_name: cached.media.native_name,
              description: cached.media.description,
              cover_url: cached.media.cover_url,
              trailer_url: cached.media.trailer_url,
              type: cached.media.content_type,
              status: cached.media.status,
              year: cached.media.year,
              rating: cached.media.rating,
              episode_count: cached.media.episode_count,
              episode_duration: cached.media.episode_duration,
              season: cached.media.season_quarter && cached.media.season_year
                ? { quarter: cached.media.season_quarter, year: cached.media.season_year }
                : undefined,
              aired_start: cached.media.aired_start_year
                ? { year: cached.media.aired_start_year, month: cached.media.aired_start_month, date: cached.media.aired_start_date }
                : undefined,
              genres: cached.media.genres ? JSON.parse(cached.media.genres) : [],
              episodes: cached.episodes.map(ep => ({
                id: ep.id,
                number: ep.number,
                title: ep.title,
                thumbnail: ep.thumbnail_url,
              })),
            }
            // Sort episodes
            result.episodes.sort((a, b) => a.number - b.number)
            console.log('[Watch] Loaded from cache:', cached.episodes.length, 'episodes')
          }
        } catch (cacheErr) {
          console.error('[Watch] Cache also failed:', cacheErr)
        }
      }

      // If we have no data from either source, show error
      if (!result) {
        setError('Failed to load anime details - no cached data available')
        return
      }

      setDetails(result)

      // Load AllAnime extension and resolve ID for video sources
      try {
        const metadata = await loadExtension(ALLANIME_EXTENSION)
        setAllanimeExtId(metadata.id)
        const resolvedId = await resolveAllanimeId(result.title, 'anime', malId, result.english_name, result.year)
        if (resolvedId) {
          setAllanimeId(resolvedId)
        } else {
          console.warn('[Watch] Could not resolve AllAnime ID for:', result.title)
        }
      } catch (err) {
        console.warn('[Watch] Failed to load AllAnime extension:', err)
      }

      // Set initial episode if not provided
      if (!initialEpisodeId && result.episodes.length > 0) {
        let nextEpisode = result.episodes[0]

        // Strategy: Find the last watched episode and play the next one
        let lastWatchedIndex = -1
        let hasAnyProgress = false

        for (let i = 0; i < result.episodes.length; i++) {
          const episode = result.episodes[i]
          try {
            const progress = await getWatchProgress(episode.id)
            if (progress) {
              hasAnyProgress = true
              if (progress.completed || progress.progress_seconds > 0) {
                lastWatchedIndex = i
              }
            }
          } catch {
            // Ignore errors
          }
        }

        if (lastWatchedIndex >= 0) {
          const nextIndex = lastWatchedIndex + 1
          if (nextIndex < result.episodes.length) {
            nextEpisode = result.episodes[nextIndex]
          } else {
            nextEpisode = result.episodes[result.episodes.length - 1]
          }
        } else if (!hasAnyProgress) {
          nextEpisode = result.episodes[result.episodes.length - 1]
        } else {
          for (const episode of result.episodes) {
            try {
              const progress = await getWatchProgress(episode.id)
              if (!progress || !progress.completed) {
                nextEpisode = episode
                break
              }
            } catch {
              nextEpisode = episode
              break
            }
          }
        }

        setCurrentEpisodeId(nextEpisode.id)
      }
    }

    loadDetails()
  }, [malId, initialEpisodeId])

  // Define current episode variables
  const currentEpisode = details?.episodes.find((ep) => ep.id === currentEpisodeId)
  const currentEpisodeIndex = details?.episodes.findIndex((ep) => ep.id === currentEpisodeId) ?? -1

  // Load watch progress and video sources for current episode
  // IMPORTANT: Load watch progress BEFORE sources to ensure resume time is set
  useEffect(() => {
    if (!currentEpisodeId || !currentEpisode) return

    const loadProgressAndSources = async () => {
      setLoading(true)
      setError(null)
      setSources(null)

      let didComplete = false
      try {
        // Step 1: Load watch progress FIRST
        try {
          const progress = await getWatchProgress(currentEpisodeId)

          if (progress && progress.progress_seconds > 0) {
            const minutes = Math.floor(progress.progress_seconds / 60)
            const seconds = Math.floor(progress.progress_seconds % 60)
            const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`
            setResumeTime(progress.progress_seconds)

            // Only show toast once per episode (avoid duplicates from effect re-runs)
            if (shownResumeToastRef.current !== currentEpisodeId) {
              shownResumeToastRef.current = currentEpisodeId
              toastInfo('Resuming Playback', `Resuming from ${timeStr}`)
            }
          } else {
            setResumeTime(0)
          }
        } catch {
          setResumeTime(0)
        }

        // Step 2: Load video sources AFTER watch progress is loaded
        // Check if episode is downloaded first
        const filePath = await getEpisodeFilePath(malId, currentEpisode.number)
        let localSourceLoaded = false

        if (filePath && videoServerInfo) {
          // Use video server for local file (proper Range request support for large files)
          const localUrl = `http://127.0.0.1:${videoServerInfo.port}/absolute?path=${encodeURIComponent(filePath)}&token=${videoServerInfo.token}`
          setSources({
            sources: [{
              url: localUrl,
              quality: 'Downloaded',
              type: 'video/mp4',
              server: 'Local'
            }],
            subtitles: []
          })
          localSourceLoaded = true
          if (shownOfflineToastRef.current !== currentEpisodeId) {
            shownOfflineToastRef.current = currentEpisodeId
            toastInfo('Offline Mode', 'Playing from downloaded video')
          }
        } else if (filePath) {
          // Fallback: Try getLocalVideoUrl command with full path
          try {
            const localUrl = await getLocalVideoUrl(filePath)
            setSources({
              sources: [{
                url: localUrl,
                quality: 'Downloaded',
                type: 'video/mp4',
                server: 'Local'
              }],
              subtitles: []
            })
            localSourceLoaded = true
            if (shownOfflineToastRef.current !== currentEpisodeId) {
              shownOfflineToastRef.current = currentEpisodeId
              toastInfo('Offline Mode', 'Playing from downloaded video')
            }
          } catch {
            // Local file loading failed - will fall through to streaming
            console.warn('Failed to load local video file, falling back to streaming')
          }
        }

        // Fetch from AllAnime via bridge if no local source was loaded
        if (!localSourceLoaded) {
          if (!allanimeExtId || !allanimeId) {
            // Bridge still resolving - keep loading spinner visible
            // Effect will re-run when allanimeId becomes available
            return
          }
          // Build AllAnime episode ID: {allanimeId}::{episodeNumber}
          const allanimeEpisodeId = `${allanimeId}::${currentEpisode.number}`
          let result = await getVideoSources(allanimeExtId, allanimeEpisodeId)

          // If no valid sources, the cached AllAnime ID may be wrong - clear and re-resolve
          const hasValidSources = result.sources.some(s => s.url && s.url.length > 0)
          if (!hasValidSources && malId && details) {
            console.warn('[Watch] No valid sources - clearing stale mapping and re-resolving')
            await clearAllanimeMapping(malId)
            const freshId = await resolveAllanimeId(details.title, 'anime', malId, details.english_name, details.year)
            if (freshId && freshId !== allanimeId) {
              setAllanimeId(freshId)
              const freshEpisodeId = `${freshId}::${currentEpisode.number}`
              result = await getVideoSources(allanimeExtId, freshEpisodeId)
            }
          }

          setSources(result)
        }
        didComplete = true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load video sources')
        didComplete = true
      } finally {
        // Only clear loading if we actually finished (not waiting for allanimeId)
        if (didComplete) {
          setLoading(false)
        }
      }
    }

    loadProgressAndSources()
  }, [currentEpisodeId, currentEpisode, malId, videoServerInfo, allanimeExtId, allanimeId])

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
    <div className="fixed inset-0 bg-black z-50">
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
              mediaId={malId}
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
