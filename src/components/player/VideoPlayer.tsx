/**
 * VideoPlayer Component
 *
 * Full-featured video player with HLS support, quality selection,
 * server selection, and episode navigation.
 *
 * UI matches mocks/watch.html exactly:
 * - Flex layout: video-area (flex-1) + episode sidebar (320px)
 * - Gradient overlays, center play button, skip intro
 * - Top bar with back button + title
 * - Controls: play, skip±10, volume, time | quality pill, server pill, next, fullscreen, sidebar toggle
 * - Progress bar with buffered + played + thumb + tooltip
 * - Episode sidebar with season tabs + thumbnailed list
 * - Keyboard shortcuts hint (auto-fades)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import Hls from 'hls.js'
import { Loader2, RotateCcw, SkipForward } from 'lucide-react'
import type { VideoSource } from '@/types/extension'
import {
  saveWatchProgress,
  deleteEpisodeDownload,
  getVideoServerInfo,
  type VideoServerUrls,
} from '@/utils/tauri-commands'
import { DownloadButton } from './DownloadButton'
import { usePlayerStore } from '@/store/playerStore'
import { useSettingsStore } from '@/store/settingsStore'
import { usePipStore } from '@/store/pipStore'
import { notifySuccess } from '@/utils/notify'
import { isMobile, isAndroid, isIOS } from '@/utils/platform'
import {
  pickSource,
  resolutionsForServer,
  parseQualityPreference,
  isAdaptive,
  type QualityPreference,
} from '@/utils/pickSource'

// Helper to create proxy URL for HLS streaming via embedded video server
function createProxyUrl(videoServer: VideoServerUrls, url: string): string {
  return `${videoServer.proxy_base_url}?token=${videoServer.token}&url=${encodeURIComponent(url)}`
}

// Helper to create HLS manifest rewriting URL (rewrites segment URLs to go through /proxy)
// Used for native HLS playback on Android where HLS.js MSE fails
function createHlsProxyUrl(videoServer: VideoServerUrls, m3u8Url: string): string {
  const baseUrl = videoServer.proxy_base_url.replace(/\/proxy$/, '')
  return `${baseUrl}/hls?token=${videoServer.token}&url=${encodeURIComponent(m3u8Url)}`
}

interface Episode {
  id: string
  number: number
  title?: string
  thumbnail?: string
}

interface VideoPlayerProps {
  sources: VideoSource[]
  mediaId?: string
  episodeId?: string
  animeTitle?: string
  episodeTitle?: string
  currentEpisode?: number
  totalEpisodes?: number
  episodes?: Episode[]
  onNextEpisode?: () => void
  onPreviousEpisode?: () => void
  onEpisodeSelect?: (episodeId: string) => void
  onGoBack?: () => void
  onProgress?: (time: number) => void
  initialTime?: number
  autoPlay?: boolean
  posterUrl?: string
}

export function VideoPlayer({
  sources,
  mediaId,
  episodeId,
  animeTitle,
  episodeTitle,
  currentEpisode,
  episodes,
  onNextEpisode,
  onPreviousEpisode,
  onEpisodeSelect,
  onGoBack,
  onProgress,
  initialTime = 0,
  autoPlay = true,
  posterUrl,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const sidebarEpisodeRef = useRef<HTMLDivElement>(null)
  // Tracks when the episode first hit the completion threshold (for auto-delete cooldown)
  const completedAtRef = useRef<number | null>(null)

  // Get settings from stores
  const playerSettings = usePlayerStore((state) => state.settings)
  const markWatchedThreshold = useSettingsStore((state) => state.markWatchedThreshold)
  const defaultVolume = useSettingsStore((state) => state.defaultVolume)
  const autoDeleteWatched = useSettingsStore((state) => state.autoDeleteWatched)

  // Get updateSettings from playerStore for persisting volume
  const updatePlayerSettings = usePlayerStore((state) => state.updateSettings)

  // Reset completion tracking when episode changes
  useEffect(() => {
    completedAtRef.current = null
  }, [episodeId])

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Initialize from playerStore (persisted) or fall back to defaultVolume for new users
  const [volume, setVolume] = useState(playerSettings.volume ?? defaultVolume)
  const [isMuted, setIsMuted] = useState(playerSettings.muted ?? false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPiP, setIsPiP] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [loading, setLoading] = useState(true)
  const [buffering, setBuffering] = useState(false)
  const [isSeeking, setIsSeeking] = useState(false)
  const [bufferedPercentage, setBufferedPercentage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showNextEpisodeOverlay, setShowNextEpisodeOverlay] = useState(false)
  const [countdown, setCountdown] = useState(3)

  // Progress bar hover preview state (time only - no thumbnails to avoid excessive requests)
  const [hoverPreview, setHoverPreview] = useState<{
    visible: boolean
    x: number
    time: number
  }>({ visible: false, x: 0, time: 0 })
  const progressBarRef = useRef<HTMLDivElement>(null)

  // Skip indicator state for stacking +10/-10 feature
  const [skipAmount, setSkipAmount] = useState<{
    direction: 'forward' | 'backward'
    amount: number
  } | null>(null)
  const skipTimeoutRef = useRef<number | null>(null)

  // Volume indicator state for visual feedback
  const [volumeIndicator, setVolumeIndicator] = useState<{
    level: number
    direction: 'up' | 'down'
  } | null>(null)
  const volumeIndicatorTimeoutRef = useRef<number | null>(null)

  // Performance: Throttle time updates to prevent frame drops
  const lastTimeUpdateRef = useRef(0)
  const lastBufferUpdateRef = useRef(0)

  // Auto-hide controls timer for fullscreen mode
  const hideControlsTimerRef = useRef<number | null>(null)

  // Video fit mode: contain (letterbox), cover (crop to fill), fill (stretch)
  const [videoFitMode, setVideoFitMode] = useState<'contain' | 'cover' | 'fill'>(
    playerSettings.videoFitMode ?? 'contain'
  )

  const cycleVideoFit = () => {
    const modes: Array<'contain' | 'cover' | 'fill'> = ['contain', 'cover', 'fill']
    const next = modes[(modes.indexOf(videoFitMode) + 1) % modes.length]
    setVideoFitMode(next)
    updatePlayerSettings({ videoFitMode: next })
  }

  const fitModeLabel =
    videoFitMode === 'contain' ? 'FIT' : videoFitMode === 'cover' ? 'FILL' : 'STRETCH'

  // PiP store for entering mini player mode
  const enterPip = usePipStore((state) => state.enterPip)
  const closePipStore = usePipStore((state) => state.closePip)
  const pipIsActive = usePipStore((state) => state.isActive)
  const navigatePip = useNavigate()

  const [selectedServer, setSelectedServer] = useState(0)
  // Quality preference as a structured value - 'Auto' / 'best' / 'worst' / number
  // Persisted to playerStore.preferredQuality; parsed defensively to tolerate
  // legacy string values ("720p", "1080p") written by pre-v1.3 builds.
  const [qualityPref, setQualityPref] = useState<QualityPreference>(
    parseQualityPreference(playerSettings.preferredQuality),
  )
  // HLS variant heights discovered at playback time (adaptive sources only).
  // Empty for fixed-MP4 sources; those expose resolutions via sources[] instead.
  const [hlsLevels, setHlsLevels] = useState<number[]>([])
  const [videoServer, setVideoServer] = useState<VideoServerUrls | null>(null)

  // New mock-matching UI state
  const [showSidebar, setShowSidebar] = useState(!isMobile()) // Open by default on desktop
  const [showShortcutsHint, setShowShortcutsHint] = useState(true)
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false)
  const [serverMenuOpen, setServerMenuOpen] = useState(false)

  // Progress bar drag state
  const [isDragging, setIsDragging] = useState(false)

  // Group sources by server (memoized to prevent unnecessary recalculations)
  const serverGroups = useMemo(() => {
    return sources.reduce(
      (acc, source, index) => {
        const serverName = source.server || `Server ${index + 1}`
        if (!acc[serverName]) {
          acc[serverName] = []
        }
        acc[serverName].push({ ...source, originalIndex: index })
        return acc
      },
      {} as Record<string, Array<VideoSource & { originalIndex: number }>>
    )
  }, [sources])

  const servers = useMemo(() => Object.keys(serverGroups), [serverGroups])
  const currentServerSources = useMemo(
    () => serverGroups[servers[selectedServer]] || [],
    [serverGroups, servers, selectedServer]
  )

  // The concrete VideoSource actually fed to the video element. For adaptive
  // HLS this is the master playlist (HLS.js picks levels internally); for
  // fixed MP4 it is the exact variant matching qualityPref.
  const currentSource = useMemo(() => {
    const serverName = servers[selectedServer]
    if (!serverName) return undefined
    return pickSource(sources, serverName, qualityPref)
  }, [sources, servers, selectedServer, qualityPref])

  // Fixed-variant resolutions available on the currently selected server.
  // UI uses this to render quality options for non-HLS sources; adaptive
  // HLS servers rely on hlsLevels populated by the MANIFEST_PARSED event.
  const fixedResolutions = useMemo(
    () => (servers[selectedServer] ? resolutionsForServer(sources, servers[selectedServer]) : []),
    [sources, servers, selectedServer],
  )

  // Unified quality options exposed to the UI. Label '' is the 'Auto' entry.
  const availableQualities = useMemo(() => {
    const out = ['Auto']
    const seen = new Set<number>()
    for (const h of hlsLevels) if (!seen.has(h)) { seen.add(h); out.push(`${h}p`) }
    for (const h of fixedResolutions) if (!seen.has(h)) { seen.add(h); out.push(`${h}p`) }
    return out
  }, [hlsLevels, fixedResolutions])

  // The display label for the currently-selected quality preference.
  const selectedQuality = useMemo(() => {
    if (qualityPref === 'Auto') return 'Auto'
    if (qualityPref === 'best' || qualityPref === 'worst') return qualityPref
    return `${qualityPref}p`
  }, [qualityPref])

  // Load video server info on mount
  useEffect(() => {
    getVideoServerInfo()
      .then(setVideoServer)
      .catch((err) => console.error('Failed to get video server info:', err))
  }, [])

  // Initialize HLS and load video
  useEffect(() => {
    const video = videoRef.current
    if (!video || sources.length === 0) return

    if (!currentSource || !currentSource.url) {
      // Defer setState to avoid synchronous setState in effect body
      const timeoutId = setTimeout(() => {
        setError('No video source available')
        setLoading(false)
      }, 0)
      return () => clearTimeout(timeoutId)
    }

    const loadVideo = async () => {
      setLoading(true)
      setError(null)

      try {
        // CRITICAL: Clean up previous video source before loading new one
        // This prevents double audio when switching between sources
        video.pause()
        if (hlsRef.current) {
          hlsRef.current.destroy()
          hlsRef.current = null
        }
        video.removeAttribute('src')
        video.load() // Reset the video element

        // Wait for video server to be ready
        if (!videoServer) {
          setLoading(true)
          return // Will retry when videoServer becomes available
        }

        // Check if this is actually an HLS stream by looking at the URL
        const isActuallyHls =
          currentSource.url.toLowerCase().includes('.m3u8') ||
          currentSource.url.toLowerCase().includes('m3u8')

        if (isActuallyHls && Hls.isSupported()) {
          // HLS.js already cleaned up at the start of loadVideo, create new instance
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            debug: false, // Disable debug logs for performance
            maxBufferLength: 60, // Buffer 60 seconds ahead for smoother playback
            maxMaxBufferLength: 600, // Max 10 minutes buffer
            maxBufferSize: 120 * 1000 * 1000, // 120 MB buffer for high-bitrate videos
            maxBufferHole: 0.5, // Allow small gaps
            highBufferWatchdogPeriod: 2, // Check buffer health every 2s
            nudgeMaxRetry: 5,
            // Increased timeouts for large files and slower connections
            manifestLoadingTimeOut: 30000, // 30 seconds for manifest
            manifestLoadingMaxRetry: 3,
            levelLoadingTimeOut: 30000, // 30 seconds for level playlists
            levelLoadingMaxRetry: 3,
            fragLoadingTimeOut: 60000, // 60 seconds for fragments (large segments)
            fragLoadingMaxRetry: 5,
            // Use xhrSetup to proxy all requests through video server
            xhrSetup: (xhr, url) => {
              // Rewrite URL to go through our video server proxy
              const proxyUrl = createProxyUrl(videoServer, url)
              xhr.open('GET', proxyUrl, true)
            },
          })

          hlsRef.current = hls

          // Load the proxied URL
          const proxyUrl = createProxyUrl(videoServer, currentSource.url)
          hls.loadSource(proxyUrl)
          hls.attachMedia(video)

          hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
            setLoading(false)

            // Capture HLS variant heights discovered at manifest parse time.
            // These feed the quality dropdown alongside any fixed-variant
            // resolutions from sources[] (dedup happens in the UI memo).
            const heights = data.levels.map((level) => level.height).filter((h) => h > 0)
            setHlsLevels(heights)

            // Apply preferred quality now that levels are known. pickSource
            // would have returned the HLS master (adaptive) for qualityPref
            // 'Auto'; for an explicit numeric preference we need to tell
            // HLS.js which variant to lock to.
            if (typeof qualityPref === 'number') {
              const idx = data.levels.findIndex((lvl) => lvl.height === qualityPref)
              if (idx !== -1) hls.currentLevel = idx
            } else if (qualityPref === 'best') {
              const maxIdx = data.levels.reduce(
                (best, lvl, i) => (lvl.height > data.levels[best].height ? i : best),
                0,
              )
              hls.currentLevel = maxIdx
            } else if (qualityPref === 'worst') {
              const minIdx = data.levels.reduce(
                (worst, lvl, i) => (lvl.height < data.levels[worst].height ? i : worst),
                0,
              )
              hls.currentLevel = minIdx
            } else {
              // 'Auto' - let HLS.js ABR decide.
              hls.currentLevel = -1
            }

            if (autoPlay) {
              video.play().catch((e) => console.error('Autoplay failed:', e))
            }

            // Seek to initial time if provided
            if (initialTime > 0) {
              video.currentTime = initialTime
            }
          })

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  // If it's a manifest error, this is not an HLS stream - fall back to direct playback
                  if (
                    (data.details === 'manifestLoadError' ||
                      data.details === 'manifestParsingError') &&
                    videoServer
                  ) {
                    hls.destroy()
                    hlsRef.current = null

                    // Use video server proxy for direct video playback
                    const proxyUrl = createProxyUrl(videoServer, currentSource.url)
                    video.src = proxyUrl
                    setLoading(false)

                    if (autoPlay) {
                      video.play().catch(() => {})
                    }

                    if (initialTime > 0) {
                      video.currentTime = initialTime
                    }
                  } else {
                    setError(`Network error: ${data.details}`)
                    hls.startLoad()
                  }
                  break
                case Hls.ErrorTypes.MEDIA_ERROR:
                  // On Android, MSE codec support can be buggy (bufferAppendError).
                  // Fall back to native HLS playback with rewritten manifest.
                  if (isAndroid() && videoServer) {
                    console.log(
                      '[VideoPlayer] HLS.js media error on Android, falling back to native HLS'
                    )
                    hls.destroy()
                    hlsRef.current = null

                    const hlsUrl = createHlsProxyUrl(videoServer, currentSource.url)
                    video.src = hlsUrl
                    setError(null)

                    const handleNativeLoaded = () => {
                      setLoading(false)
                      if (initialTime > 0) {
                        video.currentTime = initialTime
                      }
                      if (autoPlay) {
                        video.play().catch(() => {})
                      }
                      video.removeEventListener('loadedmetadata', handleNativeLoaded)
                    }
                    video.addEventListener('loadedmetadata', handleNativeLoaded)
                  } else {
                    setError(`Media error: ${data.details}`)
                    hls.recoverMediaError()
                  }
                  break
                default:
                  // On Android, any fatal HLS.js error should fall back to native HLS
                  if (isAndroid() && videoServer) {
                    console.log(
                      '[VideoPlayer] HLS.js fatal error on Android, falling back to native HLS:',
                      data.details
                    )
                    hls.destroy()
                    hlsRef.current = null

                    const hlsUrl2 = createHlsProxyUrl(videoServer, currentSource.url)
                    video.src = hlsUrl2
                    setError(null)

                    const handleNativeLoaded2 = () => {
                      setLoading(false)
                      if (initialTime > 0) {
                        video.currentTime = initialTime
                      }
                      if (autoPlay) {
                        video.play().catch(() => {})
                      }
                      video.removeEventListener('loadedmetadata', handleNativeLoaded2)
                    }
                    video.addEventListener('loadedmetadata', handleNativeLoaded2)
                  } else {
                    setError(`Fatal error: ${data.details}`)
                    setLoading(false)
                  }
                  break
              }
            }
          })
        } else if (
          isActuallyHls &&
          (video.canPlayType('application/vnd.apple.mpegurl') || isAndroid())
        ) {
          // Native HLS support (Safari, Android) - only for actual HLS streams
          // Android's MediaPlayer has built-in HLS support but needs rewritten manifest
          // so segment URLs go through our proxy (which adds Referer headers).
          // Note: On Android, this branch is only reached if Hls.isSupported() is false
          // (rare). The primary Android path is HLS.js with error-handler fallback above.
          const hlsUrl = isAndroid()
            ? createHlsProxyUrl(videoServer, currentSource.url)
            : createProxyUrl(videoServer, currentSource.url)
          video.src = hlsUrl

          // Seek to initial time when metadata is loaded
          const handleLoadedMetadata = () => {
            setLoading(false)
            if (initialTime > 0) {
              video.currentTime = initialTime
            }

            if (autoPlay) {
              video.play().catch(() => {})
            }

            video.removeEventListener('loadedmetadata', handleLoadedMetadata)
          }

          video.addEventListener('loadedmetadata', handleLoadedMetadata)
        } else {
          // Direct MP4 playback (including downloaded videos and remote non-HLS)
          let videoUrl = currentSource.url
          if (
            videoServer &&
            currentSource.url.startsWith('http') &&
            !currentSource.url.includes('127.0.0.1')
          ) {
            // Remote URL - proxy through video server
            videoUrl = createProxyUrl(videoServer, currentSource.url)
          }

          video.src = videoUrl

          // Handle video errors
          const handleError = (e: Event) => {
            const videoEl = e.target as HTMLVideoElement
            const error = videoEl.error
            if (error && error.code !== MediaError.MEDIA_ERR_NETWORK) {
              setError(`Video error: ${error.message || 'Unknown error'}`)
            }
          }
          video.addEventListener('error', handleError)

          // Handle successful loading
          const handleCanPlay = () => {
            setLoading(false)
          }
          video.addEventListener('canplay', handleCanPlay)

          setLoading(false)

          // Seek to initial time when metadata is loaded
          const handleLoadedMetadata = () => {
            if (initialTime > 0) {
              video.currentTime = initialTime
            }

            if (autoPlay) {
              video.play().catch(() => {})
            }

            video.removeEventListener('loadedmetadata', handleLoadedMetadata)
          }

          video.addEventListener('loadedmetadata', handleLoadedMetadata)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load video')
        setLoading(false)
      }
    }

    loadVideo()

    return () => {
      // Thorough cleanup to prevent double audio
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
      // Also clean up direct video sources
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    }
    // currentSource?.url as a primitive dep avoids re-running when the
    // memoized object reference changes but the URL does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer, sources, videoServer, currentSource?.url])

  // Close MiniPlayer when VideoPlayer starts playing (user navigated to /watch manually)
  useEffect(() => {
    if (pipIsActive) {
      closePipStore()
    }
  }, [sources]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply playback speed from settings
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    video.playbackRate = playerSettings.playbackSpeed
  }, [playerSettings.playbackSpeed])

  // Apply persisted volume and muted state on first load
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Apply persisted volume from playerStore
    video.volume = playerSettings.volume ?? defaultVolume
    video.muted = playerSettings.muted ?? false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount

  // Register MediaSession for OS-level audio routing (Bluetooth, AirPlay, media keys)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const video = videoRef.current

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentEpisode != null ? `Episode ${currentEpisode}` : 'Playing',
      artist: animeTitle || undefined,
    })

    navigator.mediaSession.setActionHandler('play', () => video?.play().catch(() => {}))
    navigator.mediaSession.setActionHandler('pause', () => video?.pause())
    navigator.mediaSession.setActionHandler('seekbackward', () => {
      if (video) video.currentTime = Math.max(0, video.currentTime - 10)
    })
    navigator.mediaSession.setActionHandler('seekforward', () => {
      if (video) video.currentTime = Math.min(video.duration || 0, video.currentTime + 10)
    })
    navigator.mediaSession.setActionHandler('previoustrack', () => onPreviousEpisode?.())
    navigator.mediaSession.setActionHandler('nexttrack', () => onNextEpisode?.())

    return () => {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('seekbackward', null)
      navigator.mediaSession.setActionHandler('seekforward', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
    }
  }, [animeTitle, currentEpisode, onNextEpisode, onPreviousEpisode])

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handlePlay = () => {
      setIsPlaying(true)
      setBuffering(false)
    }
    const handlePause = () => setIsPlaying(false)
    const handleTimeUpdate = () => {
      const now = Date.now()

      // Throttle to max 2 updates per second to prevent frame drops
      if (now - lastTimeUpdateRef.current < 500) return
      lastTimeUpdateRef.current = now

      setCurrentTime(video.currentTime)
      onProgress?.(video.currentTime)

      // Update buffered percentage only every 2 seconds
      if (
        now - lastBufferUpdateRef.current >= 2000 &&
        video.buffered.length > 0 &&
        video.duration > 0
      ) {
        lastBufferUpdateRef.current = now
        const bufferedEnd = video.buffered.end(video.buffered.length - 1)
        const percentage = (bufferedEnd / video.duration) * 100
        setBufferedPercentage(percentage)
      }
    }
    const handleDurationChange = () => setDuration(video.duration)
    const handleVolumeChange = () => {
      setVolume(video.volume)
      setIsMuted(video.muted)
    }
    const handleWaiting = () => {
      setBuffering(true)
    }
    const handleCanPlay = () => {
      setLoading(false)
      setBuffering(false)
    }
    const handleLoadedData = () => {
      setLoading(false)
    }
    const handleProgress = () => {
      // Update buffered percentage (throttled in handleTimeUpdate now)
      // No-op here to reduce event handler overhead
    }
    const handleEnded = () => {
      // Always show the end-of-episode overlay
      setShowNextEpisodeOverlay(true)
      setCountdown(5)
    }

    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('durationchange', handleDurationChange)
    video.addEventListener('volumechange', handleVolumeChange)
    video.addEventListener('ended', handleEnded)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('loadeddata', handleLoadedData)
    video.addEventListener('progress', handleProgress)

    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('durationchange', handleDurationChange)
      video.removeEventListener('volumechange', handleVolumeChange)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('loadeddata', handleLoadedData)
      video.removeEventListener('progress', handleProgress)
    }
  }, [onProgress])

  // Resume functionality is now handled via initialTime prop passed from watch.tsx
  // This ensures the video seeks to the saved position as soon as it loads,
  // avoiding race conditions between source loading and progress loading

  // Handle next episode countdown (only when autoPlayNext is ON and next episode exists)
  // Use array index to determine if there's a next episode, not episode number vs count
  const currentEpisodeIndex = episodes?.findIndex((ep) => ep.number === currentEpisode) ?? -1
  const hasNextEpisode = !!(
    onNextEpisode &&
    episodes &&
    currentEpisodeIndex >= 0 &&
    currentEpisodeIndex < episodes.length - 1
  )

  useEffect(() => {
    if (!showNextEpisodeOverlay) return
    // Only auto-advance when autoPlayNext is enabled and there's a next episode
    if (!playerSettings.autoPlayNext || !hasNextEpisode) return

    if (countdown === 0) {
      // Defer setState to avoid synchronous setState in effect body
      const timeoutId = setTimeout(() => {
        setShowNextEpisodeOverlay(false)
        onNextEpisode?.()
      }, 0)
      return () => clearTimeout(timeoutId)
    }

    const timer = setTimeout(() => {
      setCountdown(countdown - 1)
    }, 1000)

    return () => clearTimeout(timer)
  }, [
    showNextEpisodeOverlay,
    countdown,
    onNextEpisode,
    playerSettings.autoPlayNext,
    hasNextEpisode,
  ])

  // Replay current episode from the beginning
  const handlePlayAgain = () => {
    const video = videoRef.current
    if (!video) return
    setShowNextEpisodeOverlay(false)
    video.currentTime = 0
    video.play().catch(() => {})
  }

  // Enter Picture-in-Picture mini player mode
  const handleEnterPip = () => {
    const video = videoRef.current
    console.log('[VideoPlayer] handleEnterPip called:', {
      video: !!video,
      mediaId,
      episodeId,
      currentEpisode,
      videoServer: !!videoServer,
    })

    if (!video || !mediaId || !episodeId || typeof currentEpisode !== 'number' || !videoServer) {
      console.warn('[VideoPlayer] PiP blocked - missing:', {
        video: !!video,
        mediaId,
        episodeId,
        currentEpisode,
        videoServer: !!videoServer,
      })
      return
    }

    const currentSource = currentServerSources[0]
    if (!currentSource) {
      console.warn('[VideoPlayer] PiP blocked - no current source')
      return
    }

    const isHls = currentSource.url.toLowerCase().includes('.m3u8')
    console.log('[VideoPlayer] Entering PiP:', {
      sourceUrl: currentSource.url,
      isHls,
      currentTime: video.currentTime,
    })

    enterPip({
      sourceUrl: currentSource.url,
      isHls,
      sources,
      selectedServer,
      videoServer,
      currentTime: video.currentTime,
      duration: video.duration || 0,
      volume: video.volume,
      isMuted: video.muted,
      malId: mediaId,
      episodeId,
      animeTitle: animeTitle || 'Unknown',
      episodeNumber: currentEpisode,
    })

    // Pause video before navigating away to prevent double audio
    video.pause()

    // Navigate to home (not history.back which might go to another /watch URL)
    navigatePip({ to: '/' })
  }

  // Save watch progress periodically and on unmount
  useEffect(() => {
    if (!mediaId || !episodeId || typeof currentEpisode !== 'number') {
      return
    }

    const saveProgress = async () => {
      const video = videoRef.current
      if (!video || video.currentTime === 0 || video.currentTime < 5) {
        return
      }

      try {
        // Use the mark-as-watched threshold from settings
        const percentComplete = (video.currentTime / video.duration) * 100
        const completed = percentComplete >= markWatchedThreshold

        await saveWatchProgress(
          mediaId,
          episodeId,
          currentEpisode,
          video.currentTime,
          video.duration,
          completed
        )

        // Track when episode first reaches completion threshold
        if (completed && !completedAtRef.current) {
          completedAtRef.current = Date.now()
        }
      } catch {
        // Silently fail - watch progress save is not critical
      }
    }

    const video = videoRef.current

    // Save progress when user leaves the page or closes the app
    const handleBeforeUnload = () => {
      saveProgress()
    }

    // Save progress when tab becomes hidden (user switches tabs)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveProgress()
      }
    }

    // Save progress when video is paused
    const handlePauseSave = () => {
      saveProgress()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    video?.addEventListener('pause', handlePauseSave)

    // Save on unmount (when navigating away from player)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      video?.removeEventListener('pause', handlePauseSave)
      saveProgress()

      // Auto-delete with 5-minute cooldown — only after leaving the player
      if (autoDeleteWatched && completedAtRef.current && mediaId && currentEpisode) {
        const elapsed = Date.now() - completedAtRef.current
        const cooldownMs = 5 * 60 * 1000 // 5 minutes
        const remainingMs = Math.max(0, cooldownMs - elapsed)
        const epNum = currentEpisode
        const mId = mediaId
        const title = animeTitle || 'Episode'
        // Schedule deletion after remaining cooldown (or immediately if 5min already passed)
        setTimeout(async () => {
          try {
            await deleteEpisodeDownload(mId, epNum)
            notifySuccess(title, `Episode ${epNum} auto-deleted after watching`)
          } catch {
            // Silently fail if episode wasn't downloaded
          }
        }, remainingMs)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId, episodeId, currentEpisode])

  // Fullscreen handling
  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element
        mozFullScreenElement?: Element
        msFullscreenElement?: Element
      }
      const isFullscreen = !!(
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement
      )
      setIsFullscreen(isFullscreen)
    }

    // Listen to all fullscreen change events (for web/desktop)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)

    // On iOS, listen for Tauri window resize to detect system-gesture fullscreen exits
    // Skip on Android: we manage fullscreen state manually via OtakuBridge
    let unlistenTauri: (() => void) | undefined
    if (isMobile() && !isAndroid()) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => {
          getCurrentWindow()
            .onResized(() => {
              getCurrentWindow().isFullscreen().then(setIsFullscreen)
            })
            .then((unlisten) => {
              unlistenTauri = unlisten
            })
        })
        .catch(() => {})
    }

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
      unlistenTauri?.()
    }
  }, [])

  // Picture-in-Picture handling
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleEnterPiP = () => {
      setIsPiP(true)
      setShowControls(true)
    }

    const handleLeavePiP = () => {
      setIsPiP(false)
    }

    video.addEventListener('enterpictureinpicture', handleEnterPiP)
    video.addEventListener('leavepictureinpicture', handleLeavePiP)

    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnterPiP)
      video.removeEventListener('leavepictureinpicture', handleLeavePiP)
    }
  }, [])

  // Scroll to current episode in sidebar when opened
  useEffect(() => {
    if (showSidebar && sidebarEpisodeRef.current) {
      requestAnimationFrame(() => {
        sidebarEpisodeRef.current?.scrollIntoView({
          behavior: 'instant',
          block: 'center',
        })
      })
    }
  }, [showSidebar])

  // Auto-fade keyboard shortcuts hint after 4 seconds
  useEffect(() => {
    if (!showShortcutsHint) return
    const timer = setTimeout(() => {
      setShowShortcutsHint(false)
    }, 4000)
    return () => clearTimeout(timer)
  }, [showShortcutsHint])

  // Control functions - defined before useEffect that uses them
  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      video.play()
    } else {
      video.pause()
    }
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    // Persist muted state to store
    updatePlayerSettings({ muted: video.muted })
  }

  type FullscreenElement = HTMLDivElement & {
    webkitRequestFullscreen?: () => Promise<void>
    webkitEnterFullscreen?: () => void
    mozRequestFullScreen?: () => void
    msRequestFullscreen?: () => void
  }

  type FullscreenDocument = Document & {
    webkitFullscreenElement?: Element
    mozFullScreenElement?: Element
    msFullscreenElement?: Element
    webkitExitFullscreen?: () => void
    mozCancelFullScreen?: () => void
    msExitFullscreen?: () => void
  }

  // Web Fullscreen API (used on desktop, fallback on mobile)
  const webToggleFullscreen = () => {
    if (!containerRef.current) return

    const elem = containerRef.current as FullscreenElement
    const doc = document as FullscreenDocument

    const isFullscreenNow = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    )

    if (!isFullscreenNow) {
      const enterFs = () => {
        if (elem.requestFullscreen) {
          return elem.requestFullscreen()
        } else if (elem.webkitRequestFullscreen) {
          elem.webkitRequestFullscreen()
          return Promise.resolve()
        } else if (elem.webkitEnterFullscreen) {
          elem.webkitEnterFullscreen()
          return Promise.resolve()
        } else if (elem.mozRequestFullScreen) {
          elem.mozRequestFullScreen()
          return Promise.resolve()
        } else if (elem.msRequestFullscreen) {
          elem.msRequestFullscreen()
          return Promise.resolve()
        }
        return Promise.resolve()
      }
      enterFs()
        .then(() => {
          if (isMobile()) {
            const orient = screen.orientation as ScreenOrientation & {
              lock?: (o: string) => Promise<void>
              unlock?: () => void
            }
            orient
              ?.lock?.('landscape')
              ?.then?.(() => console.log('[VideoPlayer] Orientation locked to landscape'))
              ?.catch?.((err: Error) => console.warn('[VideoPlayer] Orientation lock failed:', err))
          }
        })
        .catch((err: Error) => console.error('Fullscreen error:', err))
    } else {
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch((err: Error) => console.error('Exit fullscreen error:', err))
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen()
      } else if (doc.mozCancelFullScreen) {
        doc.mozCancelFullScreen()
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen()
      }
      if (isMobile()) {
        const orient = screen.orientation as ScreenOrientation & {
          lock?: (o: string) => Promise<void>
          unlock?: () => void
        }
        orient?.unlock?.()
      }
    }
  }

  // Android native bridge fullscreen via @JavascriptInterface in MainActivity.kt
  // Hides system bars (status + navigation) and locks to landscape
  const androidToggleFullscreen = () => {
    const bridge = (
      window as Window & {
        OtakuBridge?: { enterFullscreen: () => void; exitFullscreen: () => void }
      }
    ).OtakuBridge
    if (!bridge) {
      console.warn('[VideoPlayer] OtakuBridge not available, falling back to web fullscreen')
      webToggleFullscreen()
      return
    }

    if (isFullscreen) {
      bridge.exitFullscreen()
      setIsFullscreen(false)
    } else {
      bridge.enterFullscreen()
      setIsFullscreen(true)
    }
  }

  // Dual-path fullscreen: Native bridge on Android (for proper immersive mode),
  // Tauri Window API on iOS, web API on desktop
  const toggleFullscreen = async () => {
    if (isAndroid()) {
      // Android: Use native bridge for immersive mode + orientation lock
      // Web Fullscreen API is broken by RustWebChromeClient.onShowCustomView()
      androidToggleFullscreen()
    } else if (isMobile()) {
      // iOS: Use Tauri API (better iOS integration)
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        const newFullscreen = !isFullscreen
        await win.setFullscreen(newFullscreen)
        setIsFullscreen(newFullscreen)
        if (newFullscreen) {
          const orient = screen.orientation as ScreenOrientation & {
            lock?: (o: string) => Promise<void>
            unlock?: () => void
          }
          orient?.lock?.('landscape')?.catch?.(() => {})
        } else {
          const orient = screen.orientation as ScreenOrientation & {
            lock?: (o: string) => Promise<void>
            unlock?: () => void
          }
          orient?.unlock?.()
        }
      } catch (err) {
        console.error('Tauri fullscreen error:', err)
        webToggleFullscreen()
      }
    } else {
      // Desktop: Web Fullscreen API
      webToggleFullscreen()
    }
  }

  // Helper function to seek with proper audio sync
  const seekToTime = (time: number) => {
    const video = videoRef.current
    if (!video) return

    // Show seeking indicator
    setIsSeeking(true)

    // Pause playback during seek to prevent audio desync
    const wasPlaying = !video.paused
    if (wasPlaying) {
      video.pause()
    }

    // Set the new time
    video.currentTime = time

    // Wait for seeked event to ensure both audio and video are at the correct position
    const handleSeeked = () => {
      setIsSeeking(false)
      if (wasPlaying) {
        video.play().catch((e) => console.error('Failed to resume after seek:', e))
      }
      video.removeEventListener('seeked', handleSeeked)
    }

    video.addEventListener('seeked', handleSeeked)
  }

  // Handle skip with stacking - clicking multiple times accumulates the skip amount
  const handleSkip = (direction: 'forward' | 'backward') => {
    const video = videoRef.current
    if (!video) return

    const skipSeconds = 10
    let newAmount = skipSeconds

    // If same direction, stack the skip amount
    if (skipAmount && skipAmount.direction === direction) {
      newAmount = skipAmount.amount + skipSeconds
    }

    // Actually seek (but only by 10 seconds from current position each click)
    const seekAmount =
      direction === 'forward'
        ? Math.min(duration - video.currentTime, skipSeconds)
        : Math.min(video.currentTime, skipSeconds)

    if (seekAmount > 0) {
      seekToTime(
        direction === 'forward' ? video.currentTime + seekAmount : video.currentTime - seekAmount
      )
    }

    // Update visual indicator
    setSkipAmount({ direction, amount: newAmount })

    // Clear existing timeout
    if (skipTimeoutRef.current) {
      clearTimeout(skipTimeoutRef.current)
    }

    // Hide indicator after 800ms of no clicks
    skipTimeoutRef.current = setTimeout(() => {
      setSkipAmount(null)
    }, 800)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current
      if (!video) return

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'f':
          e.preventDefault()
          toggleFullscreen()
          break
        case 'm':
          e.preventDefault()
          toggleMute()
          break
        case 'ArrowLeft':
          e.preventDefault()
          handleSkip('backward')
          break
        case 'ArrowRight':
          e.preventDefault()
          handleSkip('forward')
          break
        case 'ArrowUp':
          e.preventDefault()
          {
            const newVolume = Math.min(1, video.volume + 0.1)
            video.volume = newVolume
            // Persist volume to store
            updatePlayerSettings({ volume: newVolume, muted: false })
            // Show volume indicator
            setVolumeIndicator({ level: newVolume, direction: 'up' })
            if (volumeIndicatorTimeoutRef.current) {
              clearTimeout(volumeIndicatorTimeoutRef.current)
            }
            volumeIndicatorTimeoutRef.current = setTimeout(() => {
              setVolumeIndicator(null)
            }, 800)
          }
          break
        case 'ArrowDown':
          e.preventDefault()
          {
            const newVolume = Math.max(0, video.volume - 0.1)
            video.volume = newVolume
            // Persist volume to store
            updatePlayerSettings({ volume: newVolume })
            // Show volume indicator
            setVolumeIndicator({ level: newVolume, direction: 'down' })
            if (volumeIndicatorTimeoutRef.current) {
              clearTimeout(volumeIndicatorTimeoutRef.current)
            }
            volumeIndicatorTimeoutRef.current = setTimeout(() => {
              setVolumeIndicator(null)
            }, 800)
          }
          break
        case 'n':
          e.preventDefault()
          onNextEpisode?.()
          break
        case 'p':
          e.preventDefault()
          onPreviousEpisode?.()
          break
        case 'i':
          e.preventDefault()
          handleEnterPip()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, onNextEpisode, onPreviousEpisode])

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video) return

    const rect = e.currentTarget.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    const targetTime = percent * duration

    seekToTime(targetTime)
  }

  // Handle progress bar hover (time preview only)
  const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
    const progressBar = progressBarRef.current
    if (!progressBar || duration === 0) return

    const rect = progressBar.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percent = Math.max(0, Math.min(1, x / rect.width))
    const time = percent * duration

    setHoverPreview({
      visible: true,
      x,
      time,
    })
  }

  const handleProgressLeave = () => {
    setHoverPreview((prev) => ({ ...prev, visible: false }))
  }

  const changeQuality = (quality: string) => {
    // Convert UI label back to a structured preference.
    const next: QualityPreference =
      quality === 'Auto' || quality === 'best' || quality === 'worst'
        ? (quality as QualityPreference)
        : parseQualityPreference(quality)

    setQualityPref(next)
    updatePlayerSettings({ preferredQuality: String(next) })

    // For adaptive HLS, flip the HLS.js level in-session (no reload). For a
    // fixed-variant change the currentSource memo will re-pick and the
    // loadVideo effect will swap the URL - nothing more to do here.
    const hls = hlsRef.current
    if (hls && currentSource && isAdaptive(currentSource)) {
      if (next === 'Auto') {
        hls.currentLevel = -1
      } else if (typeof next === 'number') {
        const idx = hls.levels.findIndex((lvl) => lvl.height === next)
        if (idx !== -1) hls.currentLevel = idx
      } else if (next === 'best') {
        const maxIdx = hls.levels.reduce(
          (best, lvl, i) => (lvl.height > hls.levels[best].height ? i : best),
          0,
        )
        hls.currentLevel = maxIdx
      } else if (next === 'worst') {
        const minIdx = hls.levels.reduce(
          (worst, lvl, i) => (lvl.height < hls.levels[worst].height ? i : worst),
          0,
        )
        hls.currentLevel = minIdx
      }
    }

    setQualityMenuOpen(false)
  }

  const changeServer = (serverIndex: number) => {
    setSelectedServer(serverIndex)
    setServerMenuOpen(false)
  }

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
      }
      if (skipTimeoutRef.current) {
        clearTimeout(skipTimeoutRef.current)
      }
      if (volumeIndicatorTimeoutRef.current) {
        clearTimeout(volumeIndicatorTimeoutRef.current)
      }
    }
  }, [])

  // Auto-hide controls with document-level mouse tracking
  // Works in both fullscreen and windowed mode for immersive viewing
  useEffect(() => {
    // Clear any existing timer when dependencies change
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current)
      hideControlsTimerRef.current = null
    }

    // In PiP mode - always show controls
    if (isPiP) {
      setShowControls(true)
      return
    }

    // Not playing - always show controls (so user can see controls when paused)
    if (!isPlaying) {
      setShowControls(true)
      return
    }

    // Playing (+ not PiP) - enable auto-hide behavior
    // Show controls initially
    setShowControls(true)

    // Start the hide timer
    const startHideTimer = () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
      }
      hideControlsTimerRef.current = setTimeout(() => {
        setShowControls(false)
      }, 2000)
    }

    // Document-level mouse move handler
    const handleDocumentMouseMove = () => {
      setShowControls(true)
      startHideTimer()
    }

    // Add document-level listener to catch mouse movement anywhere
    document.addEventListener('mousemove', handleDocumentMouseMove)

    // On mobile: tap to toggle controls
    const handleTouchStart = () => {
      setShowControls(true)
      startHideTimer()
    }
    document.addEventListener('touchstart', handleTouchStart, { passive: true })

    // Start the initial hide timer
    startHideTimer()

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove)
      document.removeEventListener('touchstart', handleTouchStart)
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
        hideControlsTimerRef.current = null
      }
    }
  }, [isPlaying, isPiP])

  // Close pill menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.ctrl-pill')) {
        setQualityMenuOpen(false)
        setServerMenuOpen(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Progress bar drag handling
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const progressBar = progressBarRef.current
      if (!progressBar) return
      const rect = progressBar.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const time = pct * duration

      // Update visual position during drag
      setCurrentTime(time)
      setHoverPreview({ visible: true, x: e.clientX - rect.left, time })
    }

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false)
      const progressBar = progressBarRef.current
      if (!progressBar) return
      const rect = progressBar.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      seekToTime(pct * duration)
      setHoverPreview((prev) => ({ ...prev, visible: false }))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, duration])

  const mobile = isMobile()

  // Compute progress percentage
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  // Season tab logic: group episodes into seasons of 26
  const seasonCount = episodes ? Math.ceil(episodes.length / 26) : 0
  const [activeSeason, setActiveSeason] = useState(0)
  const seasonEpisodes = useMemo(() => {
    if (!episodes || seasonCount <= 1) return episodes || []
    const start = activeSeason * 26
    return episodes.slice(start, start + 26)
  }, [episodes, activeSeason, seasonCount])

  // Auto-set active season based on current episode
  useEffect(() => {
    if (!episodes || seasonCount <= 1 || typeof currentEpisode !== 'number') return
    const epIndex = episodes.findIndex((ep) => ep.number === currentEpisode)
    if (epIndex >= 0) {
      const season = Math.floor(epIndex / 26)
      setActiveSeason(season)
    }
  }, [currentEpisode, episodes, seasonCount])

  // ─── JSX ───────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex overflow-hidden"
      style={{
        // Mobile (Android/iOS): CSS fullscreen since we bypass the browser Fullscreen API
        // Native bridge hides system bars, but we still need to fill the viewport
        ...((isAndroid() || isIOS()) && isFullscreen
          ? {
              position: 'fixed' as const,
              inset: 0,
              zIndex: 9999,
              width: '100vw',
              height: '100vh',
            }
          : {}),
      }}
    >
      {/* ── Video Area ────────────────────────────────────────────── */}
      <div
        className="flex-1 relative bg-black overflow-hidden"
        style={{ cursor: !showControls && !isPiP ? 'none' : 'default' }}
        onClick={togglePlay}
        onMouseMove={() => {
          /* handled by document-level listener */
        }}
      >
        {/* Video Element */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full"
          preload="auto"
          playsInline
          poster={posterUrl}
          style={{
            objectFit: videoFitMode,
            willChange: 'transform',
            contain: 'layout style paint',
            transform: 'translateZ(0)',
          }}
        />

        {/* ── Overlay Gradients ─────────────────────────────────── */}
        <div
          className="absolute top-0 left-0 right-0 h-[120px] z-[8] pointer-events-none transition-opacity duration-[400ms]"
          style={{
            background:
              'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.3) 60%, transparent 100%)',
            opacity: showControls || !isPlaying ? 1 : 0,
          }}
        />
        <div
          className="absolute bottom-0 left-0 right-0 h-[200px] z-[8] pointer-events-none transition-opacity duration-[400ms]"
          style={{
            background:
              'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)',
            opacity: showControls || !isPlaying ? 1 : 0,
          }}
        />

        {/* ── Center Play Button ────────────────────────────────── */}
        <div
          className={`absolute top-1/2 left-1/2 z-[5] flex items-center justify-center w-[72px] h-[72px] rounded-full cursor-pointer transition-all duration-200 ${
            isPlaying ? 'opacity-0 pointer-events-none scale-[0.8]' : 'opacity-100 scale-100'
          }`}
          style={{
            transform: `translate(-50%, -50%)${isPlaying ? ' scale(0.8)' : ''}`,
            background: 'rgba(229, 9, 20, 0.85)',
            boxShadow: '0 0 60px rgba(229, 9, 20, 0.4), 0 0 120px rgba(229, 9, 20, 0.15)',
          }}
          onClick={(e) => {
            e.stopPropagation()
            togglePlay()
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget
            el.style.background = '#e50914'
            el.style.boxShadow = '0 0 80px rgba(229, 9, 20, 0.5), 0 0 140px rgba(229, 9, 20, 0.2)'
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget
            el.style.background = 'rgba(229, 9, 20, 0.85)'
            el.style.boxShadow = '0 0 60px rgba(229, 9, 20, 0.4), 0 0 120px rgba(229, 9, 20, 0.15)'
          }}
        >
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="white"
            stroke="none"
            className="ml-[3px]"
          >
            <polygon points="6,3 20,12 6,21" />
          </svg>
        </div>

        {/* ── Skip Intro Button ─────────────────────────────────── */}
        {currentTime > 0 && currentTime < 90 && (
          <div
            className={`absolute bottom-[100px] right-6 z-10 flex items-center gap-2 py-[10px] px-5 rounded cursor-pointer transition-all duration-150 ${
              showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              fontFamily: "'Inter', sans-serif",
              fontSize: '0.875rem',
              fontWeight: 600,
              letterSpacing: '0.02em',
              color: 'white',
            }}
            onClick={(e) => {
              e.stopPropagation()
              // Skip to 90 seconds
              seekToTime(90)
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)'
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)'
            }}
          >
            Skip Intro
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="13 17 18 12 13 7" />
              <polyline points="6 17 11 12 6 7" />
            </svg>
          </div>
        )}

        {/* ── Top Bar ───────────────────────────────────────────── */}
        <div
          className={`absolute top-0 left-0 right-0 z-10 flex items-center gap-4 transition-opacity duration-[400ms] ${
            mobile ? 'p-3 px-[max(12px,env(safe-area-inset-left))]' : 'py-[18px] px-6'
          } ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={(e) => e.stopPropagation()}
        >
          {onGoBack && (
            <button
              onClick={onGoBack}
              className="flex-shrink-0 flex items-center justify-center w-[38px] h-[38px] rounded-full transition-all duration-150"
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: 'white',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)'
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )}
          <div className="flex flex-col gap-[2px] min-w-0">
            {animeTitle && (
              <div className="font-display font-bold text-[0.9375rem] text-white/95 truncate">
                {animeTitle}
              </div>
            )}
            {currentEpisode && (
              <div className="text-xs text-white/50" style={{ fontFamily: "'Inter', sans-serif" }}>
                E{currentEpisode}
                {episodeTitle && !episodeTitle.toLowerCase().startsWith('episode')
                  ? ` \u00B7 ${episodeTitle}`
                  : ''}
              </div>
            )}
          </div>
        </div>

        {/* ── Bottom Controls ───────────────────────────────────── */}
        <div
          className={`absolute bottom-0 left-0 right-0 z-10 transition-opacity duration-[400ms] ${
            mobile
              ? 'px-[max(12px,env(safe-area-inset-left))] pb-[max(8px,env(safe-area-inset-bottom))]'
              : 'px-6 pb-[18px]'
          } ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Progress Bar ──────────────────────────────────── */}
          <div
            ref={progressBarRef}
            className="relative cursor-pointer mb-[14px] group/progress select-none"
            style={{ height: '3px', padding: '8px 0', boxSizing: 'content-box' }}
            onMouseDown={(e) => {
              e.preventDefault()
              setIsDragging(true)
              // Seek to clicked position immediately
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
              setCurrentTime(pct * duration)
            }}
            onMouseMove={handleProgressHover}
            onMouseLeave={handleProgressLeave}
            onClick={(e) => {
              e.stopPropagation()
              if (!isDragging) handleSeek(e)
            }}
          >
            {/* Background track */}
            <div
              className="absolute left-0 right-0 top-[8px] h-[3px] group-hover/progress:h-[5px] rounded-sm transition-[height] duration-[120ms]"
              style={{ background: 'rgba(255, 255, 255, 0.2)' }}
            />
            {/* Buffered */}
            <div
              className="absolute left-0 top-[8px] h-[3px] group-hover/progress:h-[5px] rounded-sm transition-[height] duration-[120ms] pointer-events-none"
              style={{ width: `${bufferedPercentage}%`, background: 'rgba(255, 255, 255, 0.25)' }}
            />
            {/* Played */}
            <div
              className="absolute left-0 top-[8px] h-[3px] group-hover/progress:h-[5px] rounded-sm transition-[height] duration-[120ms] pointer-events-none"
              style={{ width: `${progressPercent}%`, background: '#e50914' }}
            />
            {/* Thumb */}
            <div
              className={`absolute top-1/2 pointer-events-none transition-transform duration-[120ms] ${isDragging ? '' : 'scale-0 group-hover/progress:scale-100'}`}
              style={{
                left: `${progressPercent}%`,
                transform: `translate(-50%, -50%)${isDragging ? ' scale(1)' : ''}`,
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                background: '#e50914',
                boxShadow: '0 0 8px rgba(229, 9, 20, 0.5)',
                cursor: isDragging ? 'grabbing' : 'grab',
              }}
            />
            {/* Tooltip */}
            {hoverPreview.visible && (
              <div
                className="absolute pointer-events-none transition-opacity duration-[120ms]"
                style={{
                  top: '-28px',
                  left: `${Math.max(20, Math.min(hoverPreview.x, (progressBarRef.current?.clientWidth || 0) - 20))}px`,
                  transform: 'translateX(-50%)',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  background: 'rgba(0, 0, 0, 0.92)',
                  color: 'white',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.7rem',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatTime(hoverPreview.time)}
              </div>
            )}
          </div>

          {/* ── Controls Row ──────────────────────────────────── */}
          <div className="flex items-center justify-between">
            {/* Left group */}
            <div className="flex items-center gap-[6px]">
              {/* Play/Pause */}
              <button
                className="flex items-center justify-center w-[42px] h-[42px] rounded-full text-white/85 hover:text-white hover:bg-white/[0.08] transition-all duration-[120ms]"
                onClick={togglePlay}
                title="Play/Pause (K)"
              >
                {isPlaying ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none">
                    <rect x="5" y="3" width="4" height="18" rx="1" />
                    <rect x="15" y="3" width="4" height="18" rx="1" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none">
                    <polygon points="6,3 20,12 6,21" />
                  </svg>
                )}
              </button>

              {/* Rewind 10s */}
              <button
                className="flex items-center justify-center w-9 h-9 rounded-full text-white/85 hover:text-white hover:bg-white/[0.08] transition-all duration-[120ms]"
                onClick={() => handleSkip('backward')}
                title="Rewind 10s"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 19a8 8 0 1 0 0-14.4" />
                  <polyline points="11 4 4 4 4 11" />
                  <text
                    x="11.5"
                    y="15.5"
                    fill="currentColor"
                    stroke="none"
                    fontSize="7"
                    fontFamily="sans-serif"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    10
                  </text>
                </svg>
              </button>

              {/* Forward 10s */}
              <button
                className="flex items-center justify-center w-9 h-9 rounded-full text-white/85 hover:text-white hover:bg-white/[0.08] transition-all duration-[120ms]"
                onClick={() => handleSkip('forward')}
                title="Forward 10s"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M13 5a8 8 0 1 1 0 14.4" />
                  <polyline points="13 4 20 4 20 11" />
                  <text
                    x="12.5"
                    y="15.5"
                    fill="currentColor"
                    stroke="none"
                    fontSize="7"
                    fontFamily="sans-serif"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    10
                  </text>
                </svg>
              </button>

              {/* Volume group (desktop only) */}
              {!mobile && (
                <div className="flex items-center gap-[2px] group/volume">
                  <button
                    className="flex items-center justify-center w-9 h-9 rounded-full text-white/85 hover:text-white hover:bg-white/[0.08] transition-all duration-[120ms]"
                    onClick={toggleMute}
                    title="Mute (M)"
                  >
                    {isMuted || volume === 0 ? (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <line x1="23" y1="9" x2="17" y2="15" />
                        <line x1="17" y1="9" x2="23" y2="15" />
                      </svg>
                    ) : (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isMuted ? 0 : Math.round(volume * 100)}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) / 100
                      const video = videoRef.current
                      if (video) {
                        video.volume = v
                        if (v > 0) video.muted = false
                        updatePlayerSettings({ volume: v, muted: v === 0 })
                      }
                    }}
                    className="w-0 opacity-0 group-hover/volume:w-[72px] group-hover/volume:opacity-100 transition-all duration-200 h-1 cursor-pointer"
                    style={{ accentColor: '#e50914' }}
                  />
                </div>
              )}

              {/* Separator */}
              <div
                className="w-px h-[18px] mx-1 flex-shrink-0"
                style={{ background: 'rgba(255, 255, 255, 0.12)' }}
              />

              {/* Time display */}
              <span
                className="whitespace-nowrap ml-1"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.75rem',
                  color: 'rgba(255, 255, 255, 0.6)',
                }}
              >
                {formatTime(currentTime)} <span style={{ opacity: 0.4 }}>/</span>{' '}
                {formatTime(duration)}
              </span>
            </div>

            {/* Right group */}
            <div className="flex items-center gap-[6px]">
              {/* Quality pill */}
              <div className="ctrl-pill relative">
                <button
                  className="flex items-center gap-1 py-1 px-3 rounded transition-all duration-[120ms] whitespace-nowrap"
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: 'rgba(255, 255, 255, 0.85)',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.7rem',
                    fontWeight: 600,
                  }}
                  onClick={() => {
                    setQualityMenuOpen(!qualityMenuOpen)
                    setServerMenuOpen(false)
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)'
                    e.currentTarget.style.color = 'white'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.85)'
                  }}
                >
                  {selectedQuality}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {qualityMenuOpen && (
                  <div
                    className="absolute bottom-[calc(100%+8px)] right-0 min-w-[120px] rounded-lg overflow-hidden z-50"
                    style={{
                      background: 'rgba(0, 0, 0, 0.92)',
                      backdropFilter: 'blur(16px)',
                      WebkitBackdropFilter: 'blur(16px)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                    }}
                  >
                    {availableQualities.map((quality) => (
                      <button
                        key={quality}
                        className="w-full text-left flex items-center justify-between transition-all duration-[120ms] hover:bg-white/[0.08]"
                        style={{
                          padding: '9px 14px',
                          fontFamily: "'Inter', sans-serif",
                          fontSize: '0.8125rem',
                          color:
                            selectedQuality === quality ? '#e50914' : 'rgba(255, 255, 255, 0.65)',
                          cursor: 'pointer',
                        }}
                        onClick={() => changeQuality(quality)}
                        onMouseEnter={(e) => {
                          if (selectedQuality !== quality) e.currentTarget.style.color = 'white'
                        }}
                        onMouseLeave={(e) => {
                          if (selectedQuality !== quality)
                            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.65)'
                        }}
                      >
                        {quality}
                        {selectedQuality === quality && (
                          <span
                            className="w-[6px] h-[6px] rounded-full"
                            style={{
                              background: '#e50914',
                              boxShadow: '0 0 8px rgba(229, 9, 20, 0.5)',
                            }}
                          />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Server pill */}
              {servers.length > 1 && (
                <div className="ctrl-pill relative">
                  <button
                    className="flex items-center gap-1 py-1 px-3 rounded transition-all duration-[120ms] whitespace-nowrap"
                    style={{
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: 'rgba(255, 255, 255, 0.85)',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.7rem',
                      fontWeight: 600,
                    }}
                    onClick={() => {
                      setServerMenuOpen(!serverMenuOpen)
                      setQualityMenuOpen(false)
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)'
                      e.currentTarget.style.color = 'white'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                      e.currentTarget.style.color = 'rgba(255, 255, 255, 0.85)'
                    }}
                  >
                    {servers[selectedServer]}
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {serverMenuOpen && (
                    <div
                      className="absolute bottom-[calc(100%+8px)] right-0 min-w-[120px] rounded-lg overflow-hidden z-50"
                      style={{
                        background: 'rgba(0, 0, 0, 0.92)',
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                      }}
                    >
                      {servers.map((server, index) => (
                        <button
                          key={server}
                          className="w-full text-left flex items-center justify-between transition-all duration-[120ms] hover:bg-white/[0.08]"
                          style={{
                            padding: '9px 14px',
                            fontFamily: "'Inter', sans-serif",
                            fontSize: '0.8125rem',
                            color:
                              selectedServer === index ? '#e50914' : 'rgba(255, 255, 255, 0.65)',
                            cursor: 'pointer',
                          }}
                          onClick={() => changeServer(index)}
                          onMouseEnter={(e) => {
                            if (selectedServer !== index) e.currentTarget.style.color = 'white'
                          }}
                          onMouseLeave={(e) => {
                            if (selectedServer !== index)
                              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.65)'
                          }}
                        >
                          {server}
                          {selectedServer === index && (
                            <span
                              className="w-[6px] h-[6px] rounded-full"
                              style={{
                                background: '#e50914',
                                boxShadow: '0 0 8px rgba(229, 9, 20, 0.5)',
                              }}
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Separator */}
              <div
                className="w-px h-[18px] mx-1 flex-shrink-0"
                style={{ background: 'rgba(255, 255, 255, 0.12)' }}
              />

              {/* Video Fit Mode */}
              <button
                className="flex items-center justify-center h-9 px-2 rounded-full text-white/85 hover:text-white hover:bg-white/[0.08] transition-all duration-[120ms] font-bold tracking-wide text-[10px]"
                onClick={cycleVideoFit}
                title={`Video fit: ${fitModeLabel}`}
              >
                {fitModeLabel}
              </button>

              {/* Download */}
              {animeTitle && currentEpisode && mediaId && episodeId && (
                <DownloadButton
                  sources={sources}
                  mediaId={mediaId}
                  episodeId={episodeId}
                  animeTitle={animeTitle}
                  episodeNumber={currentEpisode}
                />
              )}

              {/* Picture-in-Picture */}
              {mediaId && episodeId && (
                <button
                  className="flex items-center justify-center w-9 h-9 rounded-full text-white/85 hover:text-white hover:bg-white/[0.08] transition-all duration-[120ms]"
                  onClick={handleEnterPip}
                  title="Mini Player"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <rect
                      x="12"
                      y="10"
                      width="9"
                      height="6"
                      rx="1"
                      fill="currentColor"
                      fillOpacity="0.4"
                      stroke="none"
                    />
                  </svg>
                </button>
              )}

              {/* Next episode */}
              {hasNextEpisode && (
                <button
                  className="flex items-center justify-center w-9 h-9 rounded-full text-white/85 hover:text-white hover:bg-white/[0.08] transition-all duration-[120ms]"
                  onClick={() => onNextEpisode?.()}
                  title="Next Episode (N)"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" opacity="0.85" />
                    <line x1="19" y1="5" x2="19" y2="19" />
                  </svg>
                </button>
              )}

              {/* Fullscreen */}
              <button
                className="flex items-center justify-center w-9 h-9 rounded-full text-white/85 hover:text-white hover:bg-white/[0.08] transition-all duration-[120ms]"
                onClick={toggleFullscreen}
                title="Fullscreen (F)"
              >
                {isFullscreen ? (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                  </svg>
                ) : (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                )}
              </button>

              {/* Separator */}
              {!mobile && episodes && episodes.length > 0 && (
                <div
                  className="w-px h-[18px] mx-1 flex-shrink-0"
                  style={{ background: 'rgba(255, 255, 255, 0.12)' }}
                />
              )}

              {/* Sidebar toggle (desktop only) */}
              {!mobile && episodes && episodes.length > 0 && (
                <button
                  className="flex items-center justify-center w-9 h-9 rounded-full text-white/85 hover:text-white hover:bg-white/[0.08] transition-all duration-[120ms]"
                  onClick={() => setShowSidebar(!showSidebar)}
                  title="Episodes"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="3" width="20" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Keyboard Shortcuts Hint ───────────────────────────── */}
        {showShortcutsHint && !mobile && (
          <div
            className="absolute bottom-[18px] left-1/2 z-10 flex items-center gap-4 py-[6px] px-4 rounded-full pointer-events-none transition-opacity duration-300"
            style={{
              transform: 'translateX(-50%)',
              background: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            {[
              { key: 'K', label: 'Play' },
              { key: 'F', label: 'Fullscreen' },
              { key: 'M', label: 'Mute' },
              { keys: ['\u2190', '\u2192'], label: 'Seek' },
              { key: 'N', label: 'Next' },
              { key: 'I', label: 'Mini' },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-[5px] text-[0.65rem] text-white/35 whitespace-nowrap"
              >
                {'keys' in item ? (
                  item.keys!.map((k, j) => (
                    <span
                      key={j}
                      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[3px] text-[0.6rem] text-white/50"
                      style={{
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {k}
                    </span>
                  ))
                ) : (
                  <span
                    className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[3px] text-[0.6rem] text-white/50"
                    style={{
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {item.key}
                  </span>
                )}
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Skip Amount Indicator ─────────────────────────────── */}
        {skipAmount && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div
              className={`flex flex-col items-center ${skipAmount.direction === 'forward' ? 'translate-x-24' : '-translate-x-24'}`}
            >
              <div className="bg-black/60 backdrop-blur-sm rounded-full p-6">
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
                  {skipAmount.direction === 'backward' ? (
                    <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
                  ) : (
                    <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
                  )}
                </svg>
              </div>
              <span className="mt-2 text-lg font-bold text-white drop-shadow-lg">
                {skipAmount.amount}s
              </span>
            </div>
          </div>
        )}

        {/* ── Volume Indicator Overlay ──────────────────────────── */}
        {volumeIndicator && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="flex flex-col items-center">
              <div className="bg-black/60 backdrop-blur-sm rounded-full p-6">
                <div className="flex items-center gap-3">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {volumeIndicator.level === 0 ? (
                      <>
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <line x1="23" y1="9" x2="17" y2="15" />
                        <line x1="17" y1="9" x2="23" y2="15" />
                      </>
                    ) : (
                      <>
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </>
                    )}
                  </svg>
                  <div className="w-24 h-2 bg-white/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white rounded-full transition-all duration-100"
                      style={{ width: `${volumeIndicator.level * 100}%` }}
                    />
                  </div>
                </div>
              </div>
              <span className="mt-2 text-lg font-bold text-white drop-shadow-lg">
                {Math.round(volumeIndicator.level * 100)}%
              </span>
            </div>
          </div>
        )}

        {/* ── Loading/Buffering/Seeking Overlay ─────────────────── */}
        {(loading || buffering || isSeeking) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 pointer-events-none z-[15]">
            <Loader2 className="w-16 h-16 animate-spin text-[#e50914]" />
            <p className="mt-4 text-sm text-white/80">
              {loading ? 'Loading video...' : isSeeking ? 'Seeking...' : 'Buffering...'}
            </p>
          </div>
        )}

        {/* ── Error Overlay ──────────────────────────────────────── */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 text-white p-8 z-[15]">
            <svg
              className="w-16 h-16 mb-4 text-red-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3 className="text-xl font-bold mb-2">Playback Error</h3>
            <p className="text-white/60">{error}</p>
          </div>
        )}

        {/* ── Episode End Overlay ─────────────────────────────── */}
        {showNextEpisodeOverlay && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center gap-6">
              {/* Play Again button */}
              <button
                onClick={handlePlayAgain}
                className="flex items-center gap-3 text-white font-medium py-3 px-6 rounded-full transition-all duration-150 hover:bg-white/[0.12]"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                <RotateCcw size={20} />
                Play Again
              </button>

              {/* Next Episode section */}
              {playerSettings.autoPlayNext && hasNextEpisode && (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-white/70">
                    Episode{' '}
                    {episodes?.[currentEpisodeIndex + 1]?.number ??
                      (currentEpisode != null ? currentEpisode + 1 : '?')}{' '}
                    in {countdown}s
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setShowNextEpisodeOverlay(false)
                        onNextEpisode?.()
                      }}
                      className="flex items-center gap-2 text-white font-semibold py-3 px-6 rounded-full transition-all duration-150"
                      style={{
                        background: 'linear-gradient(135deg, #e50914, #b20710)',
                        boxShadow: '0 0 20px rgba(229,9,20,0.3)',
                      }}
                    >
                      <SkipForward size={20} />
                      Play Next Episode
                    </button>
                    <button
                      onClick={() => setShowNextEpisodeOverlay(false)}
                      className="py-3 px-4 text-white rounded-full transition-all duration-150 hover:bg-white/[0.12] text-sm"
                      style={{
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.15)',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {(!playerSettings.autoPlayNext || !hasNextEpisode) && (
                <button
                  onClick={() => setShowNextEpisodeOverlay(false)}
                  className="text-sm text-white/50 hover:text-white/80 transition-colors"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Episode Sidebar ──────────────────────────────────────── */}
      {!mobile && episodes && episodes.length > 0 && (
        <div
          className="flex-shrink-0 flex flex-col overflow-hidden transition-[width] duration-300"
          style={{
            width: showSidebar ? '320px' : '0px',
            background: 'rgba(12, 12, 12, 0.97)',
            borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between flex-shrink-0 min-w-[320px]"
            style={{
              padding: '18px 16px 14px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <span className="font-display font-bold text-base text-white/95">Episodes</span>
            <button
              className="flex items-center justify-center w-[30px] h-[30px] rounded-full transition-all duration-[120ms] hover:bg-white/[0.12]"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.5)',
              }}
              onClick={() => setShowSidebar(false)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Season tabs (only if >26 episodes) */}
          {seasonCount > 1 && (
            <div
              className="flex gap-1 flex-shrink-0 min-w-[320px] overflow-x-auto"
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                scrollbarWidth: 'none',
              }}
            >
              {Array.from({ length: seasonCount }, (_, i) => (
                <button
                  key={i}
                  className={`py-[5px] px-[14px] rounded-full whitespace-nowrap transition-all duration-[120ms] text-xs font-semibold ${
                    activeSeason === i ? '' : 'hover:text-white hover:bg-white/[0.08]'
                  }`}
                  style={
                    activeSeason === i
                      ? {
                          background: '#e50914',
                          borderColor: '#e50914',
                          color: 'white',
                          border: '1px solid #e50914',
                          boxShadow: '0 0 12px rgba(229, 9, 20, 0.3)',
                        }
                      : {
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          color: 'rgba(255, 255, 255, 0.5)',
                        }
                  }
                  onClick={() => setActiveSeason(i)}
                >
                  S{i + 1}
                </button>
              ))}
            </div>
          )}

          {/* Episode list */}
          <div
            className="flex-1 overflow-y-auto p-2 min-w-[320px]"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}
          >
            {seasonEpisodes.map((ep) => {
              const isActive = currentEpisode === ep.number
              return (
                <div
                  key={ep.id}
                  ref={isActive ? sidebarEpisodeRef : null}
                  className={`flex items-center gap-[10px] rounded-lg cursor-pointer transition-all duration-[120ms] mb-[2px] ${
                    isActive ? '' : 'hover:bg-white/[0.04]'
                  }`}
                  style={{
                    padding: '8px',
                    border: isActive ? '1px solid rgba(229, 9, 20, 0.25)' : '1px solid transparent',
                    background: isActive ? 'rgba(229, 9, 20, 0.1)' : undefined,
                  }}
                  onClick={() => onEpisodeSelect?.(ep.id)}
                >
                  {/* Thumbnail */}
                  <div
                    className="w-[110px] h-[62px] rounded-md overflow-hidden flex-shrink-0 relative"
                    style={{ background: '#1a1a1a' }}
                  >
                    {(ep.thumbnail || posterUrl) ? (
                      <img src={ep.thumbnail || posterUrl} alt="" className="w-full h-full object-cover block" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/20 text-xs">
                        EP {ep.number}
                      </div>
                    )}
                    {/* Now-playing bars */}
                    {isActive && (
                      <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ background: 'rgba(0, 0, 0, 0.55)' }}
                      >
                        <div className="flex items-end gap-[2px] h-4">
                          {[8, 14, 10, 6].map((h, i) => (
                            <span
                              key={i}
                              className="block w-[3px] rounded-[1px]"
                              style={{
                                background: '#e50914',
                                height: `${h}px`,
                                animation: `barBounce 0.8s ease-in-out infinite`,
                                animationDelay: `${i * 0.15}s`,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div
                      className="mb-[2px] uppercase tracking-[0.05em]"
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.65rem',
                        color: isActive ? '#e50914' : 'rgba(255, 255, 255, 0.35)',
                      }}
                    >
                      Episode {ep.number}
                    </div>
                    <div
                      className="font-semibold leading-[1.3] line-clamp-2"
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: '0.8125rem',
                        color: 'rgba(255, 255, 255, 0.85)',
                      }}
                    >
                      {ep.title || `Episode ${ep.number}`}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Global keyframe animation for now-playing bars */}
      <style>{`
        @keyframes barBounce {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}
