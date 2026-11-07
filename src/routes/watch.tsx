/**
 * Watch Route - Video Player Page
 *
 * Full-screen video player with episode list sidebar
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { useMobileLayout } from '@/hooks/useMobileLayout'
import {
  jikanAnimeDetails,
  loadExtension,
  resolveAllanimeId,
  clearAllanimeMapping,
  getVideoSources,
  searchAnime,
  saveMediaDetails,
  saveEpisodes,
  getCachedMediaDetails,
  getEpisodeFilePath,
  getWatchProgress,
  getLocalVideoUrl,
  getLocalFileSize,
  isLegacyTsDownload,
  getDownloadedSubtitles,
  getVideoServerInfo,
  type MediaEntry,
  type EpisodeEntry,
  type VideoServerUrls,
} from '@/utils/tauri-commands'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import type { MediaDetails, VideoSources } from '@/types/extension'
import { toastInfo } from '@/utils/notify'
import { isAndroid } from '@/utils/platform'
import { usePipStore } from '@/store/pipStore'
import { useSettingsStore } from '@/store/settingsStore'
import { buildAnikotoSearchQueries, resolveAnikotoSlug } from '@/utils/anikotoResolver'
import {
  nextStreamingProvider,
  slugProviderExtension,
  streamingProviderLabel,
} from '@/utils/streamingProviders'
import {
  canSeekLocalDownload,
  getInitialPlaybackTime,
  isLocalHlsPlaylist,
  shouldUseLocalDownload,
} from '@/utils/downloadedPlayback'

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
  const { malId, episodeId: initialEpisodeId } = Route.useSearch()

  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [sources, setSources] = useState<VideoSources | null>(null)
  const [currentEpisodeId, setCurrentEpisodeId] = useState<string>(initialEpisodeId || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resumeTime, setResumeTime] = useState<number>(0)
  const [isLegacyLocalTsDownload, setIsLegacyLocalTsDownload] = useState(false)
  const [videoServerInfo, setVideoServerInfo] = useState<VideoServerUrls | null>(null)
  const [allanimeExtId, setAllanimeExtId] = useState<string | null>(null)
  const [allanimeId, setAllanimeId] = useState<string | null>(null)
  const [anikotoExtId, setAnikotoExtId] = useState<string | null>(null)
  const [anikotoSlug, setAnikotoSlug] = useState<string | null>(null)
  const [anikotoResolveError, setAnikotoResolveError] = useState<string | null>(null)
  const [providersResolved, setProvidersResolved] = useState(false)
  const shownResumeToastRef = useRef<string | null>(null)
  const shownOfflineToastRef = useRef<string | null>(null)
  /** When expanding from PiP, skip the DB resume time (pip time takes priority) */
  const pipResumeOverrideRef = useRef(false)

  // Check if we're expanding from PiP mini player
  const pipExpandTime = usePipStore((s) => s.expandTime)
  const pipData = usePipStore((s) => s.data)
  const clearPipExpandTime = usePipStore((s) => s.clearExpandTime)
  const streamingProvider = useSettingsStore((s) => s.streamingProvider)
  const anikotoApiBaseUrl = useSettingsStore((s) => s.anikotoApiBaseUrl)
  const anikotoSiteBaseUrl = useSettingsStore((s) => s.anikotoSiteBaseUrl)
  const anikotoYotochanBaseUrl = useSettingsStore((s) => s.anikotoYotochanBaseUrl)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  // Load video server info on mount
  useEffect(() => {
    getVideoServerInfo()
      .then(setVideoServerInfo)
      .catch((err) => console.error('Failed to get video server info:', err))
  }, [])

  // Consume PiP expand time: when returning from mini player, use its time position
  useEffect(() => {
    if (pipExpandTime !== null && pipData) {
      setResumeTime(pipExpandTime)
      pipResumeOverrideRef.current = true
      // Suppress the resume toast since user is already aware they're resuming from PiP
      shownResumeToastRef.current = pipData.episodeId
      clearPipExpandTime()
    }
  }, [pipExpandTime, pipData, clearPipExpandTime])

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
            const episodeEntries: EpisodeEntry[] = result.episodes.map((ep) => ({
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
              season:
                cached.media.season_quarter && cached.media.season_year
                  ? { quarter: cached.media.season_quarter, year: cached.media.season_year }
                  : undefined,
              aired_start: cached.media.aired_start_year
                ? {
                    year: cached.media.aired_start_year,
                    month: cached.media.aired_start_month,
                    date: cached.media.aired_start_date,
                  }
                : undefined,
              genres: cached.media.genres ? JSON.parse(cached.media.genres) : [],
              episodes: cached.episodes.map((ep) => ({
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
      setAllanimeExtId(null)
      setAllanimeId(null)
      setAnikotoExtId(null)
      setAnikotoSlug(null)
      setAnikotoResolveError(null)
      setProvidersResolved(false)

      try {
        // Load only the selected provider. No automatic fallback.
        if (streamingProvider === 'allanime') {
          try {
            const metadata = await loadExtension(ALLANIME_EXTENSION)
            setAllanimeExtId(metadata.id)
            console.log('[Watch] Resolving AllAnime ID for:', {
              title: result.title,
              english_name: result.english_name,
              synonyms: result.title_synonyms,
              type: result.type,
              episode_count: result.episode_count,
              year: result.year,
              malId,
            })
            const resolvedId = await resolveAllanimeId(
              result.title,
              'anime',
              malId,
              result.english_name,
              result.year,
              result.title_synonyms,
              result.type,
              result.episode_count,
              result.native_name,
              result.season?.quarter
            )
            console.log('[Watch] Resolved AllAnime ID:', resolvedId)
            if (resolvedId) {
              setAllanimeId(resolvedId)
            } else {
              console.warn('[Watch] Could not resolve AllAnime ID for:', result.title)
            }
          } catch (err) {
            console.warn('[Watch] Failed to load AllAnime extension:', err)
          }
        }

        const slugExtension = slugProviderExtension(streamingProvider, {
          anikotoApiBaseUrl,
          anikotoSiteBaseUrl,
          anikotoYotochanBaseUrl,
        })
        const providerName = streamingProviderLabel(streamingProvider)
        if (slugExtension) {
          try {
            const metadata = await loadExtension(slugExtension)
            setAnikotoExtId(metadata.id)
            const match = await resolveAnikotoSlug(result, (query) =>
              searchAnime(metadata.id, query, 5)
            )
            const queries = buildAnikotoSearchQueries(result)
            if (match?.id) {
              console.log(`[Watch] Resolved ${providerName} slug:`, {
                query: match.query,
                slug: match.id,
                title: match.title,
                score: match.score,
              })
              setAnikotoSlug(match.id)
              setAnikotoResolveError(null)
            } else if (queries.length > 0) {
              setAnikotoResolveError(`No ${providerName} match found for: ${queries.join(', ')}`)
              console.warn(`[Watch] Could not resolve ${providerName} slug from queries:`, queries)
            } else if (!queries.length) {
              setAnikotoResolveError(`No ${providerName} search query available for ${result.title}`)
              console.warn(`[Watch] No ${providerName} search queries for:`, result.title)
            }
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
            setAnikotoResolveError(`${providerName} search failed: ${msg}`)
            console.warn(`[Watch] Failed to resolve ${providerName} slug:`, err)
          }
        }
      } finally {
        setProvidersResolved(true)
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
  }, [
    malId,
    initialEpisodeId,
    streamingProvider,
    anikotoApiBaseUrl,
    anikotoSiteBaseUrl,
    anikotoYotochanBaseUrl,
  ])

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
      setIsLegacyLocalTsDownload(false)

      let didComplete = false
      try {
        // Step 1: Load watch progress FIRST (skip if PiP already set the time)
        try {
          if (pipResumeOverrideRef.current) {
            // PiP expand already set the resume time — don't overwrite with DB value
            pipResumeOverrideRef.current = false
          } else {
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
          } // close else (pip override check)
        } catch {
          setResumeTime(0)
        }

        // Step 2: Load video sources AFTER watch progress is loaded
        // Check if episode is downloaded first (never let this throw kill the
        // whole flow - fall back to streaming if the check errors).
        let filePath: string | null = null
        try {
          filePath = await getEpisodeFilePath(malId, currentEpisode.number)
        } catch (fpErr) {
          console.warn('[Watch] getEpisodeFilePath failed, falling back to streaming', fpErr)
          filePath = null
        }
        let localSourceLoaded = false
        let localIsLegacyTsDownload = false

        if (filePath) {
          try {
            const fileSize = await getLocalFileSize(filePath)
            // Guard against earlier buggy downloads that saved only the HLS
            // playlist text (~tens of KB) instead of the actual media.
            if (!shouldUseLocalDownload(filePath, fileSize)) {
              console.warn('[Watch] Local download too small to be valid video, ignoring', {
                filePath,
                fileSize,
              })
              filePath = null
            }
          } catch (sizeErr) {
            console.warn('[Watch] Failed to stat local file, ignoring offline copy', sizeErr)
            filePath = null
          }
        }

        if (filePath) {
          try {
            localIsLegacyTsDownload = await isLegacyTsDownload(filePath)
          } catch (legacyErr) {
            console.warn('[Watch] Failed to inspect local download container', legacyErr)
          }
        }

        const downloadedSubtitles = filePath
          ? await getDownloadedSubtitles(filePath).catch((err) => {
              console.warn('[Watch] Failed to load downloaded subtitles', err)
              return []
            })
          : []
        const localSourceType = filePath && isLocalHlsPlaylist(filePath) ? 'hls' : 'video/mp4'

        if (filePath && isAndroid() && !localIsLegacyTsDownload) {
          // Android: Use convertFileSrc for directly playable downloads. Legacy
          // .otaku TS files must use the video server so bytes are decrypted.
          const localUrl = convertFileSrc(filePath)
          setIsLegacyLocalTsDownload(localIsLegacyTsDownload)
          setSources({
            sources: [
              {
                url: localUrl,
                quality: 'Downloaded',
                type: localSourceType,
                server: 'Local',
              },
            ],
            subtitles: downloadedSubtitles,
          })
          localSourceLoaded = true
          if (shownOfflineToastRef.current !== currentEpisodeId) {
            shownOfflineToastRef.current = currentEpisodeId
            toastInfo('Offline Mode', 'Playing from downloaded video')
          }
        } else if (filePath && videoServerInfo) {
          // Desktop/iOS: Use video server for local file (proper Range request support for large files)
          const localUrl = `http://127.0.0.1:${videoServerInfo.port}/absolute?path=${encodeURIComponent(filePath)}&token=${videoServerInfo.token}`
          setIsLegacyLocalTsDownload(localIsLegacyTsDownload)
          setSources({
            sources: [
              {
                url: localUrl,
                quality: 'Downloaded',
                type: localSourceType,
                server: 'Local',
              },
            ],
            subtitles: downloadedSubtitles,
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
            setIsLegacyLocalTsDownload(localIsLegacyTsDownload)
            setSources({
              sources: [
                {
                  url: localUrl,
                  quality: 'Downloaded',
                  type: localSourceType,
                  server: 'Local',
                },
              ],
              subtitles: downloadedSubtitles,
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

        // Fetch streaming sources if no local source was loaded
        if (!localSourceLoaded) {
          setIsLegacyLocalTsDownload(false)
          const canUseAllAnime = streamingProvider === 'allanime' && !!allanimeExtId && !!allanimeId
          const canUseAnikoto = streamingProvider !== 'allanime' && !!anikotoExtId && !!anikotoSlug

          if (!canUseAllAnime && !canUseAnikoto) {
            if (providersResolved) {
              if (anikotoResolveError && streamingProvider !== 'allanime') {
                throw new Error(`${streamingProviderLabel(streamingProvider)} provider failed: ${anikotoResolveError}`)
              }
              const providerName = streamingProviderLabel(streamingProvider)
              throw new Error(
                `${providerName} could not resolve this anime. Switch provider in Settings or use the button here.`
              )
            }
            // Providers still resolving - keep loading spinner visible.
            return
          }

          let result: VideoSources | null = null

          if (canUseAllAnime) {
            // Build AllAnime episode ID: {allanimeId}::{episodeNumber}
            const allanimeEpisodeId = `${allanimeId}::${currentEpisode.number}`
            result = await getVideoSources(allanimeExtId, allanimeEpisodeId)

            // If no valid sources, the cached AllAnime ID may be wrong - clear and re-resolve
            const hasValidSources = result.sources.some((s) => s.url && s.url.length > 0)
            if (!hasValidSources && malId && details) {
              console.warn(
                '[Watch] No valid AllAnime sources - clearing stale mapping and re-resolving'
              )
              await clearAllanimeMapping(malId)
              const freshId = await resolveAllanimeId(
                details.title,
                'anime',
                malId,
                details.english_name,
                details.year,
                details.title_synonyms,
                details.type,
                details.episode_count,
                details.native_name,
                details.season?.quarter
              )
              if (freshId && freshId !== allanimeId) {
                setAllanimeId(freshId)
                const freshEpisodeId = `${freshId}::${currentEpisode.number}`
                result = await getVideoSources(allanimeExtId, freshEpisodeId)
              }
            }
          }

          if (canUseAnikoto) {
            const anikotoEpisodeId = `${anikotoSlug}::${currentEpisode.number}`
            result = await getVideoSources(anikotoExtId, anikotoEpisodeId)
          }

          const hasFinalPlayableSources =
            result?.sources.some((s) => s.url && s.url.length > 0) ?? false
          if (!hasFinalPlayableSources) {
            const providerName = streamingProviderLabel(streamingProvider)
            throw new Error(
              `${providerName} returned no playable sources. Switch provider in Settings or use the button here.`
            )
          }

          setSources(result)
        }
        didComplete = true
      } catch (err) {
        // Tauri rejects with a String (from Result<T, String>), not an Error.
        // Extract the actual message instead of falling back to a generic one,
        // so users see the real failure reason in the UI.
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : err && typeof err === 'object' && 'message' in err
                ? String((err as { message: unknown }).message)
                : `Failed to load video sources (${String(err)})`
        setError(msg)
        didComplete = true
      } finally {
        // Only clear loading if we actually finished (not waiting for allanimeId)
        if (didComplete) {
          setLoading(false)
        }
      }
    }

    loadProgressAndSources()
  }, [
    currentEpisodeId,
    currentEpisode,
    malId,
    details,
    videoServerInfo,
    allanimeExtId,
    allanimeId,
    anikotoExtId,
    anikotoSlug,
    anikotoResolveError,
    providersResolved,
    streamingProvider,
  ])

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
    window.history.back()
  }

  const { isMobile, isPortrait } = useMobileLayout()
  const mobilePortrait = isMobile && isPortrait
  const alternateProvider = nextStreamingProvider(streamingProvider)
  const alternateProviderLabel = streamingProviderLabel(alternateProvider)
  const switchProvider = () => {
    setError(null)
    setSources(null)
    setLoading(true)
    updateSettings({ streamingProvider: alternateProvider })
  }
  const providerSwitchButton = (
    <button
      onClick={switchProvider}
      className="mt-4 rounded-md bg-[#e50914] px-4 py-2 text-sm font-semibold text-white hover:bg-[#f21b2a]"
    >
      Try {alternateProviderLabel}
    </button>
  )
  const initialPlaybackTime = getInitialPlaybackTime(resumeTime, {
    isLegacyTsDownload: isLegacyLocalTsDownload,
  })
  const canSeekCurrentSource = canSeekLocalDownload({
    isLegacyTsDownload: isLegacyLocalTsDownload,
  })

  // Mobile portrait: video top + episode list below (scrollable page)
  if (mobilePortrait) {
    return (
      <div className="min-h-screen bg-black" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {/* Back header */}
        <div className="flex items-center px-3 py-2">
          <button
            onClick={handleGoBack}
            className="flex items-center gap-1.5 px-3 py-1.5 text-white/80 active:text-white text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            Back
          </button>
        </div>

        {/* Video area — 16:9 */}
        <div className="w-full aspect-video bg-black">
          {loading && (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="w-10 h-10 animate-spin text-[var(--color-accent-primary)]" />
            </div>
          )}
          {error && (
            <div className="w-full h-full flex flex-col items-center justify-center text-white p-4">
              <p className="text-base font-semibold mb-1">Error Loading Video</p>
              <p className="text-sm text-[var(--color-text-secondary)]">{error}</p>
              {providerSwitchButton}
            </div>
          )}
          {!loading && !error && sources && sources.sources.length > 0 && (
            <VideoPlayer
              sources={sources.sources}
              subtitles={sources.subtitles}
              mediaId={malId}
              episodeId={currentEpisodeId}
              episodeTitle={currentEpisode?.title}
              currentEpisode={currentEpisode?.number}
              totalEpisodes={details?.episodes.length}
              episodes={details?.episodes}
              onEpisodeSelect={handleEpisodeSelect}
              onNextEpisode={handleNextEpisode}
              onPreviousEpisode={handlePreviousEpisode}
              initialTime={initialPlaybackTime}
              disableSeeking={!canSeekCurrentSource}
              isLegacyTsDownload={isLegacyLocalTsDownload}
              autoPlay
              posterUrl={currentEpisode?.thumbnail || details?.cover_url}
            />
          )}
          {!loading && !error && sources && sources.sources.length === 0 && (
            <div className="w-full h-full flex flex-col items-center justify-center text-white p-4">
              <p className="text-base font-semibold mb-1">No Video Sources</p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                No streaming sources available.
              </p>
              {providerSwitchButton}
            </div>
          )}
        </div>

        {/* Episode info + list below video */}
        <div className="p-4">
          {details && (
            <div className="mb-4">
              <h2 className="text-lg font-bold text-white">{details.title}</h2>
              {currentEpisode && (
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                  Episode {currentEpisode.number}
                  {currentEpisode.title ? ` - ${currentEpisode.title}` : ''}
                </p>
              )}
            </div>
          )}

          {/* Episode grid */}
          {details?.episodes && details.episodes.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-3">
                Episodes
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {details.episodes.map((ep) => (
                  <button
                    key={ep.id}
                    onClick={() => handleEpisodeSelect(ep.id)}
                    className={`py-2.5 rounded text-sm font-medium transition-colors ${
                      ep.id === currentEpisodeId
                        ? 'bg-[var(--color-accent-primary)] text-white'
                        : 'bg-white/10 text-[var(--color-text-secondary)] active:bg-white/20'
                    }`}
                  >
                    {ep.number}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Desktop / landscape fullscreen layout
  // VideoPlayer handles its own top bar (back button, title) and episode sidebar
  return (
    <div className="fixed inset-0 bg-black z-50">
      {loading && (
        <div className="w-full h-full flex items-center justify-center">
          <Loader2 className="w-12 h-12 animate-spin text-[#e50914]" />
        </div>
      )}

      {error && (
        <div className="w-full h-full flex flex-col items-center justify-center text-white">
          <p className="text-lg font-semibold mb-2">Error Loading Video</p>
          <p className="text-white/60">{error}</p>
          {providerSwitchButton}
        </div>
      )}

      {!loading && !error && sources && sources.sources.length > 0 && (
        <VideoPlayer
          sources={sources.sources}
          subtitles={sources.subtitles}
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
          initialTime={initialPlaybackTime}
          disableSeeking={!canSeekCurrentSource}
          isLegacyTsDownload={isLegacyLocalTsDownload}
          autoPlay
          posterUrl={currentEpisode?.thumbnail || details?.cover_url}
        />
      )}

      {!loading && !error && sources && sources.sources.length === 0 && (
        <div className="w-full h-full flex flex-col items-center justify-center text-white">
          <p className="text-lg font-semibold mb-2">No Video Sources Available</p>
          <p className="text-white/60">
            This episode does not have any available streaming sources.
          </p>
          {providerSwitchButton}
        </div>
      )}
    </div>
  )
}
