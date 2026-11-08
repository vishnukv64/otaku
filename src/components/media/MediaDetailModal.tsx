/**
 * MediaDetailModal Component
 *
 * Full-screen modal displaying detailed anime/manga information
 * - Large banner with blur background
 * - Metadata (rating, year, status, episodes)
 * - Episode list
 * - Action buttons (Watch, Add to List)
 */

import {
  audioSummary,
  countdownFromBroadcast,
  formatBroadcast,
  formatDateRange,
  useProviderExtras,
  withProviderEpisodes,
} from '@/utils/providerExtras'
import { useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  X,
  Play,
  Check,
  Loader2,
  Download,
  CheckCircle,
  CheckSquare,
  Square,
  Trash2,
  Heart,
  Bell,
  Sparkles,
  Tags,
  WifiOff,
  AlertTriangle,
  Database,
  Info,
  Clock,
  ThumbsUp,
  ThumbsDown,
  DownloadCloud,
} from 'lucide-react'
import { notifySuccess, notifyError, notifyInfo, toastSuccess } from '@/utils/notify'
import type { SearchResult, MediaDetails, Episode } from '@/types/extension'
import {
  jikanAnimeDetails,
  jikanSearchAnime,
  loadExtension,
  resolveAllanimeId,
  isInLibrary,
  addToLibrary,
  removeFromLibrary,
  saveMediaDetails,
  saveEpisodes,
  getCachedMediaDetails,
  startDownload,
  isEpisodeDownloaded,
  getVideoSources,
  deleteEpisodeDownload,
  getBatchWatchProgress,
  saveWatchProgress,
  toggleFavorite,
  initializeReleaseTrackingV2,
  getLibraryEntry,
  setAutoDownload,
  getMediaTags,
  unassignLibraryTag,
  setMediaFeedback,
  getMediaFeedback,
  removeMediaFeedback,
  getContentRecommendations,
  type MediaEntry,
  type EpisodeEntry,
  type WatchHistory,
  type LibraryStatus,
  type LibraryTag,
  type RecommendationEntry,
  jikanAnimeCharacters,
  jikanAnimeStaff,
  jikanAnimeStatistics,
  jikanAnimeReviews,
  jikanAnimePictures,
  jikanAnimeNews,
  type JikanCharacterEntry,
  type JikanStaffEntry,
  type JikanStatistics,
  type JikanReview,
  type JikanPicture,
  type JikanNews,
  jikanAnimeEpisodeDetail,
  type JikanEpisodeDetail,
  searchAnime,
} from '@/utils/tauri-commands'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { resolveAnikotoSlug } from '@/utils/anikotoResolver'
import { slugProviderExtension, streamingProviderLabel } from '@/utils/streamingProviders'
import { savePendingReturn } from '@/utils/return-media'
import { TagSelector, TagChips } from '@/components/library'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { useDownloadEvents } from '@/hooks/useDownloadEvents'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import { useSettingsStore } from '@/store/settingsStore'
// MediaCard still available for future use
// import { MediaCard } from './MediaCard'
import { Description } from '@/components/ui/Description'
import { NextEpisodeCountdown } from './NextEpisodeCountdown'
import { MobileAnimeDetail } from '@/components/mobile/detail/MobileAnimeDetail'
import { isMobile } from '@/utils/platform'
import { DetailTabBar } from './DetailTabBar'
import { CharacterGrid } from './CharacterGrid'
import { ReviewList } from './ReviewCard'
import { LibraryDropdown } from './LibraryDropdown'
import {
  audioTypeLabel,
  buildDownloadSourceChoices,
  choicesForAudioTab,
  findMatchingDownloadChoice,
  findMatchingSubtitle,
  subtitleChoices,
  subtitleKey,
  type DownloadAudioTab,
  type DownloadSourceChoice,
} from '@/utils/downloadOptions'

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Returns true if the episode aired within the last 3 days, based on the last-episode
 * broadcast timestamp and weekly interval already stored in MediaDetails.
 * Formula: airTime(N) = last_update_end - (lastEpNum - N) * broadcast_interval
 */
function isRecentlyAired(
  epNumber: number,
  lastEpNumber: number,
  lastUpdateEnd: string | undefined,
  broadcastInterval: number | undefined
): boolean {
  if (!lastUpdateEnd || !broadcastInterval) return false
  const lastAirMs = new Date(lastUpdateEnd).getTime()
  if (isNaN(lastAirMs)) return false
  const epAirMs = lastAirMs - (lastEpNumber - epNumber) * broadcastInterval
  const ageMs = Date.now() - epAirMs
  return ageMs >= 0 && ageMs <= THREE_DAYS_MS
}

/** Format episode date for display (used by NextEpisodeCountdown / episode badges) */
function _formatEpisodeDate(epDate: { year: number; month: number; date: number }): string {
  const now = new Date()
  const episodeDate = new Date(epDate.year, epDate.month, epDate.date)
  const diffTime = now.getTime() - episodeDate.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`

  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${months[epDate.month]} ${epDate.date}, ${epDate.year}`
}
void _formatEpisodeDate

/** Check if anime is currently airing */
function isAiring(status?: string): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s === 'releasing' || s === 'ongoing' || s === 'airing' || s === 'currently airing'
}

const EPISODES_PER_PAGE = 50

interface DownloadPickerState {
  episodes: Episode[]
  mode: 'single' | 'selected' | 'all'
}

interface MediaDetailModalProps {
  media: SearchResult
  extensionId?: string
  isOpen: boolean
  onClose: () => void
  onMediaChange?: (media: SearchResult) => void
  onFeedbackChange?: () => void
}

/** Phones get the full-screen detail screen (mock: design/files/detail.html); desktop keeps the modal. */
export function MediaDetailModal(props: MediaDetailModalProps) {
  return isMobile() ? <MobileAnimeDetail {...props} /> : <MediaDetailModalDesktop {...props} />
}

function MediaDetailModalDesktop({
  media,
  extensionId,
  isOpen,
  onClose,
  onMediaChange,
  onFeedbackChange,
}: MediaDetailModalProps) {
  const navigate = useNavigate()
  const { getStatus, refresh: refreshMediaStatus } = useMediaStatusContext()
  const customDownloadLocation = useSettingsStore((state) => state.downloadLocation)
  const streamingProvider = useSettingsStore((state) => state.streamingProvider)
  const anikotoApiBaseUrl = useSettingsStore((state) => state.anikotoApiBaseUrl)
  const anikotoSiteBaseUrl = useSettingsStore((state) => state.anikotoSiteBaseUrl)
  const anikotoYotochanBaseUrl = useSettingsStore((state) => state.anikotoYotochanBaseUrl)
  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inLibrary, setInLibrary] = useState(false)
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(null)
  const [isFavorite, setIsFavorite] = useState(false)
  const [isTracked, setIsTracked] = useState(false)
  const [autoDownload, setAutoDownloadState] = useState(false)
  const [libraryLoading, setLibraryLoading] = useState(false)

  const [downloadedEpisodes, setDownloadedEpisodes] = useState<Set<number>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<string>>(new Set())
  const [downloadPicker, setDownloadPicker] = useState<DownloadPickerState | null>(null)
  const [downloadChoices, setDownloadChoices] = useState<DownloadSourceChoice[]>([])
  const [selectedDownloadAudioTab, setSelectedDownloadAudioTab] = useState<DownloadAudioTab>('sub')
  const [selectedDownloadChoiceKey, setSelectedDownloadChoiceKey] = useState('')
  const [selectedDownloadSubtitleKey, setSelectedDownloadSubtitleKey] = useState('off')
  const [downloadPickerLoading, setDownloadPickerLoading] = useState(false)
  const [downloadStarting, setDownloadStarting] = useState(false)
  const [relatedAnime, setRelatedAnime] = useState<SearchResult[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [episodeWatchHistory, setEpisodeWatchHistory] = useState<Map<string, WatchHistory>>(
    new Map()
  )
  const [episodePage, setEpisodePage] = useState(0)
  const [showNewBadge, setShowNewBadge] = useState(false)
  const [usingCachedData, setUsingCachedData] = useState(false) // True when showing data from cache (API failed)
  const [feedback, setFeedback] = useState<'liked' | 'disliked' | null>(null)
  const [completionRecs, setCompletionRecs] = useState<RecommendationEntry[]>([])

  // Enrichment tab state
  const [activeTab, setActiveTab] = useState('overview')
  const [characters, setCharacters] = useState<JikanCharacterEntry[] | null>(null)
  const [charactersLoading, setCharactersLoading] = useState(false)
  // Staff/Stats/Gallery/News data still loaded lazily for potential future use
  const [_staffData, setStaffData] = useState<JikanStaffEntry[] | null>(null)
  void _staffData
  const [_staffLoading, setStaffLoading] = useState(false)
  void _staffLoading
  const [_statistics, setStatistics] = useState<JikanStatistics | null>(null)
  void _statistics
  const [_statisticsLoading, setStatisticsLoading] = useState(false)
  void _statisticsLoading
  const [reviews, setReviews] = useState<JikanReview[] | null>(null)
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewHasMore, setReviewHasMore] = useState(true)
  const [reviewLoadingMore, setReviewLoadingMore] = useState(false)
  const [_pictures, setPictures] = useState<JikanPicture[] | null>(null)
  void _pictures
  const [_picturesLoading, setPicturesLoading] = useState(false)
  void _picturesLoading
  const [_newsData, setNewsData] = useState<JikanNews[] | null>(null)
  void _newsData
  const [_newsLoading, setNewsLoading] = useState(false)
  void _newsLoading
  const loadedTabsRef = useRef<Set<string>>(new Set())

  // Episode info overlay
  const [episodeInfoTarget, setEpisodeInfoTarget] = useState<{ id: string; number: number } | null>(
    null
  )
  const [episodeInfo, setEpisodeInfo] = useState<JikanEpisodeDetail | null>(null)
  const [episodeInfoLoading, setEpisodeInfoLoading] = useState(false)

  useEffect(() => {
    if (episodeInfoTarget) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [episodeInfoTarget])

  // Selected streaming extension for video sources (downloads).
  const [downloadExtId, setDownloadExtId] = useState<string | null>(null)
  const [downloadProviderMediaId, setDownloadProviderMediaId] = useState<string | null>(null)
  const kaa = useProviderExtras(downloadExtId, downloadProviderMediaId)
  const kaaCountdown = kaa?.broadcast ? countdownFromBroadcast(kaa.broadcast) : null
  // Grid view: provider stills and real titles over MAL's bare "Episode N".
  const gridEpisodes = useMemo(() => withProviderEpisodes(details?.episodes ?? [], kaa?.episodes), [details, kaa])
  const kaaFacts = (
    [
      ['Audio', audioSummary(kaa?.audio_locales)],
      ['Airs', kaa?.broadcast && details && isAiring(details.status) ? formatBroadcast(kaa.broadcast.day, kaa.broadcast.time) : ''],
      ['Dates', details?.aired_start ? '' : formatDateRange(kaa?.start_date, kaa?.end_date)],
    ] as [string, string][]
  ).filter(([, v]) => v)
  const [bridgeFailed, setBridgeFailed] = useState(false)
  const downloadProviderLabel = streamingProviderLabel(streamingProvider)
  const downloadProviderResolving =
    !!details && !bridgeFailed && (!downloadExtId || !downloadProviderMediaId)

  useEffect(() => {
    if (!details) return

    let cancelled = false
    setDownloadExtId(null)
    setDownloadProviderMediaId(null)
    setBridgeFailed(false)

    const loadSelectedProvider = async () => {
      try {
        const slugExtension = slugProviderExtension(streamingProvider, {
          anikotoApiBaseUrl,
          anikotoSiteBaseUrl,
          anikotoYotochanBaseUrl,
        })
        if (slugExtension) {
          const metadata = await loadExtension(slugExtension)
          if (cancelled) return
          setDownloadExtId(metadata.id)
          const anikotoDetails = {
            ...details,
            native_name: details.native_name || media.native_name,
            title_synonyms: Array.from(
              new Set(
                [
                  ...(details.title_synonyms || []),
                  ...(media.title_synonyms || []),
                  media.native_name || '',
                ].filter((value): value is string => Boolean(value))
              )
            ),
          }
          const match = await resolveAnikotoSlug(anikotoDetails, (query) =>
            searchAnime(metadata.id, query, 1)
          )
          if (cancelled) return
          if (match?.id) {
            setDownloadProviderMediaId(match.id)
            setBridgeFailed(false)
          } else {
            setBridgeFailed(true)
          }
          return
        }

        const metadata = extensionId ? { id: extensionId } : await loadExtension(ALLANIME_EXTENSION)
        if (cancelled) return
        setDownloadExtId(metadata.id)
        const id = await resolveAllanimeId(
          details.title,
          'anime',
          media.id,
          details.english_name,
          details.year,
          details.title_synonyms,
          details.type,
          details.episode_count,
          details.native_name,
          details.season?.quarter
        )
        if (cancelled) return
        if (id) {
          setDownloadProviderMediaId(id)
          setBridgeFailed(false)
        } else {
          setBridgeFailed(true)
        }
      } catch {
        if (!cancelled) setBridgeFailed(true)
      }
    }

    loadSelectedProvider()

    return () => {
      cancelled = true
    }
  }, [
    details,
    extensionId,
    media.id,
    streamingProvider,
    anikotoApiBaseUrl,
    anikotoSiteBaseUrl,
    anikotoYotochanBaseUrl,
  ])

  // Tag state
  const [mediaTags, setMediaTags] = useState<LibraryTag[]>([])
  const [showTagSelector, setShowTagSelector] = useState(false)
  const tagButtonRef = useRef<HTMLButtonElement>(null)

  // Use event-based download tracking instead of polling
  // Note: Toast notifications are handled globally by the notification system (useNotificationEvents)
  const { downloadingEpisodes } = useDownloadEvents({
    mediaId: media.id,
    onComplete: (download) => {
      // Add to downloaded episodes when a download completes
      setDownloadedEpisodes((prev) => {
        const newSet = new Set(prev)
        newSet.add(download.episode_number)
        return newSet
      })
    },
  })

  const handleToggleEpisodeWatched = async (
    e: React.MouseEvent,
    epId: string,
    epNumber: number
  ) => {
    e.stopPropagation()
    const current = episodeWatchHistory.get(epId)
    const isWatched = current?.completed || (current?.progress_seconds ?? 0) > 0
    try {
      if (isWatched) {
        // Reset to unwatched: 0 progress, not completed
        await saveWatchProgress(media.id, epId, epNumber, 0, undefined, false)
        setEpisodeWatchHistory((prev) => {
          const next = new Map(prev)
          next.delete(epId)
          return next
        })
      } else {
        // Mark as completed
        await saveWatchProgress(media.id, epId, epNumber, 1, 1, true)
        const now = new Date().toISOString()
        setEpisodeWatchHistory((prev) =>
          new Map(prev).set(epId, {
            id: 0,
            media_id: media.id,
            episode_id: epId,
            episode_number: epNumber,
            progress_seconds: 1,
            duration: 1,
            completed: true,
            last_watched: now,
            created_at: now,
          })
        )
      }
    } catch (err) {
      console.error('Failed to toggle watched state:', err)
    }
  }

  const handleEpisodeInfo = async (e: React.MouseEvent, epId: string, epNumber: number) => {
    e.stopPropagation()
    setEpisodeInfoTarget({ id: epId, number: epNumber })
    setEpisodeInfo(null)
    setEpisodeInfoLoading(true)
    try {
      const detail = await jikanAnimeEpisodeDetail(parseInt(media.id), epNumber)
      setEpisodeInfo(detail)
    } catch {
      // silently fail — overlay will show basic info only
    } finally {
      setEpisodeInfoLoading(false)
    }
  }

  const handleWatch = (episodeId: string) => {
    // Save media so the modal can reopen when user navigates back
    savePendingReturn('anime', media)
    // Navigate directly - don't call onClose() first as it triggers state updates
    // that can interfere with navigation. The modal will unmount when the route changes.
    navigate({
      to: '/watch',
      search: {
        malId: media.id,
        episodeId,
      },
    })
  }

  const toggleEpisodeSelection = (episodeId: string) => {
    setSelectedEpisodes((prev) => {
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
    setSelectedEpisodes(new Set(details.episodes.map((ep) => ep.id)))
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
      setDownloadedEpisodes((prev) => {
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

  const ensureDownloadProviderReady = () => {
    if (!details || !downloadExtId || !downloadProviderMediaId) {
      if (!downloadProviderMediaId) {
        notifyError(
          'Download Failed',
          downloadProviderResolving
            ? `${downloadProviderLabel} is still resolving this anime. Try again in a moment.`
            : `Could not resolve anime on ${downloadProviderLabel}. Switch provider in Settings and try again.`
        )
      }
      return false
    }
    return true
  }

  const openDownloadPicker = async (episodes: Episode[], mode: DownloadPickerState['mode']) => {
    if (!ensureDownloadProviderReady() || !details || !downloadExtId || !downloadProviderMediaId) return

    const eligibleEpisodes = episodes.filter(
      (episode) =>
        !downloadedEpisodes.has(episode.number) && !downloadingEpisodes.has(episode.number)
    )

    if (eligibleEpisodes.length === 0) {
      notifyInfo(details.title, 'Selected episodes are already downloaded or downloading', {
        source: 'download',
        metadata: { media_id: media.id },
      })
      return
    }

    setDownloadPicker({ episodes: eligibleEpisodes, mode })
    setDownloadChoices([])
    setSelectedDownloadAudioTab('sub')
    setSelectedDownloadChoiceKey('')
    setSelectedDownloadSubtitleKey('off')
    setDownloadPickerLoading(true)

    try {
      const firstEpisode = eligibleEpisodes[0]!
      const providerEpisodeId = `${downloadProviderMediaId}::${firstEpisode.number}`
      const videoSources = await getVideoSources(downloadExtId, providerEpisodeId)
      if (!videoSources || !videoSources.sources || videoSources.sources.length === 0) {
        notifyError('Download Failed', `No video sources found for Episode ${firstEpisode.number}`)
        setDownloadPicker(null)
        return
      }

      const choices = await buildDownloadSourceChoices(videoSources.sources, videoSources.subtitles || [])
      if (choices.length === 0) {
        notifyError('Download Failed', `No downloadable variants found for Episode ${firstEpisode.number}`)
        setDownloadPicker(null)
        return
      }

      const defaultTab = choicesForAudioTab(choices, 'sub').length > 0 ? 'sub' : 'dub'
      const defaultChoice = choicesForAudioTab(choices, defaultTab)[0] || choices[0]!
      const subtitleOptions = subtitleChoices(defaultChoice.subtitles)
      const englishSubtitle = subtitleOptions.find((option) => {
        const label = option.label.toLowerCase()
        return option.subtitle && (label.includes('english') || option.subtitle.language?.toLowerCase() === 'en')
      })
      setDownloadChoices(choices)
      setSelectedDownloadAudioTab(defaultTab)
      setSelectedDownloadChoiceKey(defaultChoice.key)
      setSelectedDownloadSubtitleKey(englishSubtitle?.key || 'off')
    } catch (error) {
      console.error('Failed to prepare download choices:', error)
      notifyError('Download Failed', 'Failed to prepare download choices')
      setDownloadPicker(null)
    } finally {
      setDownloadPickerLoading(false)
    }
  }

  const startPickerDownloads = async () => {
    if (!downloadPicker || !details || !downloadExtId || !downloadProviderMediaId) return
    const selectedChoice = downloadChoices.find((choice) => choice.key === selectedDownloadChoiceKey)
    if (!selectedChoice) {
      notifyError('Download Failed', 'Choose a video source before downloading')
      return
    }
    const selectedSubtitle = selectedChoice.subtitles.find(
      (subtitle) => subtitleKey(subtitle) === selectedDownloadSubtitleKey
    )

    setDownloadStarting(true)
    try {
      let successCount = 0
      let failCount = 0
      let skippedCount = 0

      for (const episode of downloadPicker.episodes) {
        try {
          if (await isEpisodeDownloaded(media.id, episode.number)) {
            skippedCount++
            continue
          }

          const providerEpisodeId = `${downloadProviderMediaId}::${episode.number}`
          const sources = await getVideoSources(downloadExtId, providerEpisodeId)
          const choices = await buildDownloadSourceChoices(sources.sources || [], sources.subtitles || [])
          const choice = findMatchingDownloadChoice(choices, selectedChoice)
          if (!choice) {
            failCount++
            continue
          }

          const subtitle = selectedSubtitle
            ? findMatchingSubtitle(choice.subtitles, selectedSubtitle)
            : undefined
          if (selectedSubtitle && !subtitle) {
            failCount++
            continue
          }

          const safeTitle = details.title.replace(/[^a-z0-9]/gi, '_')
          const filename = `${safeTitle}_EP${episode.number}_${audioTypeLabel(choice.audioType)}_${choice.quality}.otaku`
          await startDownload(
            media.id,
            episode.id,
            episode.number,
            choice.source.url,
            filename,
            customDownloadLocation || undefined,
            choice.source.referrer,
            subtitle?.url,
            subtitle?.label,
            subtitle?.language
          )
          successCount++
        } catch (err) {
          console.error(`Failed to download episode ${episode.number}:`, err)
          failCount++
        }
      }

      if (successCount > 0) {
        notifySuccess(
          details.title,
          `Started downloading ${successCount} episode${successCount > 1 ? 's' : ''}${skippedCount > 0 ? ` (${skippedCount} already downloaded)` : ''}`,
          { source: 'download', metadata: { media_id: media.id } }
        )
      } else if (skippedCount > 0) {
        notifyInfo(details.title, `All ${skippedCount} selected episodes are already downloaded`, {
          source: 'download',
          metadata: { media_id: media.id },
        })
      }
      if (failCount > 0) {
        notifyError(details.title, `Failed to start ${failCount} download${failCount > 1 ? 's' : ''}`)
      }

      setDownloadPicker(null)
      setSelectionMode(false)
      setSelectedEpisodes(new Set())
      setTimeout(refreshDownloadedEpisodes, 2000)
    } finally {
      setDownloadStarting(false)
    }
  }

  const handleDownloadEpisode = async (episodeId: string, episodeNumber: number) => {
    const episode = details?.episodes.find((ep) => ep.id === episodeId) || {
      id: episodeId,
      number: episodeNumber,
    }
    await openDownloadPicker([episode], 'single')
  }

  const handleDownloadAll = async () => {
    if (!details) return
    await openDownloadPicker(details.episodes, 'all')
  }

  const handleDownloadSelected = async () => {
    if (!details) return
    if (selectedEpisodes.size === 0) {
      notifyError('No Selection', 'Please select episodes to download')
      return
    }

    const selectedEpisodesList = details.episodes.filter((ep) => selectedEpisodes.has(ep.id))
    await openDownloadPicker(selectedEpisodesList, 'selected')
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
    const notificationCover = details?.cover_url || media.cover_url
    try {
      await addToLibrary(media.id, status)
      setInLibrary(true)
      setLibraryStatus(status)
      notifySuccess(media.title, `Added to "${statusLabels[status]}" list`, {
        metadata: {
          media_id: media.id,
          ...(notificationCover
            ? {
                thumbnail: notificationCover,
                image: notificationCover,
              }
            : {}),
        },
      })
      // Fetch post-completion recommendations
      if (status === 'completed') {
        getContentRecommendations(6)
          .then((recs) => setCompletionRecs(recs.filter((r) => r.media.id !== media.id)))
          .catch(() => {})
      }
      // Initialize release tracking for ongoing anime.
      // Use V2 init so raw_status drives normalized_status at insert time —
      // without it, the row stays at 'unknown' and the checker has to fall
      // back to m.status (which can be stale, e.g. "Not Yet Released").
      if (details && details.episodes.length > 0) {
        try {
          const latestEp = details.episodes.reduce((max, ep) => (ep.number > max.number ? ep : max))
          await initializeReleaseTrackingV2(
            media.id,
            downloadExtId || 'jikan',
            'anime',
            details.episodes.length,
            latestEp.number,
            latestEp.id,
            details.status
          )
        } catch (trackingError) {
          console.error('Failed to initialize release tracking:', trackingError)
        }
      }
      // Refresh media status context so badges update across the app
      refreshMediaStatus()
    } catch (error) {
      console.error('Failed to add to library:', error)
      notifyError('Library Error', `Failed to add "${media.title}" to library`, {
        metadata: {
          media_id: media.id,
          ...(notificationCover
            ? {
                thumbnail: notificationCover,
                image: notificationCover,
              }
            : {}),
        },
      })
    } finally {
      setLibraryLoading(false)
    }
  }

  const handleRemoveFromLibrary = async () => {
    setLibraryLoading(true)
    const notificationCover = details?.cover_url || media.cover_url
    try {
      await removeFromLibrary(media.id)
      setInLibrary(false)
      setLibraryStatus(null)
      setIsFavorite(false)
      notifySuccess(media.title, 'Removed from your library', {
        metadata: {
          media_id: media.id,
          ...(notificationCover
            ? {
                thumbnail: notificationCover,
                image: notificationCover,
              }
            : {}),
        },
      })
      // Refresh media status context so badges update across the app
      refreshMediaStatus()
    } catch (error) {
      console.error('Failed to remove from library:', error)
      notifyError('Library Error', `Failed to remove "${media.title}" from library`, {
        metadata: {
          media_id: media.id,
          ...(notificationCover
            ? {
                thumbnail: notificationCover,
                image: notificationCover,
              }
            : {}),
        },
      })
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
            const latestEp = details.episodes.reduce((max, ep) =>
              ep.number > max.number ? ep : max
            )
            await initializeReleaseTrackingV2(
              media.id,
              downloadExtId || 'jikan',
              'anime',
              details.episodes.length,
              latestEp.number,
              latestEp.id,
              details.status
            )
          } catch (trackingError) {
            console.error('Failed to initialize release tracking:', trackingError)
          }
        }
      }
      const newFavorite = await toggleFavorite(media.id)
      setIsFavorite(newFavorite)
      const notificationCover = details?.cover_url || media.cover_url
      notifySuccess(
        media.title,
        newFavorite ? 'Added to your favorites' : 'Removed from your favorites',
        {
          metadata: {
            media_id: media.id,
            ...(notificationCover
              ? {
                  thumbnail: notificationCover,
                  image: notificationCover,
                }
              : {}),
          },
        }
      )
      // Refresh media status context so badges update across the app
      refreshMediaStatus()
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
      notifyError('Favorites Error', `Failed to update favorites for "${media.title}"`)
    }
  }

  const handleToggleAutoDownload = async () => {
    if (!inLibrary) return
    const next = !autoDownload
    setAutoDownloadState(next)
    try {
      await setAutoDownload(media.id, next)
      toastSuccess(
        'Auto-download',
        next ? 'New episodes will download automatically.' : 'Auto-download disabled.'
      )
    } catch (error) {
      console.error('Failed to update auto-download:', error)
      setAutoDownloadState(!next)
      notifyError('Auto-download', 'Could not update auto-download setting.')
    }
  }

  const handleFeedback = async (sentiment: 'liked' | 'disliked') => {
    const prev = feedback
    if (feedback === sentiment) {
      // Toggle off — optimistic update
      setFeedback(null)
      try {
        await removeMediaFeedback(media.id)
        onFeedbackChange?.()
      } catch (error) {
        console.error('Failed to remove feedback:', error)
        setFeedback(prev) // revert on error
      }
    } else {
      // Set new — optimistic update
      setFeedback(sentiment)
      try {
        await setMediaFeedback(media.id, sentiment)
        toastSuccess('Feedback', 'Noted! This helps recommendations')
        onFeedbackChange?.()
      } catch (error) {
        console.error('Failed to set feedback:', error)
        setFeedback(prev) // revert on error
      }
    }
  }

  // Reset episode page and enrichment state when modal opens for a different anime
  useEffect(() => {
    setEpisodePage(0)
    setActiveTab('overview')
    setCharacters(null)
    setStaffData(null)
    setStatistics(null)
    setReviews(null)
    setReviewPage(1)
    setReviewHasMore(true)
    setPictures(null)
    setNewsData(null)
    setRelatedAnime([])
    setFeedback(null)
    setCompletionRecs([])
    loadedTabsRef.current = new Set()
  }, [media.id])

  // If anime has no episodes, default to characters tab
  useEffect(() => {
    if (details && details.episodes.length === 0 && activeTab === 'episodes') {
      setActiveTab('overview')
    }
  }, [details, activeTab])

  useEffect(() => {
    if (!isOpen) return

    let aborted = false

    const loadDetails = async () => {
      setError(null)
      setUsingCachedData(false)

      let hasCachedData = false

      // Step 1: Try cache first for instant display
      try {
        const cached = await getCachedMediaDetails(media.id)
        if (!aborted && cached && cached.episodes.length > 0) {
          const cachedDetails: MediaDetails = {
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
          setDetails(cachedDetails)
          setLoading(false)
          hasCachedData = true
          console.log(
            '[MediaDetail] Cache hit:',
            cached.episodes.length,
            'episodes — showing instantly'
          )
        }
      } catch {
        // Cache miss or error — continue to API
      }

      // If no cache, show loading spinner
      if (!hasCachedData) {
        setLoading(true)
      }

      // Step 2: Fetch from API in background (regardless of cache)
      try {
        const result = await jikanAnimeDetails(parseInt(media.id))
        if (aborted) return

        setDetails(result)
        setUsingCachedData(false)
        setLoading(false)

        // Save to cache for next time
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
            episode_count: result.episode_count ?? result.episodes.length,
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

          if (result.episodes.length > 0) {
            const episodeEntries: EpisodeEntry[] = result.episodes.map((ep) => ({
              id: ep.id,
              media_id: result.id,
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
          console.error('Failed to save media/episode details:', saveErr)
        }

        // Check downloaded episodes with fresh data
        try {
          const downloaded = new Set<number>()
          for (const episode of result.episodes) {
            const isDl = await isEpisodeDownloaded(media.id, episode.number)
            if (isDl) downloaded.add(episode.number)
          }
          if (!aborted) setDownloadedEpisodes(downloaded)
        } catch (checkErr) {
          console.error('Failed to check downloaded episodes:', checkErr)
        }
      } catch (err) {
        if (aborted) return
        const apiError = err instanceof Error ? err.message : 'Failed to load details'
        console.error('[MediaDetail] API failed:', apiError)

        if (hasCachedData) {
          // Cache is already showing — just mark it as cached-only
          setUsingCachedData(true)
        } else {
          // No cache and no API — show error
          setError(apiError)
          setLoading(false)
        }
      }

      // Check downloaded episodes for cached data (if API didn't run this yet)
      if (hasCachedData) {
        try {
          const cached = await getCachedMediaDetails(media.id)
          if (!aborted && cached) {
            const downloaded = new Set<number>()
            for (const ep of cached.episodes) {
              const isDl = await isEpisodeDownloaded(media.id, ep.number)
              if (isDl) downloaded.add(ep.number)
            }
            if (!aborted) setDownloadedEpisodes(downloaded)
          }
        } catch {
          // Non-critical
        }
      }
    }

    loadDetails()

    return () => {
      aborted = true
    }
  }, [isOpen, media.id])

  // Check if media is in library and favorite status
  useEffect(() => {
    if (!isOpen) return

    const checkLibrary = async () => {
      try {
        const status = await isInLibrary(media.id)
        setInLibrary(status)
        // Get status details from context
        const mediaStatus = getStatus(media.id)
        setIsFavorite(mediaStatus.isFavorite)
        setIsTracked(mediaStatus.isTracked)
        setLibraryStatus(mediaStatus.libraryStatus || null)
        // Load feedback status
        if (status) {
          const fb = await getMediaFeedback(media.id)
          setFeedback(fb?.sentiment ?? null)
          const libEntry = await getLibraryEntry(media.id).catch(() => null)
          setAutoDownloadState(libEntry?.auto_download ?? false)
        } else {
          setAutoDownloadState(false)
        }
        // Load completion recs if already completed
        if (mediaStatus.libraryStatus === 'completed') {
          getContentRecommendations(6)
            .then((recs) => setCompletionRecs(recs.filter((r) => r.media.id !== media.id)))
            .catch(() => {})
        }
      } catch (error) {
        console.error('Failed to check library status:', error)
      }
    }

    checkLibrary()
  }, [isOpen, media.id, getStatus])

  // Load tags for this media
  const loadMediaTags = async () => {
    try {
      const tags = await getMediaTags(media.id)
      setMediaTags(tags)
    } catch (error) {
      console.error('Failed to load media tags:', error)
    }
  }

  useEffect(() => {
    if (!isOpen || !inLibrary) {
      setMediaTags([])
      return
    }

    loadMediaTags()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, media.id, inLibrary])

  // Handle tag removal
  const handleRemoveTag = async (tagId: number) => {
    try {
      await unassignLibraryTag(media.id, tagId)
      setMediaTags((prev) => prev.filter((t) => t.id !== tagId))
    } catch (error) {
      console.error('Failed to remove tag:', error)
      notifyError('Error', 'Failed to remove tag')
    }
  }

  // Load watch history for all episodes
  useEffect(() => {
    if (!isOpen || !details) return

    const loadEpisodeWatchHistory = async () => {
      try {
        const allHistory = await getBatchWatchProgress(media.id)
        const historyMap = new Map<string, WatchHistory>()
        for (const h of allHistory) {
          historyMap.set(h.episode_id, h)
        }
        setEpisodeWatchHistory(historyMap)
      } catch (error) {
        console.error('Failed to load episode watch history:', error)
      }
    }

    loadEpisodeWatchHistory()

    // Refresh watch history when window regains visibility
    // (e.g., when user returns from /watch route)
    const handleVisibilityChange = () => {
      if (!document.hidden && isOpen && details) {
        loadEpisodeWatchHistory()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isOpen, details])

  // Auto-navigate to the page containing the first unwatched episode
  useEffect(() => {
    if (!details || episodeWatchHistory.size === 0) return
    // Find the first episode that hasn't been completed
    const firstUnwatchedIndex = details.episodes.findIndex(
      (ep) => !episodeWatchHistory.get(ep.id)?.completed
    )
    if (firstUnwatchedIndex >= 0) {
      setEpisodePage(Math.floor(firstUnwatchedIndex / EPISODES_PER_PAGE))
    }
  }, [episodeWatchHistory, details])

  // Check for new episodes using episode watch history
  useEffect(() => {
    if (!isOpen || !details) {
      setShowNewBadge(false)
      return
    }

    // Only show NEW badge for currently airing anime (not finished)
    if (!isAiring(details.status)) {
      setShowNewBadge(false)
      return
    }

    // Only check if user is tracking/watching
    if (!isTracked && !inLibrary) {
      setShowNewBadge(false)
      return
    }

    // Check if latest episode exists and has not been watched
    if (media.latest_episode && details.episodes.length > 0) {
      // Find the latest episode in our episode list
      const latestEp = details.episodes.find((ep) => ep.number === media.latest_episode)

      if (latestEp) {
        // Check if this episode has been watched
        const progress = episodeWatchHistory.get(latestEp.id)
        const hasWatched = progress && (progress.completed || progress.progress_seconds > 0)

        // Show NEW badge only if the latest episode hasn't been watched
        setShowNewBadge(!hasWatched)
      } else {
        setShowNewBadge(false)
      }
    } else {
      setShowNewBadge(false)
    }
  }, [
    isOpen,
    media,
    media.latest_episode,
    details,
    details?.status,
    isTracked,
    inLibrary,
    episodeWatchHistory,
  ])

  // Lazy-load enrichment data when tab changes
  useEffect(() => {
    if (!isOpen || !details) return
    if (loadedTabsRef.current.has(activeTab)) return

    const malId = parseInt(media.id)

    if (activeTab === 'characters') {
      loadedTabsRef.current.add('characters')
      setCharactersLoading(true)
      jikanAnimeCharacters(malId)
        .then(setCharacters)
        .catch(() => setCharacters([]))
        .finally(() => setCharactersLoading(false))
    } else if (activeTab === 'staff') {
      loadedTabsRef.current.add('staff')
      setStaffLoading(true)
      jikanAnimeStaff(malId)
        .then(setStaffData)
        .catch(() => setStaffData([]))
        .finally(() => setStaffLoading(false))
    } else if (activeTab === 'stats') {
      loadedTabsRef.current.add('stats')
      setStatisticsLoading(true)
      jikanAnimeStatistics(malId)
        .then(setStatistics)
        .catch(() => setStatistics({} as JikanStatistics))
        .finally(() => setStatisticsLoading(false))
    } else if (activeTab === 'reviews') {
      loadedTabsRef.current.add('reviews')
      setReviewsLoading(true)
      jikanAnimeReviews(malId, 1)
        .then((data) => {
          setReviews(data)
          setReviewHasMore(data.length >= 10)
        })
        .catch(() => {
          setReviews([])
          setReviewHasMore(false)
        })
        .finally(() => setReviewsLoading(false))
    } else if (activeTab === 'gallery') {
      loadedTabsRef.current.add('gallery')
      setPicturesLoading(true)
      jikanAnimePictures(malId)
        .then(setPictures)
        .catch(() => setPictures([]))
        .finally(() => setPicturesLoading(false))
    } else if (activeTab === 'news') {
      loadedTabsRef.current.add('news')
      setNewsLoading(true)
      jikanAnimeNews(malId)
        .then(setNewsData)
        .catch(() => setNewsData([]))
        .finally(() => setNewsLoading(false))
    } else if (activeTab === 'related') {
      loadedTabsRef.current.add('related')
      setRelatedLoading(true)
      const searchTitle = media.title.split(/[:\-–—]/)[0].trim()
      jikanSearchAnime(searchTitle, 1, true)
        .then((results) => {
          setRelatedAnime(results.results.filter((item) => item.id !== media.id).slice(0, 12))
        })
        .catch(() => setRelatedAnime([]))
        .finally(() => setRelatedLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isOpen, details, media.id])

  // Load sidebar data (statistics + related) eagerly when modal opens
  useEffect(() => {
    if (!isOpen || !details) return
    const malId = parseInt(media.id)

    if (!loadedTabsRef.current.has('stats')) {
      loadedTabsRef.current.add('stats')
      setStatisticsLoading(true)
      jikanAnimeStatistics(malId)
        .then(setStatistics)
        .catch(() => setStatistics({} as JikanStatistics))
        .finally(() => setStatisticsLoading(false))
    }

    if (!loadedTabsRef.current.has('related')) {
      loadedTabsRef.current.add('related')
      setRelatedLoading(true)
      const searchTitle = media.title.split(/[:\-–—]/)[0].trim()
      jikanSearchAnime(searchTitle, 1, true)
        .then((results) => {
          setRelatedAnime(results.results.filter((item) => item.id !== media.id).slice(0, 12))
        })
        .catch(() => setRelatedAnime([]))
        .finally(() => setRelatedLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, details, media.id])

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

  const mobile = isMobile()

  const subDownloadChoices = choicesForAudioTab(downloadChoices, 'sub')
  const dubDownloadChoices = choicesForAudioTab(downloadChoices, 'dub')
  const hasBothDownloadAudioTabs = subDownloadChoices.length > 0 && dubDownloadChoices.length > 0
  const activeDownloadAudioTab = choicesForAudioTab(downloadChoices, selectedDownloadAudioTab).length > 0
    ? selectedDownloadAudioTab
    : subDownloadChoices.length > 0 ? 'sub' : 'dub'
  const visibleDownloadChoices = choicesForAudioTab(downloadChoices, activeDownloadAudioTab)
  const activeDownloadChoice = downloadChoices.find(
    (choice) => choice.key === selectedDownloadChoiceKey
  )
  const activeSubtitleOptions = subtitleChoices(activeDownloadChoice?.subtitles || [])
  const selectDownloadChoice = (choice: DownloadSourceChoice) => {
    setSelectedDownloadChoiceKey(choice.key)
    const options = subtitleChoices(choice.subtitles)
    const english = options.find((option) => {
      const label = option.label.toLowerCase()
      return option.subtitle && (label.includes('english') || option.subtitle.language?.toLowerCase() === 'en')
    })
    setSelectedDownloadSubtitleKey(english?.key || 'off')
  }

  const modalContent = (
    <>
      {downloadPicker && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-[560px] rounded-xl border border-[var(--color-glass-border)] bg-[var(--color-panel)] shadow-2xl">
            <div className="flex items-start justify-between gap-4 p-5 border-b border-[var(--color-glass-border)]">
              <div>
                <h3 className="text-xl font-bold text-white">Download Options</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">
                  {downloadPicker.episodes.length} episode{downloadPicker.episodes.length === 1 ? '' : 's'} selected
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDownloadPicker(null)}
                className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center"
                disabled={downloadStarting}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {downloadPickerLoading ? (
                <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)] py-8">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Resolving downloadable variants...
                </div>
              ) : (
                <>
                  <div>
                    <div className="block text-xs uppercase tracking-[0.16em] text-[var(--color-text-muted)] mb-2">
                      Video
                    </div>
                    {hasBothDownloadAudioTabs && (
                      <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1 mb-3">
                        {(['sub', 'dub'] as const).map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            aria-pressed={activeDownloadAudioTab === tab}
                            onClick={() => {
                              setSelectedDownloadAudioTab(tab)
                              const nextChoice = choicesForAudioTab(downloadChoices, tab)[0]
                              if (nextChoice) selectDownloadChoice(nextChoice)
                            }}
                            className={`px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
                              activeDownloadAudioTab === tab
                                ? 'bg-[var(--color-accent-primary)] text-white'
                                : 'text-[var(--color-text-muted)] hover:text-white hover:bg-white/10'
                            }`}
                          >
                            {tab === 'sub' ? 'Sub' : 'Dub'}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="max-h-[260px] overflow-y-auto space-y-2 pr-1">
                      {visibleDownloadChoices.map((choice) => (
                        <button
                          key={choice.key}
                          type="button"
                          onClick={() => selectDownloadChoice(choice)}
                          className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                            selectedDownloadChoiceKey === choice.key
                              ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/12'
                              : 'border-[var(--color-glass-border)] bg-white/[0.03] hover:bg-white/[0.07]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-white">
                              {audioTypeLabel(choice.audioType)} · {choice.quality}
                            </span>
                            <span className="text-xs text-[var(--color-text-muted)]">{choice.server}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="download-subtitle-select"
                      className="block text-xs uppercase tracking-[0.16em] text-[var(--color-text-muted)] mb-2"
                    >
                      Subtitles
                    </label>
                    <select
                      id="download-subtitle-select"
                      value={selectedDownloadSubtitleKey}
                      onChange={(event) => setSelectedDownloadSubtitleKey(event.target.value)}
                      className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-glass-border)] rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {activeSubtitleOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--color-glass-border)]">
              <button
                type="button"
                onClick={() => setDownloadPicker(null)}
                disabled={downloadStarting}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startPickerDownloads}
                disabled={downloadPickerLoading || downloadStarting || !activeDownloadChoice}
                className="px-4 py-2 rounded-lg bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-secondary)] disabled:opacity-50 flex items-center gap-2"
              >
                {downloadStarting && <Loader2 className="w-4 h-4 animate-spin" />}
                Start Download
              </button>
            </div>
          </div>
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-12 h-12 animate-spin text-[var(--color-accent-primary)]" />
        </div>
      ) : error ? (
        // Custom error UI for API failures (no cached data available)
        <div className="py-20 px-8">
          <div className="max-w-md mx-auto text-center">
            {/* Error Icon */}
            <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
              <WifiOff className="w-12 h-12 text-red-400" />
            </div>

            {/* Title */}
            <h2 className="text-2xl font-bold mb-3 text-white">Unable to Load Details</h2>

            {/* Description */}
            <p className="text-[var(--color-text-secondary)] mb-6 leading-relaxed">
              Failed to fetch anime information from the source. This could be due to network issues
              or the source being temporarily unavailable.
            </p>

            {/* Error Details (collapsible) */}
            <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4 mb-6 text-left">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-400 mb-1">Error Details</p>
                  <p className="text-xs text-[var(--color-text-muted)] font-mono break-all">
                    {error}
                  </p>
                </div>
              </div>
            </div>

            {/* Media Preview (from search result) */}
            <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4 mb-6">
              <div className="flex items-center gap-4">
                {media.cover_url && (
                  <img
                    src={media.cover_url}
                    alt={media.title}
                    className="w-16 h-24 object-cover rounded-lg"
                  />
                )}
                <div className="text-left flex-1 min-w-0">
                  <p className="font-medium text-white truncate">{media.title}</p>
                  {media.year && (
                    <p className="text-sm text-[var(--color-text-secondary)]">{media.year}</p>
                  )}
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    No cached data available
                  </p>
                </div>
              </div>
            </div>

            {/* Help Text */}
            <p className="text-xs text-[var(--color-text-muted)]">
              Try again later or check if the source extension is working properly.
            </p>
          </div>
        </div>
      ) : details ? (
        <>
          {/* Cached Data Banner - shows when API failed but we have cached data */}
          {usingCachedData && (
            <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3">
              <div className="flex items-center justify-center gap-3 text-amber-400">
                <Database className="w-5 h-5" />
                <span className="text-sm font-medium">
                  Showing cached data — source unavailable
                </span>
                <span className="text-xs text-amber-400/60">(Episode links may not work)</span>
              </div>
            </div>
          )}

          {/* Banner */}
          <div className="relative h-[280px] overflow-hidden rounded-t-xl">
            {details.cover_url && (
              <img
                src={details.cover_url}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-deep)] via-[var(--color-deep)]/80 to-transparent" />
            <div
              className="absolute inset-0 bg-gradient-to-r from-[var(--color-deep)] to-transparent"
              style={{ opacity: 0.5 }}
            />

            {/* Close button */}
            {!mobile && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm hover:bg-white/20 flex items-center justify-center transition-all border border-white/10"
                aria-label="Close"
              >
                <X size={18} strokeWidth={2.5} />
              </button>
            )}

            {/* Banner content */}
            <div className="absolute bottom-0 left-0 right-0 px-7 pb-5">
              <h1
                className="font-['Space_Grotesk',sans-serif] text-2xl md:text-[2rem] font-extrabold text-white mb-2.5 leading-tight"
                style={{ textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}
              >
                {details.english_name || details.title}
              </h1>
              {details.english_name && details.title !== details.english_name && (
                <p className="text-sm text-white/70 mb-2">{details.title}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {details.type && <span className="chip">{details.type}</span>}
                {kaa?.age_rating && <span className="chip">{kaa.age_rating}</span>}
                {details.year && <span className="chip">{details.year}</span>}
                {details.rating && (
                  <span className="chip chip-gold">★ {details.rating.toFixed(2)}</span>
                )}
                {details.status && details.status.toLowerCase() !== 'unknown' && (
                  <span className={`chip ${isAiring(details.status) ? 'chip-green' : ''}`}>
                    {details.status}
                  </span>
                )}
                {details.episodes.length > 0 && (
                  <span className="chip">{details.episodes.length} EP</span>
                )}
                {showNewBadge && media.latest_episode && (
                  <span className="chip chip-green">NEW EP {media.latest_episode}</span>
                )}
                {details.genres.map((genre) => (
                  <span key={genre} className="chip">
                    {genre}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-2.5 px-5 md:px-7 py-3.5 bg-[var(--color-deep)] border-b border-[var(--color-glass-border)] relative flex-wrap">
            {details.episodes.length > 0 &&
              (() => {
                // Determine which episode to play and button text
                let episodeToPlay = details.episodes[0]
                let buttonText = 'Watch Now'
                let isNewEpisode = false

                // Find the last watched episode
                let lastWatchedIndex = -1
                let hasPartialProgress = false

                for (let i = 0; i < details.episodes.length; i++) {
                  const ep = details.episodes[i]
                  const progress = episodeWatchHistory.get(ep.id)

                  if (progress) {
                    if (progress.completed) {
                      lastWatchedIndex = i
                    } else if (progress.progress_seconds > 0 && !hasPartialProgress) {
                      // Found first partially watched episode - prioritize this
                      episodeToPlay = ep
                      buttonText = `Resume EP ${ep.number}`
                      hasPartialProgress = true
                      break
                    }
                  }
                }

                // If no partial progress, determine next episode
                if (!hasPartialProgress) {
                  if (lastWatchedIndex === details.episodes.length - 1) {
                    // All episodes watched - show latest
                    episodeToPlay = details.episodes[lastWatchedIndex]
                    buttonText = `Watch EP ${episodeToPlay.number}`
                  } else if (lastWatchedIndex >= 0) {
                    // Continue to next unwatched episode
                    episodeToPlay = details.episodes[lastWatchedIndex + 1]
                    buttonText = `Continue EP ${episodeToPlay.number}`
                    isNewEpisode = showNewBadge // It's a "new" episode if the NEW badge is showing
                  } else {
                    // No watch history - start from beginning
                    episodeToPlay = details.episodes.reduce(
                      (min, ep) => (ep.number < min.number ? ep : min),
                      details.episodes[0]
                    )
                    buttonText = 'Watch Now'
                  }
                }

                return (
                  <button
                    onClick={() => handleWatch(episodeToPlay.id)}
                    className={`flex items-center gap-2 px-5 py-2.5 text-white font-semibold rounded-[var(--radius-md)] transition-all duration-150 shadow-[0_0_20px_rgba(229,9,20,0.3)] hover:shadow-[0_0_30px_rgba(229,9,20,0.45)] whitespace-nowrap text-sm ${
                      isNewEpisode
                        ? 'bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 shadow-emerald-500/30'
                        : 'bg-[var(--color-accent-gradient)]'
                    }`}
                  >
                    {isNewEpisode && <Sparkles size={16} />}
                    <Play size={16} fill="currentColor" />
                    <span>{buttonText}</span>
                  </button>
                )
              })()}
            {/* Library dropdown */}
            {(() => {
              // Smart status display: Show "Watching" if user hasn't watched all episodes
              let smartDisplayStatus = libraryStatus
              let isOnTrack = false

              if (details && libraryStatus) {
                const watchedCount = Array.from(episodeWatchHistory.values()).filter(
                  (progress) => progress.completed
                ).length

                if (
                  watchedCount < details.episodes.length &&
                  libraryStatus !== 'dropped' &&
                  libraryStatus !== 'on_hold' &&
                  libraryStatus !== 'plan_to_watch'
                ) {
                  smartDisplayStatus = 'watching'
                } else if (
                  isAiring(details.status) &&
                  watchedCount >= details.episodes.length &&
                  details.episode_count != null &&
                  details.episodes.length < details.episode_count
                ) {
                  smartDisplayStatus = 'watching'
                  isOnTrack = true
                }
              }

              return (
                <LibraryDropdown
                  inLibrary={inLibrary}
                  currentStatus={libraryStatus}
                  loading={libraryLoading}
                  onAdd={handleAddToLibrary}
                  onRemove={handleRemoveFromLibrary}
                  displayStatus={smartDisplayStatus}
                  isOnTrack={isOnTrack}
                  mediaType="anime"
                />
              )
            })()}
            {/* Favorite button */}
            <button
              onClick={handleToggleFavorite}
              className={`flex items-center justify-center w-10 h-10 rounded-[var(--radius-md)] transition-all duration-150 border ${
                isFavorite
                  ? 'bg-[rgba(229,9,20,0.15)] text-[var(--color-accent-light)] border-[var(--color-accent-mid)]'
                  : 'glass text-[var(--color-text-muted)] hover:text-white'
              }`}
              aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart className={`w-5 h-5 sm:w-6 sm:h-6 ${isFavorite ? 'fill-current' : ''}`} />
            </button>
            {/* Thumbs up/down feedback buttons */}
            {inLibrary && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleFeedback('liked')
                  }}
                  className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg transition-all duration-150 cursor-pointer ${
                    feedback === 'liked'
                      ? 'bg-emerald-500 text-white border border-emerald-400'
                      : 'bg-[var(--color-glass-bg)] text-[var(--color-text-muted)] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-bg-hover)] hover:text-white'
                  }`}
                  aria-label={feedback === 'liked' ? 'Remove like' : 'Like this anime'}
                >
                  <ThumbsUp
                    className={`w-5 h-5 sm:w-6 sm:h-6 ${feedback === 'liked' ? 'fill-current' : ''}`}
                  />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleFeedback('disliked')
                  }}
                  className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg transition-all duration-150 cursor-pointer ${
                    feedback === 'disliked'
                      ? 'bg-red-500 text-white border border-red-400'
                      : 'bg-[var(--color-glass-bg)] text-[var(--color-text-muted)] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-bg-hover)] hover:text-white'
                  }`}
                  aria-label={feedback === 'disliked' ? 'Remove dislike' : 'Dislike this anime'}
                >
                  <ThumbsDown
                    className={`w-5 h-5 sm:w-6 sm:h-6 ${feedback === 'disliked' ? 'fill-current' : ''}`}
                  />
                </button>
              </>
            )}
            {/* Release tracking indicator */}
            {isTracked && (
              <div
                className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-indigo-500 text-white rounded-lg transition-all border border-indigo-400"
                title="Tracking new episode releases"
              >
                <Bell className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
            )}
            {/* Auto-download toggle (in-library only; this modal is anime-only) */}
            {inLibrary && (
              <button
                onClick={handleToggleAutoDownload}
                className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg transition-all duration-150 border ${
                  autoDownload
                    ? 'bg-sky-500/20 text-sky-300 border-sky-400/60'
                    : 'bg-[var(--color-glass-bg)] text-[var(--color-text-muted)] border-[var(--color-glass-border)] hover:bg-[var(--color-glass-bg-hover)] hover:text-white'
                }`}
                aria-label={
                  autoDownload ? 'Disable auto-download' : 'Enable auto-download for new episodes'
                }
                title={
                  autoDownload
                    ? 'Auto-download is on for new episodes'
                    : 'Auto-download new episodes'
                }
              >
                <DownloadCloud className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
            )}
            {/* Next episode timer */}
            {isAiring(details.status) && ((details.last_update_end && details.broadcast_interval) || kaaCountdown) && (
              <div className="ml-auto hidden md:flex items-center">
                <NextEpisodeCountdown
                  latestEpisodeDate={media.latest_episode_date}
                  lastUpdateEnd={details.last_update_end || kaaCountdown!.lastUpdateEnd}
                  broadcastInterval={details.broadcast_interval || kaaCountdown!.broadcastInterval}
                  status={details.status}
                />
              </div>
            )}
          </div>

          {/* Two-Column Body */}
          <div className="flex flex-col md:flex-row">
            {/* Sidebar */}
            <div className="hidden md:block w-[220px] shrink-0 p-5 border-r border-[var(--color-glass-border)]">
              {/* Poster */}
              {(kaa?.banner_url || details.cover_url) && (
                <img
                  src={kaa?.banner_url || details.cover_url}
                  alt={details.title}
                  className="w-full aspect-[2/3] rounded-lg object-cover shadow-xl"
                />
              )}

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2.5 mt-4">
                <div className="bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-lg p-2.5 text-center">
                  <div className="font-['Space_Grotesk',sans-serif] font-bold text-[1.1rem] text-[var(--color-gold)]">
                    {details.rating ? details.rating.toFixed(2) : 'N/A'}
                  </div>
                  <div className="text-[0.65rem] text-[var(--color-text-muted)] uppercase tracking-[0.08em] mt-0.5">
                    Score
                  </div>
                </div>
                {details.rank && (
                  <div className="bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-lg p-2.5 text-center">
                    <div className="font-['Space_Grotesk',sans-serif] font-bold text-[1.1rem] text-[var(--color-cyan)]">
                      #{details.rank}
                    </div>
                    <div className="text-[0.65rem] text-[var(--color-text-muted)] uppercase tracking-[0.08em] mt-0.5">
                      Ranked
                    </div>
                  </div>
                )}
                {details.popularity && (
                  <div className="bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-lg p-2.5 text-center">
                    <div className="font-['Space_Grotesk',sans-serif] font-bold text-[1.1rem]">
                      #{details.popularity}
                    </div>
                    <div className="text-[0.65rem] text-[var(--color-text-muted)] uppercase tracking-[0.08em] mt-0.5">
                      Popular
                    </div>
                  </div>
                )}
                <div className="bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-lg p-2.5 text-center">
                  <div className="font-['Space_Grotesk',sans-serif] font-bold text-[1.1rem]">
                    {details.episodes.length || '?'}
                  </div>
                  <div className="text-[0.65rem] text-[var(--color-text-muted)] uppercase tracking-[0.08em] mt-0.5">
                    Episodes
                  </div>
                </div>
              </div>

              {/* Related */}
              {relatedAnime.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-[0.7rem] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-semibold mb-3">
                    Related
                  </h3>
                  {relatedAnime.slice(0, 3).map((anime) => (
                    <div
                      key={anime.id}
                      className="flex gap-3 py-2 cursor-pointer hover:bg-white/[0.03] rounded-md px-1"
                      onClick={() => onMediaChange?.(anime)}
                    >
                      {anime.cover_url && (
                        <img
                          src={anime.cover_url}
                          alt={anime.title}
                          className="w-12 h-16 rounded object-cover shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-[0.8rem] font-semibold text-white line-clamp-2 leading-snug">
                          {anime.title}
                        </p>
                        {anime.year && (
                          <p className="text-[0.7rem] text-[var(--color-text-muted)] mt-0.5">
                            {anime.year}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {relatedLoading && (
                <div className="mt-6">
                  <h3 className="text-[0.7rem] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-semibold mb-3">
                    Related
                  </h3>
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex gap-3 py-2">
                      <div className="w-12 h-16 rounded bg-[var(--color-bg-secondary)] animate-pulse shrink-0" />
                      <div className="flex-1 space-y-2 py-1">
                        <div className="h-3 bg-[var(--color-bg-secondary)] rounded animate-pulse w-3/4" />
                        <div className="h-2 bg-[var(--color-bg-secondary)] rounded animate-pulse w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tags */}
              {inLibrary && (
                <div className="mt-6">
                  <h3 className="text-[0.7rem] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-semibold mb-2">
                    Tags
                  </h3>
                  <TagChips tags={mediaTags} onRemove={handleRemoveTag} />
                  <div className="relative mt-2">
                    <button
                      ref={tagButtonRef}
                      onClick={() => setShowTagSelector(!showTagSelector)}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white/10 hover:bg-white/20 rounded-full transition-colors border border-white/20"
                    >
                      <Tags className="w-3 h-3" />
                      <span>{mediaTags.length > 0 ? 'Edit' : 'Add Tags'}</span>
                    </button>
                    <TagSelector
                      mediaId={media.id}
                      isOpen={showTagSelector}
                      onClose={() => setShowTagSelector(false)}
                      onTagsChange={loadMediaTags}
                      anchorRef={tagButtonRef}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Detail Tabs */}
              <DetailTabBar
                tabs={[
                  { id: 'overview', label: 'Overview' },
                  ...(details.episodes.length > 0
                    ? [{ id: 'episodes', label: 'Episodes', count: details.episodes.length }]
                    : []),
                  { id: 'characters', label: 'Characters' },
                  { id: 'reviews', label: 'Reviews' },
                ]}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />

              <div className="p-5">
                {/* Overview Tab */}
                {activeTab === 'overview' && (
                  <div>
                    {details.description && (
                      <Description
                        content={details.description}
                        className="text-[0.9375rem] leading-[1.75] text-[var(--color-text-secondary)] mb-5"
                      />
                    )}
                    {/* Info Grid */}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 mb-5">
                      {details.type && (
                        <div>
                          <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                            Type
                          </div>
                          <div className="text-sm font-medium text-[var(--color-text-primary)]">
                            {details.type}
                          </div>
                        </div>
                      )}
                      {(details.episodes.length > 0 || details.episode_count) && (
                        <div>
                          <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                            Episodes
                          </div>
                          <div className="text-sm font-medium text-[var(--color-text-primary)]">
                            {details.episode_count || details.episodes.length}
                          </div>
                        </div>
                      )}
                      {details.status && details.status.toLowerCase() !== 'unknown' && (
                        <div>
                          <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                            Status
                          </div>
                          <div
                            className="text-sm font-medium capitalize"
                            style={{
                              color: details.status.toLowerCase().includes('finished')
                                ? 'var(--color-green, #22c55e)'
                                : 'var(--color-text-primary)',
                            }}
                          >
                            {details.status}
                          </div>
                        </div>
                      )}
                      {details.aired_start && (
                        <div>
                          <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                            Aired
                          </div>
                          <div className="text-sm font-medium text-[var(--color-text-primary)]">
                            {details.aired_start.month && details.aired_start.date
                              ? `${details.aired_start.month}/${details.aired_start.date}/`
                              : ''}
                            {details.aired_start.year}
                          </div>
                        </div>
                      )}
                      {kaaFacts.map(([label, value]) => (
                        <div key={label}>
                          <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                            {label}
                          </div>
                          <div className="text-sm font-medium text-[var(--color-text-primary)]">{value}</div>
                        </div>
                      ))}
                      {details.season && (
                        <div>
                          <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                            Season
                          </div>
                          <div className="text-sm font-medium text-[var(--color-text-primary)]">
                            {details.season.quarter} {details.season.year}
                          </div>
                        </div>
                      )}
                      {details.studios && details.studios.length > 0 && (
                        <div>
                          <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                            Studio
                          </div>
                          <div className="text-sm font-medium text-[var(--color-text-primary)]">
                            {details.studios.map((s) => s.name).join(' / ')}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Episodes */}
                {activeTab === 'episodes' && details.episodes.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
                      <h2 className="text-xl sm:text-2xl font-semibold flex items-center gap-2 border-l-[3px] border-[var(--color-accent-primary)] pl-3">
                        <svg
                          className="w-5 h-5 sm:w-6 sm:h-6 text-[var(--color-accent-primary)]"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        Episodes ({details.episodes.length})
                      </h2>

                      {/* Download Action Buttons */}
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        {selectionMode && (
                          <>
                            <button
                              onClick={
                                selectedEpisodes.size === details.episodes.length
                                  ? deselectAllEpisodes
                                  : selectAllEpisodes
                              }
                              className="px-2 sm:px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-xs sm:text-sm font-medium whitespace-nowrap"
                            >
                              {selectedEpisodes.size === details.episodes.length
                                ? 'Deselect All'
                                : 'Select All'}
                            </button>
                            <button
                              onClick={async () => {
                                if (!details) return
                                const now = new Date().toISOString()
                                const newHistory = new Map(episodeWatchHistory)
                                for (const ep of details.episodes) {
                                  if (
                                    selectedEpisodes.has(ep.id) &&
                                    !episodeWatchHistory.get(ep.id)?.completed
                                  ) {
                                    await saveWatchProgress(media.id, ep.id, ep.number, 1, 1, true)
                                    newHistory.set(ep.id, {
                                      id: 0,
                                      media_id: media.id,
                                      episode_id: ep.id,
                                      episode_number: ep.number,
                                      progress_seconds: 1,
                                      duration: 1,
                                      completed: true,
                                      last_watched: now,
                                      created_at: now,
                                    })
                                  }
                                }
                                setEpisodeWatchHistory(newHistory)
                                toastSuccess(
                                  media.title,
                                  `${selectedEpisodes.size} episodes marked as watched`
                                )
                                setSelectionMode(false)
                                setSelectedEpisodes(new Set())
                              }}
                              disabled={selectedEpisodes.size === 0}
                              className="px-2 sm:px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2 whitespace-nowrap"
                            >
                              <CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                              Mark Watched ({selectedEpisodes.size})
                            </button>
                            <button
                              onClick={handleDownloadSelected}
                              disabled={
                                selectedEpisodes.size === 0 ||
                                downloadProviderResolving ||
                                bridgeFailed
                              }
                              className="px-2 sm:px-3 py-1.5 bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-secondary)] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2 whitespace-nowrap"
                            >
                              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                              Download ({selectedEpisodes.size})
                            </button>
                            <button
                              onClick={() => {
                                setSelectionMode(false)
                                setSelectedEpisodes(new Set())
                              }}
                              className="px-2 sm:px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-xs sm:text-sm font-medium whitespace-nowrap"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {!selectionMode && (
                          <>
                            <button
                              onClick={handleDownloadAll}
                              disabled={downloadProviderResolving || bridgeFailed}
                              className="px-2 sm:px-3 py-1.5 bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-secondary)] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2 whitespace-nowrap"
                            >
                              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                              Download All
                            </button>
                            <button
                              onClick={() => setSelectionMode(true)}
                              className="px-2 sm:px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2 whitespace-nowrap"
                            >
                              <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                              Select
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Pagination controls (only show when > EPISODES_PER_PAGE) */}
                    {details.episodes.length > EPISODES_PER_PAGE && (
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm text-[var(--color-text-muted)]">
                          {episodePage * EPISODES_PER_PAGE + 1}–
                          {Math.min((episodePage + 1) * EPISODES_PER_PAGE, details.episodes.length)}{' '}
                          of {details.episodes.length}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEpisodePage((p) => Math.max(0, p - 1))}
                            disabled={episodePage === 0}
                            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors text-sm font-medium"
                          >
                            Prev
                          </button>
                          <span className="text-sm text-[var(--color-text-secondary)] tabular-nums">
                            {episodePage + 1} /{' '}
                            {Math.ceil(details.episodes.length / EPISODES_PER_PAGE)}
                          </span>
                          <button
                            onClick={() =>
                              setEpisodePage((p) =>
                                Math.min(
                                  Math.ceil(details.episodes.length / EPISODES_PER_PAGE) - 1,
                                  p + 1
                                )
                              )
                            }
                            disabled={
                              episodePage >=
                              Math.ceil(details.episodes.length / EPISODES_PER_PAGE) - 1
                            }
                            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors text-sm font-medium"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {gridEpisodes
                        .slice(
                          episodePage * EPISODES_PER_PAGE,
                          (episodePage + 1) * EPISODES_PER_PAGE
                        )
                        .map((episode) => {
                          const isUnaired = episode.aired
                            ? new Date(episode.aired) > new Date()
                            : false
                          return (
                            <div
                              key={episode.id}
                              className={`group relative rounded-[var(--radius-md)] overflow-hidden bg-[var(--color-card)] border border-[var(--color-glass-border)] transition-all duration-150 ${
                                isUnaired
                                  ? 'opacity-50 cursor-default'
                                  : bridgeFailed
                                    ? 'opacity-60 grayscale cursor-not-allowed'
                                    : selectionMode
                                      ? `hover:border-[var(--color-accent-mid)] cursor-pointer ${
                                          selectedEpisodes.has(episode.id)
                                            ? 'border-[var(--color-accent-primary)] shadow-[0_0_12px_rgba(229,9,20,0.2)]'
                                            : 'hover:border-white/30'
                                        }`
                                      : 'hover:border-[var(--color-accent-mid)] hover:shadow-[0_0_12px_rgba(229,9,20,0.15)]'
                              }`}
                              onClick={
                                bridgeFailed || isUnaired
                                  ? undefined
                                  : selectionMode
                                    ? () => toggleEpisodeSelection(episode.id)
                                    : undefined
                              }
                            >
                              {/* Thumbnail or placeholder */}
                              <div className="relative aspect-video">
                                {episode.thumbnail || details.cover_url ? (
                                  <img
                                    src={(episode.thumbnail || details.cover_url)!}
                                    alt={episode.title || `Episode ${episode.number}`}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[var(--color-surface)] to-[var(--color-card)]">
                                    <svg
                                      className="w-8 h-8 text-[var(--color-text-dim)]"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                                      />
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                      />
                                    </svg>
                                    <span className="text-xs text-[var(--color-text-dim)]">
                                      Episode {episode.number}
                                    </span>
                                  </div>
                                )}

                                {/* Unavailable overlay (bridge resolution failed) */}
                                {bridgeFailed && !selectionMode && (
                                  <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-20">
                                    <AlertTriangle className="w-5 h-5 text-yellow-500 mb-1" />
                                    <span className="text-[10px] font-semibold text-yellow-500/90 uppercase tracking-wide">
                                      Unavailable
                                    </span>
                                  </div>
                                )}

                                {/* Unaired overlay */}
                                {isUnaired && !selectionMode && (
                                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-20">
                                    <Clock className="w-5 h-5 text-blue-400 mb-1" />
                                    <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide">
                                      Yet to be released
                                    </span>
                                    {episode.aired && (
                                      <span className="text-[10px] text-white/60 mt-0.5">
                                        {new Date(episode.aired).toLocaleDateString(undefined, {
                                          month: 'short',
                                          day: 'numeric',
                                          year: 'numeric',
                                        })}
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* Play button overlay on hover (only in normal mode, and bridge resolved) */}
                                {!selectionMode && !bridgeFailed && !isUnaired && (
                                  <div
                                    className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                                    onClick={() => handleWatch(episode.id)}
                                  >
                                    <div className="w-12 h-12 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center transform group-hover:scale-110 transition-transform">
                                      <svg
                                        className="w-6 h-6 ml-0.5"
                                        fill="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path d="M8 5v14l11-7z" />
                                      </svg>
                                    </div>
                                  </div>
                                )}

                                {/* Small download/delete button at top right on hover (only in normal mode, not downloading, bridge resolved, already aired) */}
                                {!selectionMode &&
                                  !bridgeFailed &&
                                  !downloadProviderResolving &&
                                  !isUnaired &&
                                  !downloadingEpisodes.has(episode.number) && (
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

                                {/* Top-left row: EP badge stays put; "i" expands in before it on hover */}
                                <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
                                  {!selectionMode && (
                                    <button
                                      onClick={(e) =>
                                        handleEpisodeInfo(e, episode.id, episode.number)
                                      }
                                      className="h-6 overflow-hidden rounded-md bg-black/70 hover:bg-white/20 backdrop-blur-sm flex items-center justify-center transition-all duration-200 w-6 opacity-100 sm:w-0 sm:opacity-0 sm:group-hover:w-6 sm:group-hover:opacity-100"
                                      title="Episode info"
                                    >
                                      <Info size={12} className="shrink-0" />
                                    </button>
                                  )}
                                  <div className="px-2.5 py-1 bg-black/80 backdrop-blur-sm rounded-md text-xs font-bold whitespace-nowrap">
                                    EP {episode.number}
                                  </div>
                                </div>

                                {/* NEW badge — shown for episodes aired in the last 3 days (hides on hover) */}
                                {!selectionMode &&
                                  !episodeWatchHistory.has(episode.id) &&
                                  details.last_update_end &&
                                  isRecentlyAired(
                                    episode.number,
                                    details.episodes[details.episodes.length - 1].number,
                                    details.last_update_end,
                                    details.broadcast_interval
                                  ) && (
                                    <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-emerald-500/90 backdrop-blur-sm rounded text-[10px] font-bold uppercase tracking-wide text-white group-hover:opacity-0 transition-opacity">
                                      NEW
                                    </div>
                                  )}

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
                                ) : (
                                  downloadedEpisodes.has(episode.number) && (
                                    <div className="absolute top-2 right-2 px-2.5 py-1 bg-green-600/90 backdrop-blur-sm rounded-md text-xs font-bold flex items-center gap-1 group-hover:opacity-0 transition-opacity">
                                      <CheckCircle className="w-3 h-3" />
                                      Downloaded
                                    </div>
                                  )
                                )}

                                {/* Mark watched button — visible on hover when not fully watched */}
                                {!selectionMode &&
                                  !episodeWatchHistory.get(episode.id)?.completed && (
                                    <button
                                      onClick={(e) =>
                                        handleToggleEpisodeWatched(e, episode.id, episode.number)
                                      }
                                      className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 hover:bg-blue-600 backdrop-blur-sm rounded-md text-xs font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all z-10"
                                      title="Mark as watched"
                                    >
                                      <Check className="w-3 h-3" />
                                      Watched
                                    </button>
                                  )}

                                {/* Watched indicator */}
                                {episodeWatchHistory.has(episode.id) &&
                                  (() => {
                                    const history = episodeWatchHistory.get(episode.id)!
                                    const isCompleted = history.completed
                                    const progressPercent = history.duration
                                      ? Math.min(
                                          100,
                                          Math.round(
                                            (history.progress_seconds / history.duration) * 100
                                          )
                                        )
                                      : 0

                                    return (
                                      <>
                                        {/* Completed badge — clickable to unwatch */}
                                        {isCompleted && (
                                          <button
                                            onClick={(e) =>
                                              handleToggleEpisodeWatched(
                                                e,
                                                episode.id,
                                                episode.number
                                              )
                                            }
                                            className="absolute bottom-2 right-2 px-2 py-1 bg-blue-600/90 hover:bg-red-600/90 backdrop-blur-sm rounded-md text-xs font-bold flex items-center gap-1 transition-colors z-10"
                                            title="Click to mark as unwatched"
                                          >
                                            <Check className="w-3 h-3" />
                                            Watched
                                          </button>
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
                              {/* Episode info below thumbnail */}
                              <div className="px-2.5 py-2">
                                <p className="font-mono text-[0.75rem] font-semibold text-[var(--color-text-muted)]">
                                  EP {String(episode.number).padStart(2, '0')}
                                </p>
                                {episode.title && (
                                  <p
                                    className="text-[0.875rem] font-semibold text-white line-clamp-1 mt-0.5"
                                    style={{
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {episode.title}
                                  </p>
                                )}
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )}

                {/* Episode info overlay */}
                {episodeInfoTarget && (
                  <div
                    className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center sm:p-4 bg-black/70 backdrop-blur-xl"
                    onClick={() => setEpisodeInfoTarget(null)}
                  >
                    <div
                      className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto bg-[var(--color-panel)] border border-[var(--color-glass-border)] rounded-t-2xl sm:rounded-[var(--radius-lg)] p-5 shadow-[var(--shadow-lg)]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Mobile grab handle */}
                      <div className="sm:hidden w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
                      {/* Header */}
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div>
                          <span className="text-xs font-semibold text-[var(--color-accent-primary)] uppercase tracking-wider">
                            Episode {episodeInfoTarget.number}
                          </span>
                          <h3 className="text-base font-bold mt-0.5 leading-snug">
                            {episodeInfoLoading ? (
                              <span className="opacity-40">Loading…</span>
                            ) : (
                              episodeInfo?.title || `Episode ${episodeInfoTarget.number}`
                            )}
                          </h3>
                          {episodeInfo?.title_japanese && (
                            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                              {episodeInfo.title_japanese}
                            </p>
                          )}
                          {episodeInfo?.title_romanji &&
                            episodeInfo.title_romanji !== episodeInfo.title && (
                              <p className="text-xs text-[var(--color-text-muted)]">
                                {episodeInfo.title_romanji}
                              </p>
                            )}
                        </div>
                        <button
                          onClick={() => setEpisodeInfoTarget(null)}
                          className="shrink-0 p-1.5 rounded-lg hover:bg-white/10 transition-colors text-[var(--color-text-muted)]"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      {/* Meta badges */}
                      {episodeInfo && (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {episodeInfo.aired && (
                            <span className="px-2 py-0.5 bg-white/8 rounded text-xs text-[var(--color-text-secondary)]">
                              {new Date(episodeInfo.aired).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          )}
                          {episodeInfo.duration && (
                            <span className="px-2 py-0.5 bg-white/8 rounded text-xs text-[var(--color-text-secondary)]">
                              {Math.floor(episodeInfo.duration / 60)} min
                            </span>
                          )}
                          {episodeInfo.filler && (
                            <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 rounded text-xs font-medium">
                              Filler
                            </span>
                          )}
                          {episodeInfo.recap && (
                            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs font-medium">
                              Recap
                            </span>
                          )}
                        </div>
                      )}

                      {/* Synopsis */}
                      {episodeInfoLoading && (
                        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                          <Loader2 size={14} className="animate-spin" />
                          Loading episode info…
                        </div>
                      )}
                      {!episodeInfoLoading && episodeInfo?.synopsis && (
                        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                          {episodeInfo.synopsis}
                        </p>
                      )}
                      {!episodeInfoLoading && !episodeInfo?.synopsis && (
                        <p className="text-sm text-[var(--color-text-muted)] italic">
                          No synopsis available.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Characters Tab */}
                {activeTab === 'characters' && (
                  <CharacterGrid
                    characters={characters || []}
                    loading={charactersLoading || !characters}
                  />
                )}

                {/* Reviews Tab */}
                {activeTab === 'reviews' && (
                  <ReviewList
                    reviews={reviews || []}
                    loading={reviewsLoading || !reviews}
                    hasMore={reviewHasMore}
                    loadingMore={reviewLoadingMore}
                    onLoadMore={async () => {
                      if (reviewLoadingMore || !reviewHasMore) return
                      setReviewLoadingMore(true)
                      try {
                        const nextPage = reviewPage + 1
                        const moreReviews = await jikanAnimeReviews(parseInt(media.id), nextPage)
                        setReviews((prev) => [...(prev || []), ...moreReviews])
                        setReviewPage(nextPage)
                        setReviewHasMore(moreReviews.length >= 10)
                      } catch {
                        setReviewHasMore(false)
                      } finally {
                        setReviewLoadingMore(false)
                      }
                    }}
                  />
                )}
              </div>
            </div>
            {/* close content column */}
          </div>
          {/* close two-column */}

          {/* Post-completion recommendations */}
          {libraryStatus === 'completed' && completionRecs.length > 0 && (
            <div className="px-5 md:px-7 py-5 border-t border-[var(--color-glass-border)]">
              <div className="bg-[var(--color-surface-subtle)] rounded-[var(--radius-md)] p-4">
                <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
                  What to watch next
                </h3>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {completionRecs.slice(0, 6).map((rec) => (
                    <div
                      key={rec.media.id}
                      className="flex-shrink-0 w-[100px] cursor-pointer group/rec"
                      onClick={() => {
                        const asSearchResult: SearchResult = {
                          id: rec.media.id,
                          title: rec.media.title,
                          cover_url: rec.media.cover_url || '',
                          year: rec.media.year,
                          status: rec.media.status,
                        }
                        onMediaChange?.(asSearchResult)
                      }}
                    >
                      <div className="aspect-[2/3] rounded-lg overflow-hidden bg-[var(--color-bg-secondary)] border border-[var(--color-glass-border)] group-hover/rec:border-[var(--color-accent-mid)] transition-all">
                        {rec.media.cover_url ? (
                          <img
                            src={rec.media.cover_url}
                            alt={rec.media.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[var(--color-text-dim)]">
                            <Play size={20} />
                          </div>
                        )}
                      </div>
                      <p className="text-xs font-medium text-[var(--color-text-secondary)] mt-1.5 line-clamp-2 leading-snug group-hover/rec:text-white transition-colors">
                        {rec.media.title}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </>
  )

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto animate-in fade-in duration-300">
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xl animate-in fade-in duration-300"
        onClick={onClose}
      />
      <div className="relative min-h-screen flex items-start justify-center p-4 sm:p-6 lg:p-8">
        <div className="relative bg-[var(--color-panel)] rounded-[var(--radius-lg)] max-w-[1000px] w-full my-8 shadow-[0_40px_120px_rgba(0,0,0,0.8),0_0_60px_var(--color-accent-glow,rgba(229,9,20,0.15))] animate-in slide-in-from-bottom-4 duration-500 border border-[var(--color-glass-border)]">
          {modalContent}
        </div>
      </div>
    </div>
  )
}
