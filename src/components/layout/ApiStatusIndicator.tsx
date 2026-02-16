/**
 * API Status Indicator
 *
 * Shows a subtle colored dot indicating API connectivity status.
 * Uses browser's online/offline events for network status,
 * and listens to actual API calls for real-time feedback.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, CheckCircle2, XCircle, AlertCircle, Circle } from 'lucide-react'
import { jikanTopAnime, jikanTopManga, subscribeToApiStatus } from '@/utils/tauri-commands'

type ApiStatus = 'checking' | 'online' | 'offline' | 'error'

interface EndpointStatus {
  status: ApiStatus
  lastChecked: Date | null
  responseTime: number | null
  resultCount: number | null
  error: string | null
}

interface ApiStatusState {
  anime: EndpointStatus
  manga: EndpointStatus
  networkOnline: boolean
}

const initialEndpointStatus: EndpointStatus = {
  status: 'checking',
  lastChecked: null,
  responseTime: null,
  resultCount: null,
  error: null,
}

export function ApiStatusIndicator() {
  const [status, setStatus] = useState<ApiStatusState>({
    anime: initialEndpointStatus,
    manga: initialEndpointStatus,
    networkOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  })
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const lastCheckRef = useRef<number>(0)

  const checkEndpoint = useCallback(async (
    fetchFn: () => Promise<{ results: unknown[] }>
  ): Promise<EndpointStatus> => {
    const startTime = Date.now()
    try {
      const result = await fetchFn()
      const responseTime = Date.now() - startTime
      const resultCount = result?.results?.length ?? 0

      if (resultCount > 0) {
        return {
          status: 'online',
          lastChecked: new Date(),
          responseTime,
          resultCount,
          error: null,
        }
      } else {
        return {
          status: 'error',
          lastChecked: new Date(),
          responseTime,
          resultCount: 0,
          error: 'Empty response',
        }
      }
    } catch (err) {
      return {
        status: 'offline',
        lastChecked: new Date(),
        responseTime: Date.now() - startTime,
        resultCount: null,
        error: err instanceof Error ? err.message : 'Connection failed',
      }
    }
  }, [])

  const checkAllApis = useCallback(async () => {
    // Debounce - don't check more than once every 10 seconds
    const now = Date.now()
    if (now - lastCheckRef.current < 10000) return
    lastCheckRef.current = now

    setStatus(prev => ({
      ...prev,
      anime: { ...prev.anime, status: 'checking' },
      manga: { ...prev.manga, status: 'checking' },
    }))

    const [animeStatus, mangaStatus] = await Promise.all([
      checkEndpoint(() => jikanTopAnime(1, undefined, 'airing')),
      checkEndpoint(() => jikanTopManga(1, undefined, 'publishing')),
    ])

    setStatus(prev => ({
      ...prev,
      anime: animeStatus,
      manga: mangaStatus,
    }))
  }, [checkEndpoint])

  // Listen for network online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setStatus(prev => ({ ...prev, networkOnline: true }))
      // Check APIs when coming back online
      checkAllApis()
    }
    const handleOffline = () => {
      setStatus(prev => ({
        ...prev,
        networkOnline: false,
        anime: { ...prev.anime, status: 'offline' },
        manga: { ...prev.manga, status: 'offline' },
      }))
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [checkAllApis])

  // Listen for API status reports from other parts of the app
  useEffect(() => {
    const unsubscribe = subscribeToApiStatus((type, success, resultCount) => {
      setStatus(prev => ({
        ...prev,
        [type]: {
          ...prev[type],
          status: success ? 'online' : 'error',
          lastChecked: new Date(),
          resultCount: resultCount ?? prev[type].resultCount,
          error: success ? null : 'Request failed',
        },
      }))
    })

    return unsubscribe
  }, [])

  // Initial check on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional initial API check on mount
    checkAllApis()
  }, [checkAllApis])

  // Update popover position
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const updatePosition = () => {
        if (!buttonRef.current) return
        const rect = buttonRef.current.getBoundingClientRect()
        const popoverWidth = 280
        let left = rect.left + rect.width / 2 - popoverWidth / 2

        if (left < 16) left = 16
        if (left + popoverWidth > window.innerWidth - 16) {
          left = window.innerWidth - popoverWidth - 16
        }

        setPosition({
          top: rect.bottom + 8,
          left,
        })
      }

      updatePosition()
      window.addEventListener('scroll', updatePosition, true)
      window.addEventListener('resize', updatePosition)

      return () => {
        window.removeEventListener('scroll', updatePosition, true)
        window.removeEventListener('resize', updatePosition)
      }
    }
  }, [isOpen])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Determine overall status
  const getOverallStatus = (): 'online' | 'partial' | 'offline' | 'checking' => {
    if (!status.networkOnline) return 'offline'
    if (status.anime.status === 'checking' || status.manga.status === 'checking') {
      return 'checking'
    }
    if (status.anime.status === 'online' && status.manga.status === 'online') {
      return 'online'
    }
    if (status.anime.status === 'offline' && status.manga.status === 'offline') {
      return 'offline'
    }
    return 'partial'
  }

  const overallStatus = getOverallStatus()

  const getStatusColor = () => {
    switch (overallStatus) {
      case 'online':
        return 'bg-green-500'
      case 'offline':
        return 'bg-red-500'
      case 'partial':
        return 'bg-yellow-500'
      case 'checking':
        return 'bg-blue-500 animate-pulse'
    }
  }

  const getStatusIcon = (s: ApiStatus) => {
    switch (s) {
      case 'online':
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
      case 'offline':
        return <XCircle className="w-3.5 h-3.5 text-red-500" />
      case 'error':
        return <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />
      case 'checking':
        return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
    }
  }

  const formatTime = (date: Date | null) => {
    if (!date) return 'Never'
    return date.toLocaleTimeString()
  }

  const getStatusLabel = () => {
    switch (overallStatus) {
      case 'online':
        return 'All systems operational'
      case 'offline':
        return 'Connection issues'
      case 'partial':
        return 'Partial connectivity'
      case 'checking':
        return 'Checking...'
    }
  }

  const popoverContent = (
    <div
      ref={popoverRef}
      className="fixed w-[280px] bg-[var(--color-bg-secondary)] rounded-lg shadow-2xl border border-[var(--color-bg-hover)] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      style={{
        top: position.top,
        left: position.left,
        zIndex: 9999,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-bg-hover)]">
        <span className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
        <span className="text-sm font-medium">{getStatusLabel()}</span>
      </div>

      {/* Status Items */}
      <div className="p-2 space-y-1">
        {/* Anime */}
        <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[var(--color-bg-hover)]/50">
          <div className="flex items-center gap-2">
            {getStatusIcon(status.anime.status)}
            <span className="text-sm">Anime</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            {status.anime.responseTime !== null && (
              <span>{status.anime.responseTime}ms</span>
            )}
            {status.anime.resultCount !== null && status.anime.resultCount > 0 && (
              <span className="text-green-500">{status.anime.resultCount}</span>
            )}
          </div>
        </div>

        {/* Manga */}
        <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[var(--color-bg-hover)]/50">
          <div className="flex items-center gap-2">
            {getStatusIcon(status.manga.status)}
            <span className="text-sm">Manga</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            {status.manga.responseTime !== null && (
              <span>{status.manga.responseTime}ms</span>
            )}
            {status.manga.resultCount !== null && status.manga.resultCount > 0 && (
              <span className="text-green-500">{status.manga.resultCount}</span>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      {(status.anime.error || status.manga.error) && (
        <div className="px-3 py-2 border-t border-[var(--color-bg-hover)] text-xs text-red-400">
          {status.anime.error || status.manga.error}
        </div>
      )}

      <div className="px-3 py-1.5 border-t border-[var(--color-bg-hover)] text-[10px] text-[var(--color-text-muted)]">
        Updated {formatTime(status.anime.lastChecked || status.manga.lastChecked)}
      </div>
    </div>
  )

  return (
    <>
      {/* Subtle dot indicator */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 group"
        aria-label="API Status"
        title={getStatusLabel()}
      >
        <Circle
          size={8}
          className={`transition-colors ${
            overallStatus === 'online'
              ? 'fill-green-500 text-green-500'
              : overallStatus === 'offline'
              ? 'fill-red-500 text-red-500'
              : overallStatus === 'partial'
              ? 'fill-yellow-500 text-yellow-500'
              : 'fill-blue-500 text-blue-500 animate-pulse'
          }`}
        />
        {/* Pulse ring on hover or when offline */}
        <span
          className={`absolute inset-0 flex items-center justify-center pointer-events-none ${
            overallStatus === 'offline' ? 'animate-ping' : 'group-hover:animate-ping'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full opacity-30 ${
              overallStatus === 'online'
                ? 'bg-green-500'
                : overallStatus === 'offline'
                ? 'bg-red-500'
                : overallStatus === 'partial'
                ? 'bg-yellow-500'
                : 'bg-blue-500'
            }`}
          />
        </span>
      </button>

      {isOpen && createPortal(popoverContent, document.body)}
    </>
  )
}
