/**
 * MiniPlayer - Persistent floating PiP overlay
 *
 * Mounted at root level (__root.tsx) so it survives route changes.
 * Creates its own <video> + HLS.js instance from pipStore data.
 * VideoServer info is passed directly via the store (no async fetch needed).
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import Hls from 'hls.js'
import { usePipStore } from '@/store/pipStore'
import { saveWatchProgress, type VideoServerUrls } from '@/utils/tauri-commands'
import { isAndroid } from '@/utils/platform'

function createProxyUrl(videoServer: VideoServerUrls, url: string): string {
  return `${videoServer.proxy_base_url}?token=${videoServer.token}&url=${encodeURIComponent(url)}`
}

function createHlsProxyUrl(videoServer: VideoServerUrls, m3u8Url: string): string {
  const baseUrl = videoServer.proxy_base_url.replace(/\/proxy$/, '')
  return `${baseUrl}/hls?token=${videoServer.token}&url=${encodeURIComponent(m3u8Url)}`
}

export function MiniPlayer() {
  const isActive = usePipStore((s) => s.isActive)
  const data = usePipStore((s) => s.data)
  const updateTime = usePipStore((s) => s.updateTime)
  const expandToFull = usePipStore((s) => s.expandToFull)
  const closePip = usePipStore((s) => s.closePip)
  const navigate = useNavigate()

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showControls, setShowControls] = useState(false)
  const [loading, setLoading] = useState(true)
  const [entered, setEntered] = useState(false)
  const [isNativePip, setIsNativePip] = useState(false)

  // Dragging state
  const [position, setPosition] = useState({ right: 24, bottom: 24 })
  const dragRef = useRef<{
    startX: number
    startY: number
    startRight: number
    startBottom: number
  } | null>(null)
  // Track programmatic PiP exits so we don't double-close when user clicks X on native PiP window
  const programmaticExitRef = useRef(false)

  // Check if native PiP is active via either standard or WebKit API
  const isInNativePip = useCallback(() => {
    if (document.pictureInPictureElement) return true
    const video = videoRef.current
    return video ? (video as any).webkitPresentationMode === 'picture-in-picture' : false
  }, [])

  // Exit native PiP via whichever API is active
  const exitNativePip = useCallback(() => {
    programmaticExitRef.current = true
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {})
      return
    }
    const video = videoRef.current
    if (video && (video as any).webkitPresentationMode === 'picture-in-picture') {
      ;(video as any).webkitSetPresentationMode('inline')
    }
  }, [])

  // Request native OS PiP — tries standard API then WebKit fallback
  const requestNativePip = useCallback(() => {
    const video = videoRef.current
    if (!video || isInNativePip()) return

    console.log('[MiniPlayer] Requesting native PiP:', {
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      pipEnabled: document.pictureInPictureEnabled,
      hasStandardApi: typeof video.requestPictureInPicture === 'function',
      hasWebkitApi: typeof (video as any).webkitSetPresentationMode === 'function',
    })

    // Standard PiP API (Chromium, Safari 13.1+)
    if (typeof video.requestPictureInPicture === 'function' && document.pictureInPictureEnabled) {
      video
        .requestPictureInPicture()
        .then(() => console.log('[MiniPlayer] Standard PiP entered'))
        .catch((e) => {
          console.warn('[MiniPlayer] Standard PiP failed:', e.message, '— trying WebKit API')
          if (typeof (video as any).webkitSetPresentationMode === 'function') {
            try {
              ;(video as any).webkitSetPresentationMode('picture-in-picture')
            } catch (err) {
              console.error('[MiniPlayer] WebKit PiP also failed:', err)
            }
          }
        })
      return
    }

    // WebKit-only PiP API (macOS WKWebView)
    if (typeof (video as any).webkitSetPresentationMode === 'function') {
      try {
        ;(video as any).webkitSetPresentationMode('picture-in-picture')
        console.log('[MiniPlayer] WebKit PiP entered')
      } catch (err) {
        console.error('[MiniPlayer] WebKit PiP failed:', err)
      }
      return
    }

    console.warn('[MiniPlayer] No PiP API available in this WebView')
  }, [isInNativePip])

  // Slide-in animation on activation
  useEffect(() => {
    if (isActive) {
      // Small delay so CSS transition triggers
      const t = setTimeout(() => setEntered(true), 50)
      return () => clearTimeout(t)
    } else {
      setEntered(false)
      setIsNativePip(false)
      setLoading(true)
    }
  }, [isActive])

  // Set up video playback — videoServer comes from store, no async fetch needed
  useEffect(() => {
    if (!isActive || !data) return

    const video = videoRef.current
    if (!video) return

    const { sourceUrl, isHls, videoServer } = data

    setLoading(true)
    console.log('[MiniPlayer] Loading video:', { sourceUrl, isHls })

    // Clean up any previous source
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    video.removeAttribute('src')
    video.load()

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        debug: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 120,
        maxBufferSize: 30 * 1000 * 1000,
        manifestLoadingTimeOut: 30000,
        fragLoadingTimeOut: 60000,
        fragLoadingMaxRetry: 3,
        xhrSetup: (xhr, url) => {
          xhr.open('GET', createProxyUrl(videoServer, url), true)
        },
      })

      hlsRef.current = hls

      const proxyUrl = createProxyUrl(videoServer, sourceUrl)
      hls.loadSource(proxyUrl)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('[MiniPlayer] HLS manifest parsed, seeking to', data.currentTime)
        setLoading(false)
        video.currentTime = data.currentTime
        video.volume = data.volume
        video.muted = data.isMuted
        video
          .play()
          .then(() => {
            // Wait for at least one decoded frame before requesting PiP
            if (video.readyState >= 2 && video.videoWidth > 0) {
              requestNativePip()
            } else {
              video.addEventListener('loadeddata', () => requestNativePip(), { once: true })
            }
          })
          .catch((e) => console.warn('[MiniPlayer] Autoplay blocked:', e))
      })

      hls.on(Hls.Events.ERROR, (_event, errData) => {
        console.warn('[MiniPlayer] HLS error:', errData.details, errData.fatal)
        if (errData.fatal) {
          if (
            errData.details === 'manifestLoadError' ||
            errData.details === 'manifestParsingError'
          ) {
            hls.destroy()
            hlsRef.current = null
            video.src = createProxyUrl(videoServer, sourceUrl)
            setLoading(false)
            video.currentTime = data.currentTime
            video.volume = data.volume
            video.muted = data.isMuted
            video.play().catch(() => {})
          } else if (errData.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError()
          }
        }
      })
    } else if (isHls && isAndroid()) {
      video.src = createHlsProxyUrl(videoServer, sourceUrl)
      video.addEventListener(
        'loadedmetadata',
        () => {
          setLoading(false)
          video.currentTime = data.currentTime
          video.volume = data.volume
          video.muted = data.isMuted
          video
            .play()
            .then(() => {
              if (video.readyState >= 2 && video.videoWidth > 0) requestNativePip()
              else video.addEventListener('loadeddata', () => requestNativePip(), { once: true })
            })
            .catch(() => {})
        },
        { once: true }
      )
    } else {
      let videoUrl = sourceUrl
      if (sourceUrl.startsWith('http') && !sourceUrl.includes('127.0.0.1')) {
        videoUrl = createProxyUrl(videoServer, sourceUrl)
      }
      video.src = videoUrl
      video.addEventListener(
        'loadedmetadata',
        () => {
          setLoading(false)
          video.currentTime = data.currentTime
          video.volume = data.volume
          video.muted = data.isMuted
          video
            .play()
            .then(() => {
              if (video.readyState >= 2 && video.videoWidth > 0) requestNativePip()
              else video.addEventListener('loadeddata', () => requestNativePip(), { once: true })
            })
            .catch(() => {})
        },
        { once: true }
      )
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    }
  }, [isActive, data?.sourceUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Register MediaSession so the OS treats this as active media playback.
  // Without this, macOS may not route audio to Bluetooth devices in PiP.
  useEffect(() => {
    if (!isActive || !data || !('mediaSession' in navigator)) return

    navigator.mediaSession.metadata = new MediaMetadata({
      title: `Episode ${data.episodeNumber}`,
      artist: data.animeTitle,
    })

    const video = videoRef.current

    navigator.mediaSession.setActionHandler('play', () => {
      video?.play().catch(() => {})
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      video?.pause()
    })
    navigator.mediaSession.setActionHandler('seekbackward', () => {
      if (video) video.currentTime = Math.max(0, video.currentTime - 10)
    })
    navigator.mediaSession.setActionHandler('seekforward', () => {
      if (video) video.currentTime = Math.min(video.duration || 0, video.currentTime + 10)
    })

    return () => {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('seekbackward', null)
      navigator.mediaSession.setActionHandler('seekforward', null)
    }
  }, [isActive, data?.animeTitle, data?.episodeNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isActive) return

    const lastUpdate = { time: 0 }

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onTimeUpdate = () => {
      const now = Date.now()
      if (now - lastUpdate.time < 500) return
      lastUpdate.time = now
      setCurrentTime(video.currentTime)
      setDuration(video.duration || 0)
      updateTime(video.currentTime)

      if ('mediaSession' in navigator && video.duration) {
        navigator.mediaSession.setPositionState({
          duration: video.duration,
          playbackRate: video.playbackRate,
          position: video.currentTime,
        })
      }
    }
    const onCanPlay = () => setLoading(false)

    const onEnterNativePip = () => setIsNativePip(true)
    const focusApp = () => {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => {
          getCurrentWindow()
            .setFocus()
            .catch(() => {})
        })
        .catch(() => {})
    }
    const onLeaveNativePip = () => {
      setIsNativePip(false)
      if (!programmaticExitRef.current) focusApp()
      programmaticExitRef.current = false
    }
    const onWebkitPipChange = () => {
      const mode = (video as any).webkitPresentationMode
      if (mode === 'picture-in-picture') {
        setIsNativePip(true)
      } else if (mode === 'inline') {
        setIsNativePip(false)
        if (!programmaticExitRef.current) focusApp()
        programmaticExitRef.current = false
      }
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('enterpictureinpicture', onEnterNativePip)
    video.addEventListener('leavepictureinpicture', onLeaveNativePip)
    video.addEventListener('webkitpresentationmodechanged', onWebkitPipChange)

    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('enterpictureinpicture', onEnterNativePip)
      video.removeEventListener('leavepictureinpicture', onLeaveNativePip)
      video.removeEventListener('webkitpresentationmodechanged', onWebkitPipChange)
    }
  }, [isActive, updateTime])

  const handleClose = useCallback(() => {
    if (isInNativePip()) exitNativePip()
    const video = videoRef.current
    if (video && data && video.currentTime > 5) {
      const percentComplete = (video.currentTime / video.duration) * 100
      saveWatchProgress(
        data.malId,
        data.episodeId,
        data.episodeNumber,
        video.currentTime,
        video.duration,
        percentComplete >= 85
      ).catch(() => {})
    }
    closePip()
  }, [data, closePip, isInNativePip, exitNativePip])

  const handleExpand = useCallback(() => {
    if (isInNativePip()) exitNativePip()
    const video = videoRef.current
    const time = video ? video.currentTime : (data?.currentTime ?? 0)

    if (video && data && video.currentTime > 5) {
      const percentComplete = (video.currentTime / video.duration) * 100
      saveWatchProgress(
        data.malId,
        data.episodeId,
        data.episodeNumber,
        video.currentTime,
        video.duration,
        percentComplete >= 85
      ).catch(() => {})
    }

    expandToFull(time)
    navigate({ to: '/watch', search: { malId: data!.malId, episodeId: data!.episodeId } })
  }, [data, expandToFull, navigate, isInNativePip, exitNativePip])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }, [])

  const handleNativePip = useCallback(() => {
    if (isInNativePip()) {
      exitNativePip()
    } else {
      requestNativePip()
    }
  }, [isInNativePip, exitNativePip, requestNativePip])

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startRight: position.right,
        startBottom: position.bottom,
      }

      const handleDragMove = (ev: MouseEvent) => {
        if (!dragRef.current) return
        const dx = dragRef.current.startX - ev.clientX
        const dy = dragRef.current.startY - ev.clientY
        setPosition({
          right: Math.max(8, dragRef.current.startRight + dx),
          bottom: Math.max(8, dragRef.current.startBottom + dy),
        })
      }

      const handleDragEnd = () => {
        dragRef.current = null
        document.removeEventListener('mousemove', handleDragMove)
        document.removeEventListener('mouseup', handleDragEnd)
      }

      document.addEventListener('mousemove', handleDragMove)
      document.addEventListener('mouseup', handleDragEnd)
    },
    [position]
  )

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const video = videoRef.current
      if (!video || !duration) return
      const rect = e.currentTarget.getBoundingClientRect()
      const fraction = (e.clientX - rect.left) / rect.width
      video.currentTime = fraction * duration
    },
    [duration]
  )

  console.log('[MiniPlayer] Render:', { isActive, hasData: !!data, entered, loading })

  if (!isActive || !data) return null

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      className="fixed z-[9999] rounded-xl overflow-hidden transition-all duration-300 ease-out"
      style={{
        right: position.right,
        bottom: position.bottom,
        width: 340,
        boxShadow: '0 8px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)',
        transform: entered ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.95)',
        opacity: isNativePip ? 0 : entered ? 1 : 0,
        pointerEvents: isNativePip ? 'none' : undefined,
      }}
    >
      {/* Video area */}
      <div
        className="relative aspect-video bg-black cursor-pointer"
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
        onClick={togglePlay}
      >
        <video ref={videoRef} className="w-full h-full object-contain" playsInline />

        {/* Loading spinner */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="w-8 h-8 border-2 border-white/20 border-t-[#e50914] rounded-full animate-spin" />
          </div>
        )}

        {/* Controls overlay */}
        <div
          className="absolute inset-0 transition-opacity duration-200"
          style={{ opacity: showControls ? 1 : 0, pointerEvents: showControls ? 'auto' : 'none' }}
        >
          {/* Top gradient */}
          <div
            className="absolute top-0 left-0 right-0 h-12"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}
          />

          {/* Top-right buttons */}
          <div className="absolute top-2 right-2 flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleNativePip()
              }}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-all"
              title="Float on top"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 16V4a1 1 0 011-1h14a1 1 0 011 1v8a1 1 0 01-1 1h-4" />
                <rect
                  x="1"
                  y="12"
                  width="12"
                  height="9"
                  rx="1"
                  fill="currentColor"
                  fillOpacity="0.3"
                />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleClose()
              }}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-all"
              title="Close"
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

          {/* Center play/pause */}
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={(e) => {
                e.stopPropagation()
                togglePlay()
              }}
              className="flex items-center justify-center w-12 h-12 rounded-full bg-black/50 text-white hover:bg-black/70 hover:scale-110 transition-all"
            >
              {isPlaying ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 3 20 12 6 21 6 3" />
                </svg>
              )}
            </button>
          </div>

          {/* Bottom-left: expand */}
          <div className="absolute bottom-2 left-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleExpand()
              }}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-all"
              title="Expand to full player"
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
                <path d="M15 3h6v6" />
                <path d="M9 21H3v-6" />
                <path d="M21 3l-7 7" />
                <path d="M3 21l7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Progress bar (always visible) */}
        <div
          className="absolute bottom-0 left-0 right-0 h-1 bg-white/20 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            handleProgressClick(e)
          }}
        >
          <div
            className="h-full transition-[width] duration-100"
            style={{ width: `${progressPercent}%`, background: '#e50914' }}
          />
        </div>
      </div>

      {/* Info bar (draggable) */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 select-none"
        style={{
          background: 'rgba(18, 18, 18, 0.98)',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          cursor: 'grab',
        }}
        onMouseDown={handleDragStart}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[0.8rem] font-semibold text-white/90 truncate leading-tight">
            {data.animeTitle}
          </div>
          <div
            className="text-[0.65rem] text-white/40 leading-tight mt-0.5"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            Episode {data.episodeNumber}
          </div>
        </div>
        <button
          onClick={handleExpand}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex items-center justify-center w-7 h-7 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-all flex-shrink-0"
          title="Expand to full player"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
          </svg>
        </button>
      </div>
    </div>
  )
}
