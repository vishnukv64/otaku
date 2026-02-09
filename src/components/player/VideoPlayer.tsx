/**
 * VideoPlayer Component
 *
 * Full-featured video player with HLS support, quality selection,
 * server selection, and episode navigation.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Loader2,
  AlertCircle,
  X,
} from 'lucide-react'
import type { VideoSource } from '@/types/extension'
import { saveWatchProgress, deleteEpisodeDownload, getVideoServerInfo, type VideoServerUrls } from '@/utils/tauri-commands'
import { DownloadButton } from './DownloadButton'
import { usePlayerStore } from '@/store/playerStore'
import { useSettingsStore } from '@/store/settingsStore'
import { notifySuccess } from '@/utils/notify'

// Helper to create proxy URL for HLS streaming via embedded video server
function createProxyUrl(videoServer: VideoServerUrls, url: string): string {
  return `${videoServer.proxy_base_url}?token=${videoServer.token}&url=${encodeURIComponent(url)}`
}

interface Episode {
  id: string
  number: number
  title?: string
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
}

export function VideoPlayer({
  sources,
  mediaId,
  episodeId,
  animeTitle,
  episodeTitle,
  currentEpisode,
  totalEpisodes,
  episodes,
  onNextEpisode,
  onPreviousEpisode,
  onEpisodeSelect,
  onGoBack,
  onProgress,
  initialTime = 0,
  autoPlay = true,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const currentEpisodeRef = useRef<HTMLButtonElement>(null)

  // Get settings from stores
  const playerSettings = usePlayerStore((state) => state.settings)
  const markWatchedThreshold = useSettingsStore((state) => state.markWatchedThreshold)
  const defaultVolume = useSettingsStore((state) => state.defaultVolume)
  const autoDeleteWatched = useSettingsStore((state) => state.autoDeleteWatched)

  // Get updateSettings from playerStore for persisting volume
  const updatePlayerSettings = usePlayerStore((state) => state.updateSettings)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Initialize from playerStore (persisted) or fall back to defaultVolume for new users
  const [volume, setVolume] = useState(playerSettings.volume ?? defaultVolume)
  const [isMuted, setIsMuted] = useState(playerSettings.muted ?? false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPiP, setIsPiP] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showEpisodes, setShowEpisodes] = useState(false)
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
  const [skipAmount, setSkipAmount] = useState<{ direction: 'forward' | 'backward'; amount: number } | null>(null)
  const skipTimeoutRef = useRef<number | null>(null)

  // Volume indicator state for visual feedback
  const [volumeIndicator, setVolumeIndicator] = useState<{ level: number; direction: 'up' | 'down' } | null>(null)
  const volumeIndicatorTimeoutRef = useRef<number | null>(null)

  // Performance: Throttle time updates to prevent frame drops
  const lastTimeUpdateRef = useRef(0)
  const lastBufferUpdateRef = useRef(0)

  // Auto-hide controls timer for fullscreen mode
  const hideControlsTimerRef = useRef<number | null>(null)

  const [selectedServer, setSelectedServer] = useState(0)
  const [selectedQuality, setSelectedQuality] = useState('Auto')
  const [availableQualities, setAvailableQualities] = useState<string[]>(['Auto'])
  const [videoServer, setVideoServer] = useState<VideoServerUrls | null>(null)

  // Group sources by server (memoized to prevent unnecessary recalculations)
  const serverGroups = useMemo(() => {
    return sources.reduce((acc, source, index) => {
      const serverName = source.server || `Server ${index + 1}`
      if (!acc[serverName]) {
        acc[serverName] = []
      }
      acc[serverName].push({ ...source, originalIndex: index })
      return acc
    }, {} as Record<string, Array<VideoSource & { originalIndex: number }>>)
  }, [sources])

  const servers = useMemo(() => Object.keys(serverGroups), [serverGroups])
  const currentServerSources = useMemo(
    () => serverGroups[servers[selectedServer]] || [],
    [serverGroups, servers, selectedServer]
  )

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

    const currentSource = currentServerSources[0]
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
        const isActuallyHls = currentSource.url.toLowerCase().includes('.m3u8') ||
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

            // Extract available qualities
            const qualities = ['Auto', ...data.levels.map((level) => `${level.height}p`)]
            setAvailableQualities(qualities)

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
                  if ((data.details === 'manifestLoadError' || data.details === 'manifestParsingError') && videoServer) {
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
                  setError(`Media error: ${data.details}`)
                  hls.recoverMediaError()
                  break
                default:
                  setError(`Fatal error: ${data.details}`)
                  setLoading(false)
                  break
              }
            }
          })
        } else if (isActuallyHls && video.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS support (Safari) - only for actual HLS streams
          const proxyUrl = createProxyUrl(videoServer, currentSource.url)
          video.src = proxyUrl
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
        } else {
          // Direct MP4 playback (including downloaded videos and remote non-HLS)
          let videoUrl = currentSource.url
          if (videoServer && currentSource.url.startsWith('http') && !currentSource.url.includes('127.0.0.1')) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer, sources, videoServer])

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
      if (now - lastBufferUpdateRef.current >= 2000 && video.buffered.length > 0 && video.duration > 0) {
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
      // Show next episode overlay if there's a next episode
      if (onNextEpisode && currentEpisode && totalEpisodes && currentEpisode < totalEpisodes) {
        setShowNextEpisodeOverlay(true)
        setCountdown(3)
      }
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
  }, [currentEpisode, totalEpisodes, onNextEpisode, onProgress])

  // Resume functionality is now handled via initialTime prop passed from watch.tsx
  // This ensures the video seeks to the saved position as soon as it loads,
  // avoiding race conditions between source loading and progress loading

  // Handle next episode countdown
  useEffect(() => {
    if (!showNextEpisodeOverlay) return

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
  }, [showNextEpisodeOverlay, countdown, onNextEpisode])

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

        // Auto-delete downloaded episode if enabled and episode is completed
        if (completed && autoDeleteWatched) {
          try {
            await deleteEpisodeDownload(mediaId, currentEpisode)
            notifySuccess(animeTitle || 'Episode Deleted', `Episode ${currentEpisode} auto-deleted after watching`)
          } catch {
            // Silently fail if episode wasn't downloaded - this is expected
          }
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

    // Listen to all fullscreen change events
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
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

  // Scroll to current episode when episodes dropdown is opened
  useEffect(() => {
    if (showEpisodes && currentEpisodeRef.current) {
      // Small delay to ensure the dropdown is rendered
      requestAnimationFrame(() => {
        currentEpisodeRef.current?.scrollIntoView({
          behavior: 'instant',
          block: 'center',
        })
      })
    }
  }, [showEpisodes])

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

  const toggleFullscreen = () => {
    if (!containerRef.current) return

    const elem = containerRef.current as FullscreenElement
    const doc = document as FullscreenDocument

    // Check if already in fullscreen
    const isFullscreenNow = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    )

    if (!isFullscreenNow) {
      // Enter fullscreen - try all APIs
      if (elem.requestFullscreen) {
        elem.requestFullscreen().catch((err: Error) => console.error('Fullscreen error:', err))
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen()
      } else if (elem.webkitEnterFullscreen) {
        elem.webkitEnterFullscreen()
      } else if (elem.mozRequestFullScreen) {
        elem.mozRequestFullScreen()
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen()
      }
    } else {
      // Exit fullscreen - try all APIs
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch((err: Error) => console.error('Exit fullscreen error:', err))
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen()
      } else if (doc.mozCancelFullScreen) {
        doc.mozCancelFullScreen()
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen()
      }
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
    const seekAmount = direction === 'forward'
      ? Math.min(duration - video.currentTime, skipSeconds)
      : Math.min(video.currentTime, skipSeconds)

    if (seekAmount > 0) {
      seekToTime(direction === 'forward'
        ? video.currentTime + seekAmount
        : video.currentTime - seekAmount
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

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video) return

    const newVolume = parseFloat(e.target.value)
    video.volume = newVolume
    if (newVolume > 0) {
      video.muted = false
    }
    // Persist volume to store
    updatePlayerSettings({ volume: newVolume, muted: newVolume === 0 })
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
    const hls = hlsRef.current
    if (!hls) return

    setSelectedQuality(quality)

    if (quality === 'Auto') {
      hls.currentLevel = -1 // Auto quality
    } else {
      const levelIndex = hls.levels.findIndex((level) => `${level.height}p` === quality)
      if (levelIndex !== -1) {
        hls.currentLevel = levelIndex
      }
    }

    setShowSettings(false)
  }

  const changeServer = (serverIndex: number) => {
    setSelectedServer(serverIndex)
    setShowSettings(false)
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

    // Start the initial hide timer
    startHideTimer()

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove)
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
        hideControlsTimerRef.current = null
      }
    }
  }, [isPlaying, isPiP])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black group"
      style={{
        // Hide cursor when controls are hidden (immersive mode)
        cursor: !showControls && !isPiP ? 'none' : 'default',
      }}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full"
        onClick={togglePlay}
        preload="auto"
        playsInline
        style={{
          willChange: 'transform',
          contain: 'layout style paint',
          transform: 'translateZ(0)',
        }}
      />

      {/* Skip Zones - Left (Rewind) and Right (Forward) */}
      <div className="absolute inset-0 flex pointer-events-none">
        {/* Left Skip Zone - Rewind */}
        <div
          className="w-1/3 h-full flex items-center justify-center pointer-events-auto cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            handleSkip('backward')
          }}
        >
          {skipAmount?.direction === 'backward' && (
            <div className="flex flex-col items-center animate-in fade-in zoom-in duration-200">
              <div className="bg-black/60 backdrop-blur-sm rounded-full p-6">
                <div className="flex items-center gap-1">
                  {/* Rewind arrows */}
                  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
                  </svg>
                </div>
              </div>
              <span className="mt-2 text-lg font-bold text-white drop-shadow-lg">
                {skipAmount.amount} seconds
              </span>
            </div>
          )}
        </div>

        {/* Center Zone - Play/Pause (transparent, lets clicks through to video) */}
        <div className="w-1/3 h-full pointer-events-none" />

        {/* Right Skip Zone - Forward */}
        <div
          className="w-1/3 h-full flex items-center justify-center pointer-events-auto cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            handleSkip('forward')
          }}
        >
          {skipAmount?.direction === 'forward' && (
            <div className="flex flex-col items-center animate-in fade-in zoom-in duration-200">
              <div className="bg-black/60 backdrop-blur-sm rounded-full p-6">
                <div className="flex items-center gap-1">
                  {/* Forward arrows */}
                  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
                  </svg>
                </div>
              </div>
              <span className="mt-2 text-lg font-bold text-white drop-shadow-lg">
                {skipAmount.amount} seconds
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Volume Indicator Overlay */}
      {volumeIndicator && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="flex flex-col items-center animate-in fade-in zoom-in duration-200">
            <div className="bg-black/60 backdrop-blur-sm rounded-full p-6">
              <div className="flex items-center gap-3">
                {/* Volume icon */}
                {volumeIndicator.level === 0 ? (
                  <VolumeX className="w-8 h-8" />
                ) : (
                  <Volume2 className="w-8 h-8" />
                )}
                {/* Volume bar */}
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

      {/* Loading/Buffering/Seeking Overlay */}
      {(loading || buffering || isSeeking) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 pointer-events-none">
          <Loader2 className="w-16 h-16 animate-spin text-[var(--color-accent-primary)]" />
          <p className="mt-4 text-sm text-white/80">
            {loading ? 'Loading video...' : isSeeking ? 'Seeking...' : 'Buffering...'}
          </p>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 text-white p-8">
          <AlertCircle className="w-16 h-16 mb-4 text-red-500" />
          <h3 className="text-xl font-bold mb-2">Playback Error</h3>
          <p className="text-[var(--color-text-secondary)]">{error}</p>
        </div>
      )}

      {/* Next Episode Overlay - Bottom Right */}
      {showNextEpisodeOverlay && currentEpisode && totalEpisodes && (
        <div className="absolute bottom-24 right-6 z-50 animate-in slide-in-from-right duration-300">
          <div className="bg-black/90 backdrop-blur-md rounded-lg p-6 max-w-sm border border-white/20 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <h3 className="text-lg font-bold mb-1">Next Episode</h3>
                <p className="text-sm text-white/70 mb-3">
                  Episode {currentEpisode + 1} starts in {countdown}s
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowNextEpisodeOverlay(false)
                      onNextEpisode?.()
                    }}
                    className="flex-1 bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-primary)]/90 text-white font-medium py-2 px-4 rounded-lg transition-colors text-sm"
                  >
                    Play Now
                  </button>
                  <button
                    onClick={() => setShowNextEpisodeOverlay(false)}
                    className="px-3 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
                    title="Cancel"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Title Overlay - Shows when paused or controls visible */}
      <div
        className={`absolute top-0 left-0 right-0 bg-gradient-to-b from-black/90 via-black/60 to-transparent p-6 transition-opacity duration-300 ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 pr-4">
            {animeTitle && (
              <>
                <h1 className="text-2xl font-bold mb-2 truncate">{animeTitle}</h1>
                {currentEpisode && (
                  <p className="text-base text-white/80">
                    Episode {currentEpisode}
                    {/* Only show episode title if it's not just "Episode X" */}
                    {episodeTitle && !episodeTitle.toLowerCase().startsWith('episode') && ` - ${episodeTitle}`}
                  </p>
                )}
              </>
            )}
          </div>

          {onGoBack && (
            <button
              onClick={onGoBack}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors backdrop-blur-sm"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="text-sm font-medium">Back</span>
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent p-6 transition-opacity duration-300 ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Progress Bar with Hover Preview */}
        <div className="relative mb-4">
          {/* Hover Time Preview Tooltip */}
          {hoverPreview.visible && (
            <div
              className="absolute bottom-full mb-3 transform -translate-x-1/2 pointer-events-none z-50"
              style={{
                left: `${Math.max(30, Math.min(hoverPreview.x, (progressBarRef.current?.clientWidth || 0) - 30))}px`,
              }}
            >
              <div className="bg-black/95 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-xl border border-white/10">
                <span className="text-sm font-medium text-white">
                  {formatTime(hoverPreview.time)}
                </span>
              </div>
              {/* Arrow pointing to progress bar */}
              <div className="absolute left-1/2 transform -translate-x-1/2 -bottom-1">
                <div className="w-2 h-2 bg-black/95 border-r border-b border-white/10 transform rotate-45" />
              </div>
            </div>
          )}

          {/* Progress Bar Track */}
          <div
            ref={progressBarRef}
            className="w-full h-1.5 bg-white/20 rounded-full cursor-pointer hover:h-2 transition-all relative overflow-visible"
            onClick={handleSeek}
            onMouseMove={handleProgressHover}
            onMouseLeave={handleProgressLeave}
          >
            {/* Buffer Bar */}
            <div
              className="absolute inset-y-0 left-0 bg-white/30 rounded-full transition-all"
              style={{ width: `${bufferedPercentage}%` }}
            />
            {/* Progress Bar */}
            <div
              className="absolute inset-y-0 left-0 bg-[var(--color-accent-primary)] rounded-full"
              style={{ width: `${(currentTime / duration) * 100}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            {/* Hover Position Indicator */}
            {hoverPreview.visible && (
              <div
                className="absolute top-1/2 -translate-y-1/2 w-1 h-4 bg-white/60 rounded-full pointer-events-none"
                style={{ left: `${hoverPreview.x}px` }}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Rewind 10s */}
          <button
            onClick={() => handleSkip('backward')}
            className="w-9 h-9 flex items-center justify-center hover:bg-white/20 rounded-full transition-colors"
            title="Rewind 10 seconds"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.5 3C17.15 3 21.08 6.03 22.47 10.22L20.1 11C19.05 7.81 16.04 5.5 12.5 5.5C10.54 5.5 8.77 6.22 7.38 7.38L10 10H3V3L5.6 5.6C7.45 4 9.85 3 12.5 3M10 12V22H8V14H6V12H10M18 14V20C18 21.11 17.11 22 16 22H14C12.9 22 12 21.1 12 20V14C12 12.9 12.9 12 14 12H16C17.11 12 18 12.9 18 14M14 14V20H16V14H14Z" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="w-10 h-10 flex items-center justify-center hover:bg-white/20 rounded-full transition-colors"
          >
            {isPlaying ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" />}
          </button>

          {/* Forward 10s */}
          <button
            onClick={() => handleSkip('forward')}
            className="w-9 h-9 flex items-center justify-center hover:bg-white/20 rounded-full transition-colors"
            title="Forward 10 seconds"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 3V5.5C5.86 5.5 2.5 8.86 2.5 13S5.86 20.5 10 20.5C12.93 20.5 15.5 18.84 16.77 16.39L14.57 15.27C13.67 16.91 11.96 18 10 18C7.24 18 5 15.76 5 13S7.24 8 10 8V10.5L14 6.5L10 3M18 14V20C18 21.11 17.11 22 16 22H14C12.9 22 12 21.1 12 20V14C12 12.9 12.9 12 14 12H16C17.11 12 18 12.9 18 14M14 14V20H16V14H14Z" />
            </svg>
          </button>

          {/* Spacer */}
          <div className="w-2" />

          {/* Time */}
          <span className="text-sm font-medium">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Episode Selector Dropdown */}
          {episodes && episodes.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowEpisodes(!showEpisodes)}
                className="px-3 py-2 flex items-center gap-2 hover:bg-white/20 rounded transition-colors text-sm font-medium"
                title="Select Episode"
              >
                <span>Episode {currentEpisode || 1}</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showEpisodes && (
                <>
                  {/* Backdrop to close dropdown */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowEpisodes(false)}
                  />

                  {/* Episodes Dropdown */}
                  <div className="absolute bottom-full right-0 mb-2 bg-black/95 backdrop-blur-sm rounded-lg shadow-xl max-h-[400px] overflow-y-auto z-50 min-w-[250px]">
                    <div className="p-2">
                      <h4 className="text-sm font-semibold mb-2 px-2 text-[var(--color-text-muted)]">Episodes</h4>
                      <div className="space-y-1">
                        {episodes.map((episode) => (
                          <button
                            key={episode.id}
                            ref={currentEpisode === episode.number ? currentEpisodeRef : null}
                            onClick={() => {
                              onEpisodeSelect?.(episode.id)
                              setShowEpisodes(false)
                            }}
                            className={`w-full text-left px-3 py-2 rounded hover:bg-white/10 transition-colors text-sm flex items-center justify-between ${
                              currentEpisode === episode.number
                                ? 'bg-[var(--color-accent-primary)] font-semibold'
                                : ''
                            }`}
                          >
                            <span>
                              {episode.number}. {episode.title || `Episode ${episode.number}`}
                            </span>
                            {currentEpisode === episode.number && (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Volume */}
          <div className="flex items-center gap-2 group/volume">
            <button
              onClick={toggleMute}
              className="w-10 h-10 flex items-center justify-center hover:bg-white/20 rounded-full transition-colors"
            >
              {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-0 group-hover/volume:w-20 transition-all opacity-0 group-hover/volume:opacity-100"
            />
          </div>

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

          {/* Settings */}
          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-10 h-10 flex items-center justify-center hover:bg-white/20 rounded-full transition-colors"
            >
              <Settings size={20} />
            </button>

            {showSettings && (
              <div className="absolute bottom-full right-0 mb-2 bg-black/95 backdrop-blur-sm rounded-lg shadow-xl p-4 min-w-[200px]">
                {/* Quality Selection */}
                <div className="mb-4">
                  <h4 className="text-sm font-semibold mb-2 text-[var(--color-text-muted)]">Quality</h4>
                  <div className="space-y-1">
                    {availableQualities.map((quality) => (
                      <button
                        key={quality}
                        onClick={() => changeQuality(quality)}
                        className={`w-full text-left px-3 py-2 rounded hover:bg-white/10 transition-colors text-sm ${
                          selectedQuality === quality ? 'bg-[var(--color-accent-primary)]' : ''
                        }`}
                      >
                        {quality}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Server Selection */}
                {servers.length > 1 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-[var(--color-text-muted)]">Server</h4>
                    <div className="space-y-1">
                      {servers.map((server, index) => (
                        <button
                          key={server}
                          onClick={() => changeServer(index)}
                          className={`w-full text-left px-3 py-2 rounded hover:bg-white/10 transition-colors text-sm ${
                            selectedServer === index ? 'bg-[var(--color-accent-primary)]' : ''
                          }`}
                        >
                          {server}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="w-10 h-10 flex items-center justify-center hover:bg-white/20 rounded-full transition-colors"
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>
      </div>
    </div>
  )
}
