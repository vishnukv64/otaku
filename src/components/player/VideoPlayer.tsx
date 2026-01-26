/**
 * VideoPlayer Component
 *
 * Full-featured video player with HLS support, quality selection,
 * server selection, and episode navigation.
 */

import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { LoaderContext, LoaderConfiguration, LoaderCallbacks } from 'hls.js'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  SkipBack,
  SkipForward,
  Loader2,
  AlertCircle,
  X,
} from 'lucide-react'
import type { VideoSource } from '@/types/extension'
import { proxyHlsPlaylist, proxyVideoRequest, saveWatchProgress } from '@/utils/tauri-commands'
import { DownloadButton } from './DownloadButton'

// Custom HLS loader that proxies all requests through Rust backend
class ProxyLoader extends Hls.DefaultConfig.loader {
  constructor(config: LoaderConfiguration) {
    super(config)
  }

  load(
    context: LoaderContext,
    config: LoaderConfiguration,
    callbacks: LoaderCallbacks
  ): void {
    const { url, responseType } = context

    // Proxy the request through Rust backend
    if (responseType === 'text' || responseType === '' || !responseType) {
      // Playlist request
      proxyHlsPlaylist(url)
        .then((data) => {
          callbacks.onSuccess(
            {
              url,
              data,
            },
            { code: 200, text: 'OK' },
            context,
            null as any
          )
        })
        .catch((error) => {
          console.error('Playlist load error:', error)
          // If it's a binary file error, this URL is not an HLS playlist
          callbacks.onError(
            { code: 500, text: error.toString() },
            context,
            error,
            null as any
          )
        })
    } else {
      // Video segment request (arraybuffer)
      proxyVideoRequest(url, undefined)
        .then((data) => {
          // Convert number array to ArrayBuffer
          const buffer = new Uint8Array(data).buffer
          callbacks.onSuccess(
            {
              url,
              data: buffer,
            },
            { code: 200, text: 'OK' },
            context,
            null as any
          )
        })
        .catch((error) => {
          console.error('Video segment load error:', error)
          callbacks.onError(
            { code: 500, text: error.toString() },
            context,
            error,
            null as any
          )
        })
    }
  }

  abort(): void {
    // Nothing to abort since we're using Rust backend
  }

  destroy(): void {
    // Cleanup if needed
  }
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

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPiP, setIsPiP] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showEpisodes, setShowEpisodes] = useState(false)
  const [loading, setLoading] = useState(true)
  const [buffering, setBuffering] = useState(false)
  const [bufferedPercentage, setBufferedPercentage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showNextEpisodeOverlay, setShowNextEpisodeOverlay] = useState(false)
  const [countdown, setCountdown] = useState(3)

  // Performance: Throttle time updates to prevent frame drops
  const lastTimeUpdateRef = useRef(0)
  const lastBufferUpdateRef = useRef(0)

  // Auto-hide controls timer for fullscreen mode
  const hideControlsTimerRef = useRef<number | null>(null)

  const [selectedServer, setSelectedServer] = useState(0)
  const [selectedQuality, setSelectedQuality] = useState('Auto')
  const [availableQualities, setAvailableQualities] = useState<string[]>(['Auto'])

  // Group sources by server
  const serverGroups = sources.reduce((acc, source, index) => {
    const serverName = source.server || `Server ${index + 1}`
    if (!acc[serverName]) {
      acc[serverName] = []
    }
    acc[serverName].push({ ...source, originalIndex: index })
    return acc
  }, {} as Record<string, Array<VideoSource & { originalIndex: number }>>)

  const servers = Object.keys(serverGroups)
  const currentServerSources = serverGroups[servers[selectedServer]] || []

  // Initialize HLS and load video
  useEffect(() => {
    const video = videoRef.current
    if (!video || sources.length === 0) return

    const currentSource = currentServerSources[0]
    if (!currentSource || !currentSource.url) {
      setError('No video source available')
      setLoading(false)
      return
    }

    const loadVideo = async () => {
      setLoading(true)
      setError(null)

      try {
        // Loading video source

        if (currentSource.type === 'hls' && Hls.isSupported()) {
          // Try HLS first with custom proxy loader
          if (hlsRef.current) {
            hlsRef.current.destroy()
          }

          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            loader: ProxyLoader,
            debug: false, // Disable debug logs for performance
            maxBufferLength: 30, // Buffer 30 seconds ahead
            maxMaxBufferLength: 600, // Max 10 minutes buffer
            maxBufferSize: 60 * 1000 * 1000, // 60 MB buffer
            maxBufferHole: 0.5, // Allow small gaps
            highBufferWatchdogPeriod: 2, // Check buffer health every 2s
            nudgeMaxRetry: 3,
            manifestLoadingTimeOut: 10000,
            manifestLoadingMaxRetry: 2,
            levelLoadingTimeOut: 10000,
            levelLoadingMaxRetry: 2,
            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 3,
          })

          hlsRef.current = hls

          // Load the URL - ProxyLoader will handle the requests
          hls.loadSource(currentSource.url)
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
            console.error('HLS Error:', data)
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.error('Network error details:', data.details, data.response)

                  // If the error is manifestLoadError, this might not be an HLS stream
                  if (data.details === 'manifestLoadError') {
                    console.log('Not an HLS stream, trying direct video playback')
                    hls.destroy()
                    hlsRef.current = null

                    // Convert HTTPS URL to stream:// protocol to bypass CORS
                    const streamUrl = currentSource.url.replace('https://', 'stream://')
                    console.log('Using stream protocol:', streamUrl)

                    video.src = streamUrl
                    setLoading(false)

                    if (autoPlay) {
                      video.play().catch((e) => console.error('Autoplay failed:', e))
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
                  console.error('Media error details:', data.details)
                  setError(`Media error: ${data.details}`)
                  hls.recoverMediaError()
                  break
                default:
                  console.error('Fatal error details:', data.details)
                  setError(`Fatal error: ${data.details}`)
                  setLoading(false)
                  break
              }
            }
          })
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS support (Safari)
          video.src = currentSource.url
          setLoading(false)

          // Seek to initial time when metadata is loaded
          const handleLoadedMetadata = () => {
            if (initialTime > 0) {
              console.log(`Seeking to saved position: ${initialTime}s`)
              video.currentTime = initialTime
            }

            if (autoPlay) {
              video.play().catch((e) => console.error('Autoplay failed:', e))
            }

            video.removeEventListener('loadedmetadata', handleLoadedMetadata)
          }

          video.addEventListener('loadedmetadata', handleLoadedMetadata)
        } else {
          // Direct MP4 playback (including downloaded videos)
          console.log('Loading direct MP4 video source')
          video.src = currentSource.url
          setLoading(false)

          // Seek to initial time when metadata is loaded
          const handleLoadedMetadata = () => {
            if (initialTime > 0) {
              console.log(`Seeking to saved position: ${initialTime}s`)
              video.currentTime = initialTime
            }

            if (autoPlay) {
              video.play().catch((e) => console.error('Autoplay failed:', e))
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
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [selectedServer, sources])

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
      setShowNextEpisodeOverlay(false)
      onNextEpisode?.()
      return
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
        const completed = video.currentTime >= video.duration - 30

        console.log(`💾 Saving watch progress: ${video.currentTime.toFixed(1)}s / ${video.duration.toFixed(1)}s (Episode ID: ${episodeId})`)

        await saveWatchProgress(
          mediaId,
          episodeId,
          currentEpisode,
          video.currentTime,
          video.duration,
          completed
        )

        console.log(`✓ Watch progress saved successfully`)
      } catch (error) {
        console.error('Failed to save watch progress:', error)
      }
    }

    // Save progress every 20 seconds (reduced frequency for performance)
    const interval = setInterval(saveProgress, 20000)

    // Save on unmount
    return () => {
      clearInterval(interval)
      saveProgress()
    }
  }, [mediaId, episodeId, currentEpisode])

  // Fullscreen handling
  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as any
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
      console.log('Entered Picture-in-Picture mode')
      setIsPiP(true)
      // Show controls in PiP mode
      setShowControls(true)
    }

    const handleLeavePiP = () => {
      console.log('Left Picture-in-Picture mode')
      setIsPiP(false)
      // Keep user on the watch page after exiting PiP
      // Controls will show automatically since we're not in fullscreen
    }

    video.addEventListener('enterpictureinpicture', handleEnterPiP)
    video.addEventListener('leavepictureinpicture', handleLeavePiP)

    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnterPiP)
      video.removeEventListener('leavepictureinpicture', handleLeavePiP)
    }
  }, [])

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
          seekToTime(Math.max(0, video.currentTime - 10))
          break
        case 'ArrowRight':
          e.preventDefault()
          seekToTime(Math.min(duration, video.currentTime + 10))
          break
        case 'ArrowUp':
          e.preventDefault()
          video.volume = Math.min(1, video.volume + 0.1)
          break
        case 'ArrowDown':
          e.preventDefault()
          video.volume = Math.max(0, video.volume - 0.1)
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
  }, [duration, onNextEpisode, onPreviousEpisode])

  // Control functions
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
  }

  const toggleFullscreen = () => {
    if (!containerRef.current) return

    const elem = containerRef.current as any
    const doc = document as any

    // Check if already in fullscreen
    const isFullscreen = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    )

    if (!isFullscreen) {
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
  const seekToTime = (targetTime: number) => {
    const video = videoRef.current
    if (!video) return

    // Pause playback during seek to prevent audio desync
    const wasPlaying = !video.paused
    if (wasPlaying) {
      video.pause()
    }

    // Set the new time
    video.currentTime = targetTime

    // Wait for seeked event to ensure both audio and video are at the correct position
    const handleSeeked = () => {
      if (wasPlaying) {
        video.play().catch((e) => console.error('Failed to resume after seek:', e))
      }
      video.removeEventListener('seeked', handleSeeked)
    }

    video.addEventListener('seeked', handleSeeked)
  }

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

  // Handle mouse movement to show controls and reset auto-hide timer
  const handleMouseMove = () => {
    setShowControls(true)

    // Only auto-hide in fullscreen mode when playing (not in PiP)
    if (isFullscreen && isPlaying && !isPiP) {
      // Clear existing timer
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
      }

      // Set new timer to hide controls after 2 seconds
      hideControlsTimerRef.current = setTimeout(() => {
        setShowControls(false)
      }, 2000)
    }
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
      }
    }
  }, [])

  // Auto-hide controls when entering fullscreen or resuming playback
  useEffect(() => {
    if (!isFullscreen || !isPlaying || isPiP) {
      // Clear timer when exiting fullscreen, pausing, or in PiP mode
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
        hideControlsTimerRef.current = null
      }
      // Always show controls when not in fullscreen, when paused, or in PiP
      setShowControls(true)
    } else {
      // When entering fullscreen AND playing (not PiP), start auto-hide timer
      setShowControls(true) // Show controls initially

      // Clear any existing timer
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
      }

      // Start 2-second timer to hide controls
      hideControlsTimerRef.current = setTimeout(() => {
        setShowControls(false)
      }, 2000)
    }
  }, [isFullscreen, isPlaying, isPiP])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black group"
      style={{
        cursor: isFullscreen && !showControls && !isPiP ? 'none' : 'default',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        // Only hide on mouse leave if not in fullscreen or PiP
        if (!isFullscreen && !isPiP) {
          setShowControls(false)
        }
      }}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full"
        onClick={togglePlay}
        preload="auto"
        playsInline
        crossOrigin="anonymous"
        style={{
          willChange: 'transform',
          contain: 'layout style paint',
          transform: 'translateZ(0)',
        }}
      />

      {/* Loading/Buffering Overlay */}
      {(loading || buffering) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 pointer-events-none">
          <Loader2 className="w-16 h-16 animate-spin text-[var(--color-accent-primary)]" />
          <p className="mt-4 text-sm text-white/80">
            {loading ? 'Loading video...' : 'Buffering...'}
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
                    {episodeTitle && ` - ${episodeTitle}`}
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
        {/* Progress Bar */}
        <div
          className="w-full h-1.5 bg-white/20 rounded-full mb-4 cursor-pointer hover:h-2 transition-all relative overflow-hidden"
          onClick={handleSeek}
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
        </div>

        <div className="flex items-center gap-4">
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="w-10 h-10 flex items-center justify-center hover:bg-white/20 rounded-full transition-colors"
          >
            {isPlaying ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" />}
          </button>

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
