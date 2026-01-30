/**
 * MediaDetailModal Component
 *
 * Full-screen modal displaying detailed anime/manga information
 * - Large banner with blur background
 * - Metadata (rating, year, status, episodes)
 * - Episode list
 * - Action buttons (Watch, Add to List)
 */

import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { X, Play, Plus, Check, Loader2, Download, CheckCircle, CheckSquare, Square, Trash2, Library, Tv, Clock, XCircle, Heart, Radio, Bell } from 'lucide-react'
import { notifySuccess, notifyError, notifyInfo } from '@/utils/notify'
import type { SearchResult, MediaDetails } from '@/types/extension'
import { getMediaDetails, isInLibrary, addToLibrary, removeFromLibrary, saveMediaDetails, startDownload, isEpisodeDownloaded, searchAnime, getVideoSources, deleteEpisodeDownload, getLatestWatchProgressForMedia, getWatchProgress, toggleFavorite, initializeReleaseTracking, type MediaEntry, type WatchHistory, type LibraryStatus } from '@/utils/tauri-commands'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { useDownloadEvents } from '@/hooks/useDownloadEvents'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import { useSettingsStore } from '@/store/settingsStore'
import { MediaCard } from './MediaCard'

/** Format episode date for display */
function formatEpisodeDate(epDate: { year: number; month: number; date: number }): string {
  const now = new Date()
  const episodeDate = new Date(epDate.year, epDate.month, epDate.date)
  const diffTime = now.getTime() - episodeDate.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`

  // Format as "Jan 22, 2026"
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[epDate.month]} ${epDate.date}, ${epDate.year}`
}

/** Check if anime is currently airing */
function isAiring(status?: string): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s === 'releasing' || s === 'ongoing' || s === 'airing' || s === 'currently airing'
}

interface MediaDetailModalProps {
  media: SearchResult
  extensionId: string
  isOpen: boolean
  onClose: () => void
  onMediaChange?: (media: SearchResult) => void
}

export function MediaDetailModal({
  media,
  extensionId,
  isOpen,
  onClose,
  onMediaChange,
}: MediaDetailModalProps) {
  const navigate = useNavigate()
  const { getStatus, refresh: refreshMediaStatus } = useMediaStatusContext()
  const customDownloadLocation = useSettingsStore((state) => state.downloadLocation)
  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inLibrary, setInLibrary] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)
  const [isTracked, setIsTracked] = useState(false)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<Set<number>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<string>>(new Set())
  const [relatedAnime, setRelatedAnime] = useState<SearchResult[]>([])
  const [_relatedLoading, setRelatedLoading] = useState(false)
  const [watchProgress, setWatchProgress] = useState<WatchHistory | null>(null)
  const [episodeWatchHistory, setEpisodeWatchHistory] = useState<Map<string, WatchHistory>>(new Map())

  // Use event-based download tracking instead of polling
  // Note: Toast notifications are handled globally by the notification system (useNotificationEvents)
  const { downloadingEpisodes } = useDownloadEvents({
    mediaId: media.id,
    onComplete: (download) => {
      // Add to downloaded episodes when a download completes
      setDownloadedEpisodes(prev => {
        const newSet = new Set(prev)
        newSet.add(download.episode_number)
        return newSet
      })
    },
  })

  const handleWatch = (episodeId: string) => {
    // Navigate directly - don't call onClose() first as it triggers state updates
    // that can interfere with navigation. The modal will unmount when the route changes.
    navigate({
      to: '/watch',
      search: {
        extensionId,
        animeId: media.id,
        episodeId,
      },
    })
  }

  const toggleEpisodeSelection = (episodeId: string) => {
    setSelectedEpisodes(prev => {
      const newSet = new Set(prev)
      if (newSet.has(episodeId)) {
        newSet.delete(episodeId)
      } else {
        newSet.add(episodeId)
      }
      return newSet
    })
  }

  const selectAllEpisodes = () => {
    if (!details) return
    setSelectedEpisodes(new Set(details.episodes.map(ep => ep.id)))
  }

  const deselectAllEpisodes = () => {
    setSelectedEpisodes(new Set())
  }

  const refreshDownloadedEpisodes = async () => {
    if (!details) return

    try {
      const downloaded = new Set<number>()
      for (const episode of details.episodes) {
        const isDownloaded = await isEpisodeDownloaded(media.id, episode.number)
        if (isDownloaded) {
          downloaded.add(episode.number)
        }
      }
      setDownloadedEpisodes(downloaded)
    } catch (error) {
      console.error('Failed to refresh downloaded episodes:', error)
    }
  }

  const handleDeleteEpisode = async (episodeNumber: number) => {
    try {
      await deleteEpisodeDownload(media.id, episodeNumber)

      // Remove from downloaded set
      setDownloadedEpisodes(prev => {
        const newSet = new Set(prev)
        newSet.delete(episodeNumber)
        return newSet
      })

      notifySuccess(media.title, `Episode ${episodeNumber} download deleted`)
    } catch (error) {
      console.error('Failed to delete episode:', error)
      notifyError('Delete Failed', `Failed to delete "${media.title}" Episode ${episodeNumber}`)
    }
  }

  const handleDownloadEpisode = async (episodeId: string, episodeNumber: number) => {
    if (!details) return

    // Skip if already downloaded or downloading
    if (downloadedEpisodes.has(episodeNumber) || downloadingEpisodes.has(episodeNumber)) {
      return
    }

    try {
      // Get video sources
      const videoSources = await getVideoSources(extensionId, episodeId)
      if (!videoSources || !videoSources.sources || videoSources.sources.length === 0) {
        notifyError('Download Failed', `No video sources found for Episode ${episodeNumber}`)
        return
      }

      // Find best quality source
      const source = videoSources.sources[0]
      const videoUrl = source.url
      if (!videoUrl) {
        notifyError('Download Failed', `No video URL found for Episode ${episodeNumber}`)
        return
      }

      // Generate filename
      const filename = `${details.title.replace(/[^a-z0-9]/gi, '_')}_EP${episodeNumber}.mp4`

      // Start download with custom path if set
      await startDownload(media.id, episodeId, episodeNumber, videoUrl, filename, customDownloadLocation || undefined)
      notifySuccess(media.title, `Started downloading Episode ${episodeNumber}`)
    } catch (error) {
      console.error(`Failed to download episode ${episodeNumber}:`, error)
      notifyError('Download Failed', `Failed to download Episode ${episodeNumber}`)
    }
  }

  const handleDownloadAll = async () => {
    if (!details) return

    try {
      let successCount = 0
      let failCount = 0
      let skippedCount = 0

      for (const episode of details.episodes) {
        try {
          // Check if already downloaded
          const isDownloaded = await isEpisodeDownloaded(media.id, episode.number)
          if (isDownloaded) {
            skippedCount++
            continue
          }

          // Get video sources
          const sources = await getVideoSources(extensionId, episode.id)
          if (!sources.sources || sources.sources.length === 0) {
            console.error(`No sources found for episode ${episode.number}`)
            failCount++
            continue
          }

          // Pick the best quality source (first one is usually highest quality)
          const videoUrl = sources.sources[0].url

          // Generate filename
          const filename = `${details.title.replace(/[^a-z0-9]/gi, '_')}_EP${episode.number}.mp4`

          // Start download with custom path if set
          await startDownload(media.id, episode.id, episode.number, videoUrl, filename, customDownloadLocation || undefined)
          successCount++
        } catch (err) {
          console.error(`Failed to download episode ${episode.number}:`, err)
          failCount++
        }
      }

      if (successCount > 0) {
        notifySuccess(details.title, `Started downloading ${successCount} episode${successCount > 1 ? 's' : ''}${skippedCount > 0 ? ` (${skippedCount} already downloaded)` : ''}`)
      } else if (skippedCount > 0) {
        notifyInfo(details.title, `All ${skippedCount} episodes are already downloaded`)
      }
      if (failCount > 0) {
        notifyError(details.title, `Failed to start ${failCount} download${failCount > 1 ? 's' : ''}`)
      }

      // Refresh downloaded episodes after a short delay
      setTimeout(refreshDownloadedEpisodes, 2000)
    } catch (error) {
      notifyError('Download Failed', `Failed to start downloads for "${details?.title || media.title}"`)
      console.error('Download all error:', error)
    }
  }

  const handleDownloadSelected = async () => {
    if (selectedEpisodes.size === 0) {
      notifyError('No Selection', 'Please select episodes to download')
      return
    }

    if (!details) return

    const selectedEpisodesList = details.episodes.filter(ep => selectedEpisodes.has(ep.id))

    try {
      let successCount = 0
      let failCount = 0
      let skippedCount = 0

      for (const episode of selectedEpisodesList) {
        try {
          // Check if already downloaded
          const isDownloaded = await isEpisodeDownloaded(media.id, episode.number)
          if (isDownloaded) {
            skippedCount++
            continue
          }

          // Get video sources
          const sources = await getVideoSources(extensionId, episode.id)
          if (!sources.sources || sources.sources.length === 0) {
            console.error(`No sources found for episode ${episode.number}`)
            failCount++
            continue
          }

          // Pick the best quality source
          const videoUrl = sources.sources[0].url

          // Generate filename
          const filename = `${details.title.replace(/[^a-z0-9]/gi, '_')}_EP${episode.number}.mp4`

          // Start download with custom path if set
          await startDownload(media.id, episode.id, episode.number, videoUrl, filename, customDownloadLocation || undefined)
          successCount++
        } catch (err) {
          console.error(`Failed to download episode ${episode.number}:`, err)
          failCount++
        }
      }

      if (successCount > 0) {
        notifySuccess(details.title, `Started downloading ${successCount} episode${successCount > 1 ? 's' : ''}${skippedCount > 0 ? ` (${skippedCount} already downloaded)` : ''}`)
      } else if (skippedCount > 0) {
        notifyInfo(details.title, `All ${skippedCount} selected episodes are already downloaded`)
      }
      if (failCount > 0) {
        notifyError(details.title, `Failed to start ${failCount} download${failCount > 1 ? 's' : ''}`)
      }

      // Exit selection mode and clear selection
      setSelectionMode(false)
      setSelectedEpisodes(new Set())

      // Refresh downloaded episodes after a short delay
      setTimeout(refreshDownloadedEpisodes, 2000)
    } catch (error) {
      notifyError('Download Failed', `Failed to start downloads for "${details.title}"`)
      console.error('Download selected error:', error)
    }
  }

  const handleAddToLibrary = async (status: LibraryStatus) => {
    setLibraryLoading(true)
    const statusLabels: Record<LibraryStatus, string> = {
      watching: 'Watching',
      completed: 'Completed',
      on_hold: 'On Hold',
      dropped: 'Dropped',
      plan_to_watch: 'Plan to Watch',
      reading: 'Reading',
      plan_to_read: 'Plan to Read',
    }
    try {
      await addToLibrary(media.id, status)
      setInLibrary(true)
      notifySuccess(media.title, `Added to "${statusLabels[status]}" list`)
      // Initialize release tracking for ongoing anime
      if (details && details.episodes.length > 0) {
        try {
          await initializeReleaseTracking(media.id, extensionId, 'anime', details.episodes.length)
        } catch (trackingError) {
          console.error('Failed to initialize release tracking:', trackingError)
        }
      }
      // Refresh media status context so badges update across the app
      refreshMediaStatus()
    } catch (error) {
      console.error('Failed to add to library:', error)
      notifyError('Library Error', `Failed to add "${media.title}" to library`)
    } finally {
      setLibraryLoading(false)
    }
  }

  const handleRemoveFromLibrary = async () => {
    setLibraryLoading(true)
    try {
      await removeFromLibrary(media.id)
      setInLibrary(false)
      setIsFavorite(false)
      notifySuccess(media.title, 'Removed from your library')
      // Refresh media status context so badges update across the app
      refreshMediaStatus()
    } catch (error) {
      console.error('Failed to remove from library:', error)
      notifyError('Library Error', `Failed to remove "${media.title}" from library`)
    } finally {
      setLibraryLoading(false)
    }
  }

  const handleToggleFavorite = async () => {
    if (!details) return

    try {
      // If not in library, add first
      if (!inLibrary) {
        await addToLibrary(media.id, 'plan_to_watch')
        setInLibrary(true)
        // Initialize release tracking for ongoing anime
        if (details && details.episodes.length > 0) {
          try {
            await initializeReleaseTracking(media.id, extensionId, 'anime', details.episodes.length)
          } catch (trackingError) {
            console.error('Failed to initialize release tracking:', trackingError)
          }
        }
      }
      const newFavorite = await toggleFavorite(media.id)
      setIsFavorite(newFavorite)
      notifySuccess(media.title, newFavorite ? 'Added to your favorites' : 'Removed from your favorites')
      // Refresh media status context so badges update across the app
      refreshMediaStatus()
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
      notifyError('Favorites Error', `Failed to update favorites for "${media.title}"`)
    }
  }

  useEffect(() => {
    if (!isOpen) return

    const loadDetails = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await getMediaDetails(extensionId, media.id)
        setDetails(result)

        // Save media details to database for library/continue watching
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

        // Check which episodes are downloaded
        try {
          const downloaded = new Set<number>()
          for (const episode of result.episodes) {
            const isDownloaded = await isEpisodeDownloaded(media.id, episode.number)
            if (isDownloaded) {
              downloaded.add(episode.number)
            }
          }
          setDownloadedEpisodes(downloaded)
        } catch (checkErr) {
          console.error('Failed to check downloaded episodes:', checkErr)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load details')
      } finally {
        setLoading(false)
      }
    }

    loadDetails()
  }, [isOpen, extensionId, media.id])

  // Check if media is in library and favorite status
  useEffect(() => {
    if (!isOpen) return

    const checkLibrary = async () => {
      try {
        const status = await isInLibrary(media.id)
        setInLibrary(status)
        // Get favorite status from context
        const mediaStatus = getStatus(media.id)
        setIsFavorite(mediaStatus.isFavorite)
        setIsTracked(mediaStatus.isTracked)
      } catch (error) {
        console.error('Failed to check library status:', error)
      }
    }

    checkLibrary()
  }, [isOpen, media.id, getStatus])

  // Load watch progress for Resume Watching feature
  useEffect(() => {
    if (!isOpen) return

    const loadWatchProgress = async () => {
      try {
        const progress = await getLatestWatchProgressForMedia(media.id)
        setWatchProgress(progress)
      } catch (error) {
        console.error('Failed to load watch progress:', error)
        setWatchProgress(null)
      }
    }

    loadWatchProgress()
  }, [isOpen, media.id])

  // Load watch history for all episodes
  useEffect(() => {
    if (!isOpen || !details) return

    const loadEpisodeWatchHistory = async () => {
      try {
        const historyMap = new Map<string, WatchHistory>()
        for (const episode of details.episodes) {
          const progress = await getWatchProgress(episode.id)
          if (progress) {
            historyMap.set(episode.id, progress)
          }
        }
        setEpisodeWatchHistory(historyMap)
      } catch (error) {
        console.error('Failed to load episode watch history:', error)
      }
    }

    loadEpisodeWatchHistory()
  }, [isOpen, details])

  // Load related anime
  useEffect(() => {
    if (!isOpen || !media.title) return

    const loadRelated = async () => {
      setRelatedLoading(true)
      try {
        // Search using the anime title to find related anime
        const results = await searchAnime(extensionId, media.title, 1)
        // Filter out the current anime and limit to 12 results
        const filtered = results.results
          .filter(item => item.id !== media.id)
          .slice(0, 12)
        setRelatedAnime(filtered)
      } catch (error) {
        console.error('Failed to load related anime:', error)
      } finally {
        setRelatedLoading(false)
      }
    }

    loadRelated()
  }, [isOpen, extensionId, media.id, media.title])

  // Keyboard shortcuts
  useKeyboardShortcut(
    {
      escape: () => {
        if (isOpen) onClose()
      },
    },
    [isOpen, onClose]
  )

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto animate-in fade-in duration-300">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/90 backdrop-blur-md animate-in fade-in duration-300"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative min-h-screen flex items-start justify-center p-4 sm:p-6 lg:p-8">
        <div className="relative bg-[var(--color-bg-primary)] rounded-xl max-w-6xl w-full my-8 shadow-2xl animate-in slide-in-from-bottom-4 duration-500 border border-white/5">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-6 right-6 z-10 w-12 h-12 rounded-full bg-black/80 backdrop-blur-sm hover:bg-[var(--color-accent-primary)] flex items-center justify-center transition-all hover:scale-110 border border-white/20"
            aria-label="Close"
          >
            <X size={24} strokeWidth={2.5} />
          </button>

          {loading ? (
            <div className="flex items-center justify-center py-32">
              <Loader2 className="w-12 h-12 animate-spin text-[var(--color-accent-primary)]" />
            </div>
          ) : error ? (
            <div className="py-32 text-center">
              <p className="text-[var(--color-text-secondary)]">{error}</p>
            </div>
          ) : details ? (
            <>
              {/* Hero Banner */}
              <div className="relative rounded-t-xl overflow-hidden">
                {/* Background Image (blurred) */}
                {details.cover_url && (
                  <>
                    <img
                      src={details.cover_url}
                      alt={details.title}
                      className="absolute inset-0 w-full h-full object-cover blur-3xl scale-110 opacity-40"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-primary)] via-black/80 to-black/40" />
                    <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
                  </>
                )}

                {/* Content */}
                <div className="relative p-10">
                  <div className="flex gap-8 w-full items-start">
                    {/* Poster */}
                    {details.cover_url && (
                      <div className="relative flex-shrink-0 group">
                        <img
                          src={details.cover_url}
                          alt={details.title}
                          className="w-48 sm:w-56 h-72 sm:h-80 object-cover rounded-xl shadow-2xl ring-1 ring-white/10 transform group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 rounded-xl bg-gradient-to-t from-black/20 to-transparent" />
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0 pt-4">
                      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black mb-3 drop-shadow-2xl leading-tight tracking-tight">
                        {details.english_name || details.title}
                      </h1>
                      {details.english_name && details.title !== details.english_name && (
                        <h2 className="text-base sm:text-lg text-[var(--color-text-secondary)] mb-2 font-medium">
                          {details.title}
                        </h2>
                      )}
                      {details.native_name && (
                        <h3 className="text-sm text-[var(--color-text-muted)] mb-3">
                          {details.native_name}
                        </h3>
                      )}

                      {/* Metadata Row 1 - Key Info */}
                      <div className="flex items-center gap-3 text-base mb-4 flex-wrap">
                        {details.rating && (
                          <span className="flex items-center gap-1 text-yellow-400 font-bold text-lg">
                            ★ {details.rating.toFixed(2)}
                          </span>
                        )}
                        {details.year && (
                          <>
                            <span className="text-[var(--color-text-muted)]">•</span>
                            <span className="text-white font-medium">{details.year}</span>
                          </>
                        )}
                        {details.status && details.status.toLowerCase() !== 'unknown' && (
                          <>
                            <span className="text-[var(--color-text-muted)]">•</span>
                            <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm font-medium capitalize">
                              {details.status.toLowerCase()}
                            </span>
                          </>
                        )}
                        {details.episodes.length > 0 && (
                          <>
                            <span className="text-[var(--color-text-muted)]">•</span>
                            <span className="text-white font-medium">
                              {details.episodes.length} Episodes
                            </span>
                          </>
                        )}
                        {/* Latest Episode Badge for airing anime */}
                        {isAiring(details.status) && media.latest_episode && media.latest_episode_date && (
                          <>
                            <span className="text-[var(--color-text-muted)]">•</span>
                            <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-sm font-medium flex items-center gap-1.5">
                              <Radio className="w-3 h-3" />
                              EP {media.latest_episode} • {formatEpisodeDate(media.latest_episode_date)}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Metadata Row 2 - Additional Details */}
                      <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)] mb-6 flex-wrap">
                        {details.type && (
                          <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                            </svg>
                            <span>{details.type}</span>
                          </span>
                        )}
                        {details.episode_duration && (
                          <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>{Math.round(details.episode_duration / 60000)} min/ep</span>
                          </span>
                        )}
                        {details.season && (
                          <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span>{details.season.quarter} {details.season.year}</span>
                          </span>
                        )}
                        {details.aired_start && (
                          <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                            </svg>
                            <span>
                              Aired: {details.aired_start.month && details.aired_start.date
                                ? `${details.aired_start.month}/${details.aired_start.date}/`
                                : ''}{details.aired_start.year}
                            </span>
                          </span>
                        )}
                      </div>

                      {/* Genres */}
                      {details.genres.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-6">
                          {details.genres.map((genre) => (
                            <span
                              key={genre}
                              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded-full text-sm font-medium transition-colors cursor-pointer"
                            >
                              {genre}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex items-center gap-3">
                        {details.episodes.length > 0 && (() => {
                          // Find episode 1 (the first episode by number, not array position)
                          const firstEpisode = details.episodes.reduce((min, ep) =>
                            ep.number < min.number ? ep : min
                          , details.episodes[0])

                          // Check if we should show Resume or Watch Now
                          const shouldResume = watchProgress && !watchProgress.completed

                          return (
                            <button
                              onClick={() => {
                                if (shouldResume) {
                                  handleWatch(watchProgress.episode_id)
                                } else {
                                  handleWatch(firstEpisode.id)
                                }
                              }}
                              className="flex items-center gap-2 px-8 py-3.5 bg-[var(--color-accent-primary)] text-white font-bold rounded-lg hover:bg-[var(--color-accent-primary)]/90 transition-all transform hover:scale-105 shadow-lg shadow-[var(--color-accent-primary)]/50"
                            >
                              <Play size={22} fill="currentColor" />
                              <span>
                                {shouldResume
                                  ? `Resume EP ${watchProgress.episode_number}`
                                  : 'Watch Now'}
                              </span>
                            </button>
                          )
                        })()}
                        {/* Library button with dropdown - key forces re-render to prevent visual artifacts */}
                        {inLibrary ? (
                          <button
                            key="in-library-btn"
                            onClick={handleRemoveFromLibrary}
                            disabled={libraryLoading}
                            className="flex items-center gap-2 px-6 py-3.5 font-bold rounded-lg transition-all border bg-green-600 text-white border-green-500 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {libraryLoading ? (
                              <Loader2 size={22} className="animate-spin" />
                            ) : (
                              <Check size={22} />
                            )}
                            <span>In My List</span>
                          </button>
                        ) : (
                          <div key="add-library-btn" className="relative group">
                            <button
                              onClick={() => handleAddToLibrary('plan_to_watch')}
                              disabled={libraryLoading}
                              className="flex items-center gap-2 px-6 py-3.5 font-bold rounded-lg transition-all border bg-white/10 backdrop-blur-sm text-white border-white/20 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {libraryLoading ? (
                                <Loader2 size={22} className="animate-spin" />
                              ) : (
                                <Plus size={22} />
                              )}
                              <span>My List</span>
                            </button>
                            {/* Dropdown menu - opens upward */}
                            <div className="absolute bottom-full left-0 mb-1 bg-[var(--color-bg-secondary)] rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 min-w-[180px] border border-white/10">
                              <button
                                onClick={() => handleAddToLibrary('watching')}
                                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--color-bg-hover)] text-left text-sm rounded-t-lg"
                              >
                                <Tv className="w-4 h-4" />
                                Watching
                              </button>
                              <button
                                onClick={() => handleAddToLibrary('plan_to_watch')}
                                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--color-bg-hover)] text-left text-sm"
                              >
                                <Library className="w-4 h-4" />
                                Plan to Watch
                              </button>
                              <button
                                onClick={() => handleAddToLibrary('completed')}
                                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--color-bg-hover)] text-left text-sm"
                              >
                                <Check className="w-4 h-4" />
                                Completed
                              </button>
                              <button
                                onClick={() => handleAddToLibrary('on_hold')}
                                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--color-bg-hover)] text-left text-sm"
                              >
                                <Clock className="w-4 h-4" />
                                On Hold
                              </button>
                              <button
                                onClick={() => handleAddToLibrary('dropped')}
                                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--color-bg-hover)] text-left text-sm rounded-b-lg"
                              >
                                <XCircle className="w-4 h-4" />
                                Dropped
                              </button>
                            </div>
                          </div>
                        )}
                        {/* Favorite button */}
                        <button
                          onClick={handleToggleFavorite}
                          className={`flex items-center justify-center w-12 h-12 rounded-lg transition-all border ${
                            isFavorite
                              ? 'bg-red-500 text-white border-red-500 hover:bg-red-600'
                              : 'bg-white/10 backdrop-blur-sm text-white border-white/20 hover:bg-white/20'
                          }`}
                          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Heart className={`w-6 h-6 ${isFavorite ? 'fill-current' : ''}`} />
                        </button>
                        {/* Release tracking indicator */}
                        {isTracked && (
                          <div
                            className="flex items-center justify-center w-12 h-12 bg-indigo-500 text-white rounded-lg transition-all border border-indigo-400"
                            title="Tracking new episode releases"
                          >
                            <Bell className="w-6 h-6" />
                          </div>
                        )}
                        <button
                          className="flex items-center justify-center w-12 h-12 bg-white/10 backdrop-blur-sm text-white rounded-lg hover:bg-white/20 transition-all border border-white/20"
                          aria-label="More info"
                        >
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Description & Episodes */}
              <div className="p-8">
                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                  <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg">
                    <div className="text-[var(--color-text-muted)] text-sm mb-1">Score</div>
                    <div className="text-2xl font-bold text-yellow-400">
                      {details.rating ? details.rating.toFixed(2) : 'N/A'}
                    </div>
                  </div>
                  <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg">
                    <div className="text-[var(--color-text-muted)] text-sm mb-1">Episodes</div>
                    <div className="text-2xl font-bold">
                      {details.episodes.length}
                      {details.episode_count && details.episode_count !== details.episodes.length && (
                        <span className="text-sm text-[var(--color-text-muted)] ml-1">/ {details.episode_count}</span>
                      )}
                    </div>
                  </div>
                  {details.status && details.status.toLowerCase() !== 'unknown' && (
                    <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg">
                      <div className="text-[var(--color-text-muted)] text-sm mb-1">Status</div>
                      <div className="text-2xl font-bold capitalize">{details.status.toLowerCase()}</div>
                    </div>
                  )}
                  <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg">
                    <div className="text-[var(--color-text-muted)] text-sm mb-1">Year</div>
                    <div className="text-2xl font-bold">{details.year || 'N/A'}</div>
                  </div>
                  {/* Last Aired - show for currently airing anime with episode date */}
                  {isAiring(details.status) && media.latest_episode_date && (
                    <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg">
                      <div className="text-[var(--color-text-muted)] text-sm mb-1 flex items-center gap-1">
                        <Radio className="w-3 h-3 text-emerald-400" />
                        Last Aired
                      </div>
                      <div className="text-lg font-bold text-emerald-400">
                        EP {media.latest_episode}
                      </div>
                      <div className="text-sm text-[var(--color-text-secondary)]">
                        {formatEpisodeDate(media.latest_episode_date)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Description */}
                {details.description && (
                  <div className="mb-8">
                    <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
                      <svg className="w-6 h-6 text-[var(--color-accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Synopsis
                    </h2>
                    <p className="text-[var(--color-text-secondary)] leading-relaxed text-lg">
                      {details.description.replace(/<[^>]*>/g, '')}
                    </p>
                  </div>
                )}

                {/* Episodes */}
                {details.episodes.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-2xl font-semibold flex items-center gap-2">
                        <svg className="w-6 h-6 text-[var(--color-accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Episodes ({details.episodes.length})
                      </h2>

                      {/* Download Action Buttons */}
                      <div className="flex items-center gap-2">
                        {selectionMode && (
                          <>
                            <button
                              onClick={selectedEpisodes.size === details.episodes.length ? deselectAllEpisodes : selectAllEpisodes}
                              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm font-medium"
                            >
                              {selectedEpisodes.size === details.episodes.length ? 'Deselect All' : 'Select All'}
                            </button>
                            <button
                              onClick={handleDownloadSelected}
                              disabled={selectedEpisodes.size === 0}
                              className="px-3 py-1.5 bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-secondary)] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors text-sm font-medium flex items-center gap-2"
                            >
                              <Download className="w-4 h-4" />
                              Download Selected ({selectedEpisodes.size})
                            </button>
                            <button
                              onClick={() => {
                                setSelectionMode(false)
                                setSelectedEpisodes(new Set())
                              }}
                              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm font-medium"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {!selectionMode && (
                          <>
                            <button
                              onClick={handleDownloadAll}
                              className="px-3 py-1.5 bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-secondary)] rounded-lg transition-colors text-sm font-medium flex items-center gap-2"
                            >
                              <Download className="w-4 h-4" />
                              Download All
                            </button>
                            <button
                              onClick={() => setSelectionMode(true)}
                              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm font-medium flex items-center gap-2"
                            >
                              <CheckSquare className="w-4 h-4" />
                              Select Episodes
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {details.episodes.map((episode) => (
                        <div
                          key={episode.id}
                          className={`group relative aspect-video rounded-lg overflow-hidden bg-[var(--color-bg-secondary)] hover:ring-2 transition-all hover:scale-105 transform ${
                            selectionMode
                              ? selectedEpisodes.has(episode.id)
                                ? 'ring-2 ring-[var(--color-accent-primary)]'
                                : 'hover:ring-white/30'
                              : 'hover:ring-[var(--color-accent-primary)]'
                          } ${selectionMode ? 'cursor-pointer' : ''}`}
                          onClick={selectionMode ? () => toggleEpisodeSelection(episode.id) : undefined}
                        >
                          {/* Thumbnail or placeholder */}
                          {episode.thumbnail ? (
                            <img
                              src={episode.thumbnail}
                              alt={episode.title || `Episode ${episode.number}`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[var(--color-bg-secondary)] to-[var(--color-bg-hover)]">
                              <svg className="w-8 h-8 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-xs text-[var(--color-text-muted)]">Episode {episode.number}</span>
                            </div>
                          )}

                          {/* Play button overlay on hover (only in normal mode) */}
                          {!selectionMode && (
                            <div
                              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                              onClick={() => handleWatch(episode.id)}
                            >
                              <div className="w-12 h-12 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center transform group-hover:scale-110 transition-transform">
                                <svg className="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              </div>
                            </div>
                          )}

                          {/* Small download/delete button at top right on hover (only in normal mode, not downloading) */}
                          {!selectionMode && !downloadingEpisodes.has(episode.number) && (
                            <>
                              {/* Download button (only for non-downloaded episodes) */}
                              {!downloadedEpisodes.has(episode.number) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDownloadEpisode(episode.id, episode.number)
                                  }}
                                  className="absolute top-2 right-2 w-7 h-7 rounded-md bg-black/70 hover:bg-[var(--color-accent-primary)] backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"
                                  title="Download episode"
                                >
                                  <Download size={14} />
                                </button>
                              )}

                              {/* Delete button (only for downloaded episodes) */}
                              {downloadedEpisodes.has(episode.number) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteEpisode(episode.number)
                                  }}
                                  className="absolute top-2 right-2 w-7 h-7 rounded-md bg-black/70 hover:bg-red-600 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"
                                  title="Delete downloaded episode"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </>
                          )}

                          {/* Selection checkbox (only in selection mode) */}
                          {selectionMode && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              {selectedEpisodes.has(episode.id) ? (
                                <CheckSquare className="w-12 h-12 text-[var(--color-accent-primary)]" />
                              ) : (
                                <Square className="w-12 h-12 text-white/60" />
                              )}
                            </div>
                          )}

                          {/* Episode number badge */}
                          <div className="absolute top-2 left-2 px-2.5 py-1 bg-black/80 backdrop-blur-sm rounded-md text-xs font-bold">
                            EP {episode.number}
                          </div>

                          {/* Download status badge - Downloading takes priority over Downloaded */}
                          {downloadingEpisodes.has(episode.number) ? (
                            <div className="absolute top-2 right-2 px-2.5 py-1 bg-blue-600/90 backdrop-blur-sm rounded-md text-xs font-bold flex items-center gap-1.5">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>
                                {downloadingEpisodes.get(episode.number)!.status === 'queued'
                                  ? 'Queued'
                                  : `${Math.round(downloadingEpisodes.get(episode.number)!.percentage)}%`}
                              </span>
                            </div>
                          ) : downloadedEpisodes.has(episode.number) && (
                            <div className="absolute top-2 right-2 px-2.5 py-1 bg-green-600/90 backdrop-blur-sm rounded-md text-xs font-bold flex items-center gap-1 group-hover:opacity-0 transition-opacity">
                              <CheckCircle className="w-3 h-3" />
                              Downloaded
                            </div>
                          )}

                          {/* Watched indicator */}
                          {episodeWatchHistory.has(episode.id) && (() => {
                            const history = episodeWatchHistory.get(episode.id)!
                            const isCompleted = history.completed
                            const progressPercent = history.duration
                              ? Math.min(100, Math.round((history.progress_seconds / history.duration) * 100))
                              : 0

                            return (
                              <>
                                {/* Completed badge */}
                                {isCompleted && (
                                  <div className="absolute bottom-2 right-2 px-2 py-1 bg-blue-600/90 backdrop-blur-sm rounded-md text-xs font-bold flex items-center gap-1">
                                    <Check className="w-3 h-3" />
                                    Watched
                                  </div>
                                )}

                                {/* Progress bar for partially watched */}
                                {!isCompleted && progressPercent > 0 && (
                                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                                    <div
                                      className="h-full bg-[var(--color-accent-primary)]"
                                      style={{ width: `${progressPercent}%` }}
                                    />
                                  </div>
                                )}
                              </>
                            )
                          })()}

                          {/* Episode title on hover */}
                          {episode.title && (
                            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black via-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                              <p className="text-xs font-medium line-clamp-2">
                                {episode.title}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Related Anime */}
                {relatedAnime.length > 0 && (
                  <div className="mt-12">
                    <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
                      <svg className="w-6 h-6 text-[var(--color-accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                      </svg>
                      Related Anime
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                      {relatedAnime.map((anime) => (
                        <MediaCard
                          key={anime.id}
                          media={anime}
                          status={getStatus(anime.id)}
                          onClick={() => {
                            // Change the media being displayed
                            onMediaChange?.(anime)
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
