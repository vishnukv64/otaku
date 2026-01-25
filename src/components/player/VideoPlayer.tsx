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
} from 'lucide-react'
import type { VideoSource } from '@/types/extension'
import { proxyHlsPlaylist, proxyVideoRequest } from '@/utils/tauri-commands'
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
  animeTitle?: string
  currentEpisode?: number
  totalEpisodes?: number
  episodes?: Episode[]
  onNextEpisode?: () => void
  onPreviousEpisode?: () => void
  onEpisodeSelect?: (episodeId: string) => void
  onProgress?: (time: number) => void
  initialTime?: number
  autoPlay?: boolean
}

export function VideoPlayer({
  sources,
  animeTitle,
  currentEpisode,
  totalEpisodes,
  episodes,
  onNextEpisode,
  onPreviousEpisode,
  onEpisodeSelect,
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
  const [showControls, setShowControls] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showEpisodes, setShowEpisodes] = useState(false)
  const [loading, setLoading] = useState(true)
  const [buffering, setBuffering] = useState(false)
  const [bufferedPercentage, setBufferedPercentage] = useState(0)
  const [error, setError] = useState<string | null>(null)

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
        console.log('Loading video from:', currentSource.url)

        if (currentSource.type === 'hls' && Hls.isSupported()) {
          // Try HLS first with custom proxy loader
          if (hlsRef.current) {
            hlsRef.current.destroy()
          }

          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            loader: ProxyLoader,
            debug: true,
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

          if (autoPlay) {
            video.play().catch((e) => console.error('Autoplay failed:', e))
          }
        } else {
          // Direct MP4 playback
          video.src = currentSource.url
          setLoading(false)

          if (autoPlay) {
            video.play().catch((e) => console.error('Autoplay failed:', e))
          }
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
      setCurrentTime(video.currentTime)
      onProgress?.(video.currentTime)

      // Update buffered percentage
      if (video.buffered.length > 0 && video.duration > 0) {
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
      // Update buffered percentage
      if (video.buffered.length > 0 && video.duration > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1)
        const percentage = (bufferedEnd / video.duration) * 100
        setBufferedPercentage(percentage)
        // Only log every 5%
        if (Math.floor(percentage) % 5 === 0) {
          console.debug(`Buffered: ${percentage.toFixed(1)}%`)
        }
      }
    }
    const handleEnded = () => {
      // Auto-play next episode
      if (onNextEpisode && currentEpisode && totalEpisodes && currentEpisode < totalEpisodes) {
        onNextEpisode()
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

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black group"
      onMouseMove={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full"
        onClick={togglePlay}
        preload="auto"
        playsInline
        crossOrigin="anonymous"
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
          {animeTitle && currentEpisode && (
            <DownloadButton
              sources={sources}
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
