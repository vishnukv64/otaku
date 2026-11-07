/**
 * Phone anime detail (mock: design/files/detail.html).
 * Same props and data logic as MediaDetailModal; rendered as a pushed full screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle,
  ChevronDown,
  Clock,
  Database,
  Download,
  DownloadCloud,
  Heart,
  Loader2,
  MoreVertical,
  Play,
  Sparkles,
  Tags,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react'
import {
  jikanAnimeDetails,
  jikanAnimeCharacters,
  jikanAnimeReviews,
  jikanAnimeStatistics,
  jikanAnimeEpisodeDetail,
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
  searchAnime,
  type RecommendationEntry,
  type MediaEntry,
  type EpisodeEntry,
  type WatchHistory,
  type LibraryStatus,
  type LibraryTag,
  type JikanCharacterEntry,
  type JikanReview,
  type JikanStatistics,
  type JikanEpisodeDetail,
} from '@/utils/tauri-commands'
import type { SearchResult, MediaDetails, Episode } from '@/types/extension'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { resolveAnikotoSlug } from '@/utils/anikotoResolver'
import { nextStreamingProvider, slugProviderExtension, streamingProviderLabel } from '@/utils/streamingProviders'
import { savePendingReturn } from '@/utils/return-media'
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
import { notifySuccess, notifyError, notifyInfo, toastSuccess } from '@/utils/notify'
import { TagSelector, TagChips } from '@/components/library'
import { Description } from '@/components/ui/Description'
import { BottomSheet, SheetOption } from '@/components/ui/BottomSheet'
import { NextEpisodeCountdown } from '@/components/media/NextEpisodeCountdown'
import { DetailTabBar } from '@/components/media/DetailTabBar'
import { CharacterGrid } from '@/components/media/CharacterGrid'
import { ReviewList } from '@/components/media/ReviewCard'
import { ScoreDistribution } from '@/components/media/ScoreDistribution'
import { useDownloadEvents } from '@/hooks/useDownloadEvents'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { useProxiedImage } from '@/hooks/useProxiedImage'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import { useSettingsStore } from '@/store/settingsStore'
import { PushedScreen } from './PushedScreen'
import { chunkRanges, isRecentlyReleased } from './helpers'

const RANGE_SIZE = 50
const STATUS_LABEL: Record<LibraryStatus, string> = {
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
  plan_to_watch: 'Plan to Watch',
  reading: 'Reading',
  plan_to_read: 'Plan to Read',
}
const ANIME_STATUSES: LibraryStatus[] = ['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch']

const isAiring = (s?: string) =>
  !!s && ['releasing', 'ongoing', 'airing', 'currently airing'].includes(s.toLowerCase())

const hasWatched = (h?: WatchHistory) => !!h && (h.completed || h.progress_seconds > 0)

interface Props {
  media: SearchResult
  extensionId?: string
  isOpen: boolean
  onClose: () => void
  onMediaChange?: (media: SearchResult) => void
  onFeedbackChange?: () => void
}

type Sheet = null | 'library' | 'range' | 'row' | 'confirmDelete' | 'menu' | 'download'
interface Picker {
  episodes: Episode[]
}

export function MobileAnimeDetail({ media, extensionId, isOpen, onClose, onMediaChange, onFeedbackChange }: Props) {
  const navigate = useNavigate()
  const { getStatus, refresh: refreshMediaStatus } = useMediaStatusContext()
  const { isOnline } = useNetworkStatus()
  const downloadLocation = useSettingsStore((s) => s.downloadLocation)
  const streamingProvider = useSettingsStore((s) => s.streamingProvider)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const anikotoApiBaseUrl = useSettingsStore((s) => s.anikotoApiBaseUrl)
  const anikotoSiteBaseUrl = useSettingsStore((s) => s.anikotoSiteBaseUrl)
  const anikotoYotochanBaseUrl = useSettingsStore((s) => s.anikotoYotochanBaseUrl)

  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [usingCache, setUsingCache] = useState(false)
  const [inLibrary, setInLibrary] = useState(false)
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(null)
  const [isFavorite, setIsFavorite] = useState(false)
  const [isTracked, setIsTracked] = useState(false)
  const [autoDl, setAutoDl] = useState(false)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [feedback, setFeedback] = useState<'liked' | 'disliked' | null>(null)
  const [tags, setTags] = useState<LibraryTag[]>([])
  const [showTagSelector, setShowTagSelector] = useState(false)
  const tagButtonRef = useRef<HTMLButtonElement>(null)

  const [downloaded, setDownloaded] = useState<Set<number>>(new Set())
  const [history, setHistory] = useState<Map<string, WatchHistory>>(new Map())
  const [tab, setTab] = useState('overview')
  const [sheet, setSheet] = useState<Sheet>(null)
  const [rowEp, setRowEp] = useState<Episode | null>(null)
  const [rangeIdx, setRangeIdx] = useState(0)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  // enrichment
  const [characters, setCharacters] = useState<JikanCharacterEntry[] | null>(null)
  const [charsLoading, setCharsLoading] = useState(false)
  const [reviews, setReviews] = useState<JikanReview[] | null>(null)
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewHasMore, setReviewHasMore] = useState(true)
  const [reviewLoadingMore, setReviewLoadingMore] = useState(false)
  const [stats, setStats] = useState<JikanStatistics | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [recs, setRecs] = useState<RecommendationEntry[]>([])
  const loadedTabs = useRef<Set<string>>(new Set())

  // episode info sheet
  const [epInfo, setEpInfo] = useState<JikanEpisodeDetail | null>(null)
  const [epInfoLoading, setEpInfoLoading] = useState(false)

  // provider
  const [extId, setExtId] = useState<string | null>(null)
  const [providerMediaId, setProviderMediaId] = useState<string | null>(null)
  const [bridgeFailed, setBridgeFailed] = useState(false)
  const providerLabel = streamingProviderLabel(streamingProvider)
  const providerResolving = !!details && !bridgeFailed && (!extId || !providerMediaId)

  // download picker
  const [picker, setPicker] = useState<Picker | null>(null)
  const [choices, setChoices] = useState<DownloadSourceChoice[]>([])
  const [audioTab, setAudioTab] = useState<DownloadAudioTab>('sub')
  const [choiceKey, setChoiceKey] = useState('')
  const [subKey, setSubKey] = useState('off')
  const [pickerLoading, setPickerLoading] = useState(false)
  const [starting, setStarting] = useState(false)

  const { downloadingEpisodes } = useDownloadEvents({
    mediaId: media.id,
    onComplete: (d) => setDownloaded((p) => new Set(p).add(d.episode_number)),
  })

  const { src: coverSrc } = useProxiedImage(details?.cover_url || media.cover_url || '')

  // ---- reset on media change ----
  useEffect(() => {
    setTab('overview')
    setCharacters(null)
    setReviews(null)
    setReviewPage(1)
    setReviewHasMore(true)
    setStats(null)
    setFeedback(null)
    setRangeIdx(0)
    setSelecting(false)
    setSelected(new Set())
    loadedTabs.current = new Set()
  }, [media.id])

  // ---- details: cache first, then Jikan (same flow as MediaDetailModal) ----
  useEffect(() => {
    if (!isOpen) return
    let aborted = false
    ;(async () => {
      setError(null)
      setUsingCache(false)
      let hadCache = false
      try {
        const cached = await getCachedMediaDetails(media.id)
        if (!aborted && cached && cached.episodes.length > 0) {
          const m = cached.media
          setDetails({
            id: m.id,
            title: m.title,
            english_name: m.english_name,
            native_name: m.native_name,
            description: m.description,
            cover_url: m.cover_url,
            trailer_url: m.trailer_url,
            type: m.content_type,
            status: m.status,
            year: m.year,
            rating: m.rating,
            episode_count: m.episode_count,
            episode_duration: m.episode_duration,
            season: m.season_quarter && m.season_year ? { quarter: m.season_quarter, year: m.season_year } : undefined,
            aired_start: m.aired_start_year
              ? { year: m.aired_start_year, month: m.aired_start_month, date: m.aired_start_date }
              : undefined,
            genres: m.genres ? JSON.parse(m.genres) : [],
            episodes: cached.episodes.map((e) => ({ id: e.id, number: e.number, title: e.title, thumbnail: e.thumbnail_url })),
          })
          setLoading(false)
          hadCache = true
          const dl = new Set<number>()
          for (const e of cached.episodes) if (await isEpisodeDownloaded(media.id, e.number)) dl.add(e.number)
          if (!aborted) setDownloaded(dl)
        }
      } catch {
        /* cache miss */
      }
      if (!hadCache) setLoading(true)
      if (!isOnline && hadCache) {
        setUsingCache(true)
        return
      }
      try {
        const r = await jikanAnimeDetails(parseInt(media.id))
        if (aborted) return
        setDetails(r)
        setUsingCache(false)
        setLoading(false)
        try {
          const now = new Date().toISOString()
          const entry: MediaEntry = {
            id: r.id,
            extension_id: 'jikan',
            title: r.title,
            english_name: r.english_name,
            native_name: r.native_name,
            description: r.description,
            cover_url: r.cover_url,
            banner_url: r.cover_url,
            trailer_url: r.trailer_url,
            media_type: 'anime',
            content_type: r.type,
            status: r.status,
            year: r.year,
            rating: r.rating,
            episode_count: r.episode_count ?? r.episodes.length,
            episode_duration: r.episode_duration,
            season_quarter: r.season?.quarter,
            season_year: r.season?.year,
            aired_start_year: r.aired_start?.year,
            aired_start_month: r.aired_start?.month,
            aired_start_date: r.aired_start?.date,
            genres: r.genres ? JSON.stringify(r.genres) : undefined,
            created_at: now,
            updated_at: now,
          }
          await saveMediaDetails(entry)
          if (r.episodes.length > 0) {
            const eps: EpisodeEntry[] = r.episodes.map((e) => ({
              id: e.id,
              media_id: r.id,
              extension_id: 'jikan',
              number: e.number,
              title: e.title,
              description: undefined,
              thumbnail_url: e.thumbnail,
              aired_date: undefined,
              duration: undefined,
            }))
            await saveEpisodes(r.id, 'jikan', eps)
          }
        } catch (e) {
          console.error('Failed to save media/episode details:', e)
        }
        const dl = new Set<number>()
        for (const e of r.episodes) if (await isEpisodeDownloaded(media.id, e.number)) dl.add(e.number)
        if (!aborted) setDownloaded(dl)
      } catch (err) {
        if (aborted) return
        const msg = err instanceof Error ? err.message : 'Failed to load details'
        if (hadCache) setUsingCache(true)
        else {
          setError(msg)
          setLoading(false)
        }
      }
    })()
    return () => {
      aborted = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, media.id, reloadKey])

  // ---- provider resolution (identical to the modal) ----
  useEffect(() => {
    if (!details) return
    let cancelled = false
    setExtId(null)
    setProviderMediaId(null)
    setBridgeFailed(false)
    ;(async () => {
      try {
        const slugExt = slugProviderExtension(streamingProvider, {
          anikotoApiBaseUrl,
          anikotoSiteBaseUrl,
          anikotoYotochanBaseUrl,
        })
        if (slugExt) {
          const meta = await loadExtension(slugExt)
          if (cancelled) return
          setExtId(meta.id)
          const match = await resolveAnikotoSlug(
            {
              ...details,
              native_name: details.native_name || media.native_name,
              title_synonyms: Array.from(
                new Set(
                  [...(details.title_synonyms || []), ...(media.title_synonyms || []), media.native_name || ''].filter(
                    (v): v is string => Boolean(v)
                  )
                )
              ),
            },
            (q) => searchAnime(meta.id, q, 1)
          )
          if (cancelled) return
          if (match?.id) setProviderMediaId(match.id)
          else setBridgeFailed(true)
          return
        }
        const meta = extensionId ? { id: extensionId } : await loadExtension(ALLANIME_EXTENSION)
        if (cancelled) return
        setExtId(meta.id)
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
        if (id) setProviderMediaId(id)
        else setBridgeFailed(true)
      } catch {
        if (!cancelled) setBridgeFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [details, extensionId, media.id, streamingProvider, anikotoApiBaseUrl, anikotoSiteBaseUrl, anikotoYotochanBaseUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- library / feedback / tags ----
  useEffect(() => {
    if (!isOpen) return
    ;(async () => {
      try {
        const inLib = await isInLibrary(media.id)
        setInLibrary(inLib)
        const st = getStatus(media.id)
        setIsFavorite(st.isFavorite)
        setIsTracked(st.isTracked)
        setLibraryStatus(st.libraryStatus || null)
        if (inLib) {
          const fb = await getMediaFeedback(media.id)
          setFeedback(fb?.sentiment ?? null)
          const entry = await getLibraryEntry(media.id).catch(() => null)
          setAutoDl(entry?.auto_download ?? false)
          setTags(await getMediaTags(media.id).catch(() => []))
        } else {
          setAutoDl(false)
          setTags([])
        }
      } catch (e) {
        console.error('Failed to check library status:', e)
      }
    })()
  }, [isOpen, media.id, getStatus, inLibrary])

  // ---- post-completion recommendations ----
  useEffect(() => {
    if (!isOpen || libraryStatus !== 'completed') return setRecs([])
    getContentRecommendations(6)
      .then((r) => setRecs(r.filter((x) => x.media.id !== media.id)))
      .catch(() => {})
  }, [isOpen, libraryStatus, media.id])

  // ---- watch history ----
  useEffect(() => {
    if (!isOpen || !details) return
    const load = async () => {
      try {
        const all = await getBatchWatchProgress(media.id)
        setHistory(new Map(all.map((h) => [h.episode_id, h])))
      } catch (e) {
        console.error('Failed to load episode watch history:', e)
      }
    }
    load()
    const onVis = () => !document.hidden && load()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [isOpen, details, media.id])

  // ---- lazy enrichment ----
  useEffect(() => {
    if (!isOpen || !details || loadedTabs.current.has(tab)) return
    const malId = parseInt(media.id)
    if (tab === 'characters') {
      loadedTabs.current.add(tab)
      setCharsLoading(true)
      jikanAnimeCharacters(malId)
        .then(setCharacters)
        .catch(() => setCharacters([]))
        .finally(() => setCharsLoading(false))
    } else if (tab === 'reviews') {
      loadedTabs.current.add(tab)
      setReviewsLoading(true)
      jikanAnimeReviews(malId, 1)
        .then((d) => {
          setReviews(d)
          setReviewHasMore(d.length >= 10)
        })
        .catch(() => {
          setReviews([])
          setReviewHasMore(false)
        })
        .finally(() => setReviewsLoading(false))
    } else if (tab === 'overview') {
      loadedTabs.current.add(tab)
      setStatsLoading(true)
      jikanAnimeStatistics(malId)
        .then(setStats)
        .catch(() => setStats({} as JikanStatistics))
        .finally(() => setStatsLoading(false))
    }
  }, [tab, isOpen, details, media.id])

  const episodes = useMemo(() => details?.episodes ?? [], [details])
  const lastEp = useMemo(() => episodes.reduce((m, e) => Math.max(m, e.number), 0), [episodes])
  const ranges = useMemo(() => chunkRanges(episodes.length, RANGE_SIZE), [episodes.length])
  const range = ranges[Math.min(rangeIdx, Math.max(0, ranges.length - 1))]

  // jump to the range holding the first unwatched episode
  useEffect(() => {
    if (!details || history.size === 0) return
    const i = details.episodes.findIndex((e) => !history.get(e.id)?.completed)
    if (i >= 0) setRangeIdx(Math.floor(i / RANGE_SIZE))
  }, [history, details])

  useEffect(() => {
    if (details && episodes.length === 0 && tab === 'episodes') setTab('overview')
  }, [details, episodes.length, tab])

  if (!isOpen) return null

  // ---- derived ----
  const title = media.title
  const nextUnwatched = episodes.find((e) => !history.get(e.id)?.completed)
  const lastWatched = [...episodes].reverse().find((e) => hasWatched(history.get(e.id)))
  const resumeEp = nextUnwatched ?? episodes[0]
  const finished = episodes.length > 0 && !nextUnwatched
  const showNew =
    !!details &&
    isAiring(details.status) &&
    (isTracked || inLibrary) &&
    !!media.latest_episode &&
    (() => {
      const e = episodes.find((x) => x.number === media.latest_episode)
      return !!e && !hasWatched(history.get(e.id))
    })()
  const offlineEpisodes = isOnline ? episodes : episodes.filter((e) => downloaded.has(e.number))
  const pageEpisodes = (isOnline ? episodes.slice((range?.start ?? 1) - 1, range?.end ?? 0) : offlineEpisodes)
  const isUnavailable = (e: Episode) => !!e.aired && new Date(e.aired).getTime() > Date.now()

  // ---- actions (same commands as the modal) ----
  const watch = (episodeId: string) => {
    savePendingReturn('anime', media)
    navigate({ to: '/watch', search: { malId: media.id, episodeId } })
  }

  const cover = () => details?.cover_url || media.cover_url
  const coverMeta = () => ({
    metadata: { media_id: media.id, ...(cover() ? { thumbnail: cover(), image: cover() } : {}) },
  })

  const initTracking = async (status?: string) => {
    if (!details || episodes.length === 0) return
    try {
      const latest = episodes.reduce((m, e) => (e.number > m.number ? e : m))
      await initializeReleaseTrackingV2(media.id, extId || 'jikan', 'anime', episodes.length, latest.number, latest.id, status)
    } catch (e) {
      console.error('Failed to initialize release tracking:', e)
    }
  }

  const addToLib = async (status: LibraryStatus) => {
    setLibraryLoading(true)
    try {
      await addToLibrary(media.id, status)
      setInLibrary(true)
      setLibraryStatus(status)
      notifySuccess(media.title, `Added to "${STATUS_LABEL[status]}" list`, coverMeta())
      await initTracking(details?.status)
      refreshMediaStatus()
    } catch (e) {
      console.error('Failed to add to library:', e)
      notifyError('Library Error', `Failed to add "${media.title}" to library`, coverMeta())
    } finally {
      setLibraryLoading(false)
    }
  }

  const removeFromLib = async () => {
    setLibraryLoading(true)
    try {
      await removeFromLibrary(media.id)
      setInLibrary(false)
      setLibraryStatus(null)
      setIsFavorite(false)
      notifySuccess(media.title, 'Removed from your library', coverMeta())
      refreshMediaStatus()
    } catch (e) {
      console.error('Failed to remove from library:', e)
      notifyError('Library Error', `Failed to remove "${media.title}" from library`, coverMeta())
    } finally {
      setLibraryLoading(false)
    }
  }

  const favorite = async () => {
    if (!details) return
    try {
      if (!inLibrary) {
        await addToLibrary(media.id, 'plan_to_watch')
        setInLibrary(true)
        await initTracking(details.status)
      }
      const fav = await toggleFavorite(media.id)
      setIsFavorite(fav)
      notifySuccess(media.title, fav ? 'Added to your favorites' : 'Removed from your favorites', coverMeta())
      refreshMediaStatus()
    } catch (e) {
      console.error('Failed to toggle favorite:', e)
      notifyError('Favorites Error', `Failed to update favorites for "${media.title}"`)
    }
  }

  const toggleAutoDl = async () => {
    if (!inLibrary) return
    const next = !autoDl
    setAutoDl(next)
    try {
      await setAutoDownload(media.id, next)
      toastSuccess('Auto-download', next ? 'New episodes will download automatically.' : 'Auto-download disabled.')
    } catch (e) {
      console.error('Failed to update auto-download:', e)
      setAutoDl(!next)
      notifyError('Auto-download', 'Could not update auto-download setting.')
    }
  }

  const sendFeedback = async (s: 'liked' | 'disliked') => {
    const prev = feedback
    try {
      if (feedback === s) {
        setFeedback(null)
        await removeMediaFeedback(media.id)
      } else {
        setFeedback(s)
        await setMediaFeedback(media.id, s)
        toastSuccess('Feedback', 'Noted! This helps recommendations')
      }
      onFeedbackChange?.()
    } catch (e) {
      console.error('Failed to update feedback:', e)
      setFeedback(prev)
    }
  }

  const removeTag = async (tagId: number) => {
    try {
      await unassignLibraryTag(media.id, tagId)
      setTags((p) => p.filter((t) => t.id !== tagId))
    } catch {
      notifyError('Error', 'Failed to remove tag')
    }
  }

  const toggleWatched = async (e: Episode) => {
    const cur = history.get(e.id)
    try {
      if (hasWatched(cur)) {
        await saveWatchProgress(media.id, e.id, e.number, 0, undefined, false)
        setHistory((p) => {
          const n = new Map(p)
          n.delete(e.id)
          return n
        })
      } else {
        await saveWatchProgress(media.id, e.id, e.number, 1, 1, true)
        const now = new Date().toISOString()
        setHistory((p) =>
          new Map(p).set(e.id, {
            id: 0,
            media_id: media.id,
            episode_id: e.id,
            episode_number: e.number,
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

  const showEpInfo = async (e: Episode) => {
    setRowEp(e)
    setEpInfo(null)
    setEpInfoLoading(true)
    try {
      setEpInfo(await jikanAnimeEpisodeDetail(parseInt(media.id), e.number))
    } catch {
      /* basic info only */
    } finally {
      setEpInfoLoading(false)
    }
  }

  const deleteEpisode = async (n: number) => {
    try {
      await deleteEpisodeDownload(media.id, n)
      setDownloaded((p) => {
        const s = new Set(p)
        s.delete(n)
        return s
      })
      notifySuccess(media.title, `Episode ${n} download deleted`)
    } catch (e) {
      console.error('Failed to delete episode:', e)
      notifyError('Delete Failed', `Failed to delete "${media.title}" Episode ${n}`)
    }
  }

  const openPicker = async (eps: Episode[]) => {
    if (!details || !extId || !providerMediaId) {
      notifyError(
        'Download Failed',
        providerResolving
          ? `${providerLabel} is still resolving this anime. Try again in a moment.`
          : `Could not resolve anime on ${providerLabel}. Switch provider and try again.`
      )
      return
    }
    const eligible = eps.filter((e) => !downloaded.has(e.number) && !downloadingEpisodes.has(e.number))
    if (eligible.length === 0) {
      notifyInfo(details.title, 'Selected episodes are already downloaded or downloading', {
        source: 'download',
        metadata: { media_id: media.id },
      })
      return
    }
    setPicker({ episodes: eligible })
    setChoices([])
    setAudioTab('sub')
    setChoiceKey('')
    setSubKey('off')
    setSheet('download')
    setPickerLoading(true)
    try {
      const first = eligible[0]!
      const vs = await getVideoSources(extId, `${providerMediaId}::${first.number}`)
      if (!vs?.sources?.length) {
        notifyError('Download Failed', `No video sources found for Episode ${first.number}`)
        return setSheet(null)
      }
      const list = await buildDownloadSourceChoices(vs.sources, vs.subtitles || [])
      if (list.length === 0) {
        notifyError('Download Failed', `No downloadable variants found for Episode ${first.number}`)
        return setSheet(null)
      }
      const tabPick = choicesForAudioTab(list, 'sub').length > 0 ? 'sub' : 'dub'
      const def = choicesForAudioTab(list, tabPick)[0] || list[0]!
      setChoices(list)
      setAudioTab(tabPick)
      setChoiceKey(def.key)
      setSubKey(englishSub(def)?.key || 'off')
    } catch (e) {
      console.error('Failed to prepare download choices:', e)
      notifyError('Download Failed', 'Failed to prepare download choices')
      setSheet(null)
    } finally {
      setPickerLoading(false)
    }
  }

  const startDownloads = async () => {
    if (!picker || !details || !extId || !providerMediaId) return
    const chosen = choices.find((c) => c.key === choiceKey)
    if (!chosen) return notifyError('Download Failed', 'Choose a video source before downloading')
    const chosenSub = chosen.subtitles.find((s) => subtitleKey(s) === subKey)
    setStarting(true)
    try {
      let ok = 0
      let fail = 0
      let skipped = 0
      for (const ep of picker.episodes) {
        try {
          if (await isEpisodeDownloaded(media.id, ep.number)) {
            skipped++
            continue
          }
          const srcs = await getVideoSources(extId, `${providerMediaId}::${ep.number}`)
          const list = await buildDownloadSourceChoices(srcs.sources || [], srcs.subtitles || [])
          const choice = findMatchingDownloadChoice(list, chosen)
          if (!choice) {
            fail++
            continue
          }
          const sub = chosenSub ? findMatchingSubtitle(choice.subtitles, chosenSub) : undefined
          if (chosenSub && !sub) {
            fail++
            continue
          }
          const filename = `${details.title.replace(/[^a-z0-9]/gi, '_')}_EP${ep.number}_${audioTypeLabel(choice.audioType)}_${choice.quality}.otaku`
          await startDownload(
            media.id,
            ep.id,
            ep.number,
            choice.source.url,
            filename,
            downloadLocation || undefined,
            choice.source.referrer,
            sub?.url,
            sub?.label,
            sub?.language
          )
          ok++
        } catch (e) {
          console.error(`Failed to download episode ${ep.number}:`, e)
          fail++
        }
      }
      const meta = { source: 'download', metadata: { media_id: media.id } }
      if (ok > 0)
        notifySuccess(
          details.title,
          `Started downloading ${ok} episode${ok > 1 ? 's' : ''}${skipped ? ` (${skipped} already downloaded)` : ''}`,
          meta
        )
      else if (skipped > 0) notifyInfo(details.title, `All ${skipped} selected episodes are already downloaded`, meta)
      if (fail > 0) notifyError(details.title, `Failed to start ${fail} download${fail > 1 ? 's' : ''}`)
      setSheet(null)
      setPicker(null)
      exitSelect()
    } finally {
      setStarting(false)
    }
  }

  // ---- selection ----
  const exitSelect = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const toggleSel = (id: string) =>
    setSelected((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const startPress = (id: string) => {
    longPressed.current = false
    pressTimer.current = setTimeout(() => {
      longPressed.current = true
      setSelecting(true)
      setSelected((p) => new Set(p).add(id))
    }, 450)
  }
  const endPress = () => pressTimer.current && clearTimeout(pressTimer.current)
  const rowTap = (e: Episode) => {
    if (longPressed.current) return (longPressed.current = false)
    if (selecting) return toggleSel(e.id)
    if (isUnavailable(e)) return
    watch(e.id)
  }

  // ---- states ----
  if (loading) {
    return (
      <PushedScreen onClose={onClose} shareTitle={title}>
        <div className="animate-pulse" aria-busy="true" aria-label="Loading">
          <div className="h-[300px] bg-[var(--color-bg-secondary)]" />
          <div className="space-y-3 p-4">
            <div className="h-12 rounded-xl bg-[var(--color-bg-secondary)]" />
            <div className="h-7 w-2/3 rounded bg-[var(--color-bg-secondary)]" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-[var(--color-bg-secondary)]" />
            ))}
          </div>
        </div>
      </PushedScreen>
    )
  }

  if (error || !details) {
    return (
      <PushedScreen onClose={onClose}>
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-8 text-center">
          {isOnline ? (
            <AlertCircle className="h-12 w-12 text-red-500" aria-hidden="true" />
          ) : (
            <WifiOff className="h-12 w-12 text-amber-400" aria-hidden="true" />
          )}
          <h2 className="text-lg font-semibold">Couldn’t load this anime</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {isOnline ? error || 'Something went wrong.' : 'You’re offline and nothing is saved for this title.'}
          </p>
          <div className="mt-2 flex gap-3">
            <button className="btn btn-primary min-h-11 px-5" onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </button>
            <button className="btn min-h-11 px-5" onClick={onClose}>
              Go back
            </button>
          </div>
        </div>
      </PushedScreen>
    )
  }

  const label = 'text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--color-text-muted)]'
  const iconBtn = (on: boolean, cls = '') =>
    `flex h-11 w-11 items-center justify-center rounded-xl border transition-colors ${
      on ? cls : 'glass border-[var(--color-glass-border)] text-[var(--color-text-muted)]'
    }`
  const statusOk = details.status && details.status.toLowerCase() !== 'unknown' ? details.status : ''
  const epCount = details.episode_count || episodes.length

  const subs = choicesForAudioTab(choices, 'sub')
  const dubs = choicesForAudioTab(choices, 'dub')
  const activeAudio = choicesForAudioTab(choices, audioTab).length > 0 ? audioTab : subs.length > 0 ? 'sub' : 'dub'
  const visibleChoices = choicesForAudioTab(choices, activeAudio)
  const activeChoice = choices.find((c) => c.key === choiceKey)
  const subOptions = subtitleChoices(activeChoice?.subtitles || [])

  const primary = (() => {
    if (episodes.length === 0) return null
    const n = resumeEp
    const text = finished
      ? 'Watch again'
      : lastWatched
        ? `Continue EP ${n!.number}`
        : 'Watch Now'
    return { text, ep: finished ? episodes[0]! : n! }
  })()

  return (
    <PushedScreen onClose={onClose} shareTitle={title} onMenu={() => setSheet('menu')}>
      {/* Key art header */}
      <div className="relative h-[300px] overflow-hidden">
        {coverSrc && <img src={coverSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-primary)] via-[var(--color-bg-primary)]/70 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
          <h1 className="font-['Space_Grotesk',sans-serif] text-2xl font-extrabold leading-tight text-white">
            {details.english_name || details.title}
          </h1>
          {details.native_name && <p className="mt-0.5 text-sm text-white/60">{details.native_name}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {details.rating ? <span className="chip chip-gold">★ {details.rating.toFixed(1)}</span> : null}
            {details.type && <span className="chip">{details.type}</span>}
            {details.year ? <span className="chip">{details.year}</span> : null}
            {statusOk && (
              <span className={`chip ${isAiring(statusOk) ? 'chip-green' : ''}`}>{statusOk}</span>
            )}
            {epCount ? <span className="chip">{epCount} eps</span> : null}
            {showNew && <span className="chip chip-green">NEW EP {media.latest_episode}</span>}
          </div>
          {details.genres.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {details.genres.slice(0, 5).map((g) => (
                <span key={g} className="chip">{g}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Banners */}
      {usingCache && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
          <Database size={16} aria-hidden="true" />
          <span>
            Showing saved data — source unavailable.
            <button className="ml-2 underline" onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </button>
          </span>
        </div>
      )}
      {!isOnline && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
          <WifiOff size={16} aria-hidden="true" />
          You’re offline. Only downloaded episodes are available.
        </div>
      )}
      {isOnline && bridgeFailed && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
          <AlertCircle size={16} className="shrink-0" aria-hidden="true" />
          <span className="flex-1">Couldn’t match this anime on {providerLabel}.</span>
          <button
            className="min-h-11 shrink-0 font-semibold underline"
            onClick={() => updateSettings({ streamingProvider: nextStreamingProvider(streamingProvider) })}
          >
            Try another provider
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3 px-4 pt-3">
        {primary && (
          <button
            onClick={() => watch(primary.ep.id)}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent-gradient)] text-sm font-semibold text-white"
          >
            <Play size={18} className="fill-current" aria-hidden="true" />
            {primary.text}
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSheet('library')}
            disabled={libraryLoading}
            className="glass flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--color-glass-border)] px-3.5 text-sm font-medium"
          >
            {libraryLoading ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : inLibrary ? (
              <Check size={16} aria-hidden="true" />
            ) : null}
            {inLibrary && libraryStatus ? STATUS_LABEL[libraryStatus] : 'Add to Library'}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <button
            onClick={favorite}
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            className={iconBtn(isFavorite, 'bg-[rgba(229,9,20,0.15)] text-[var(--color-accent-light)] border-[var(--color-accent-mid)]')}
          >
            <Heart size={20} className={isFavorite ? 'fill-current' : ''} aria-hidden="true" />
          </button>
          {isTracked && (
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-400/40 bg-indigo-500/15 text-indigo-300"
              role="img"
              aria-label="Tracking new episode releases"
            >
              <Bell size={20} aria-hidden="true" />
            </span>
          )}
          {inLibrary && (
            <>
              <button
                onClick={() => sendFeedback('liked')}
                aria-label={feedback === 'liked' ? 'Remove like' : 'Like this anime'}
                className={iconBtn(feedback === 'liked', 'bg-emerald-500 text-white border-emerald-400')}
              >
                <ThumbsUp size={20} className={feedback === 'liked' ? 'fill-current' : ''} aria-hidden="true" />
              </button>
              <button
                onClick={() => sendFeedback('disliked')}
                aria-label={feedback === 'disliked' ? 'Remove dislike' : 'Dislike this anime'}
                className={iconBtn(feedback === 'disliked', 'bg-red-500 text-white border-red-400')}
              >
                <ThumbsDown size={20} className={feedback === 'disliked' ? 'fill-current' : ''} aria-hidden="true" />
              </button>
              <button
                onClick={toggleAutoDl}
                aria-pressed={autoDl}
                aria-label="Auto-download new episodes"
                className={iconBtn(autoDl, 'bg-indigo-500/20 text-indigo-300 border-indigo-400/50')}
              >
                <DownloadCloud size={20} aria-hidden="true" />
              </button>
              <button
                ref={tagButtonRef}
                onClick={() => setShowTagSelector((v) => !v)}
                className="glass flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--color-glass-border)] px-3 text-sm text-[var(--color-text-muted)]"
              >
                <Tags size={16} aria-hidden="true" />
                {tags.length > 0 ? 'Tags' : 'Add Tags'}
              </button>
            </>
          )}
        </div>
        {inLibrary && tags.length > 0 && <TagChips tags={tags} onRemove={removeTag} />}
        <TagSelector
          mediaId={media.id}
          isOpen={showTagSelector}
          onClose={() => setShowTagSelector(false)}
          onTagsChange={() => getMediaTags(media.id).then(setTags).catch(() => {})}
          anchorRef={tagButtonRef}
        />
        {isAiring(details.status) && details.last_update_end && details.broadcast_interval && (
          <div className="flex items-center gap-2 rounded-xl bg-[var(--color-bg-secondary)] px-3 py-2.5">
            <Clock size={16} className="text-[var(--color-text-muted)]" aria-hidden="true" />
            <NextEpisodeCountdown
              latestEpisodeDate={media.latest_episode_date}
              lastUpdateEnd={details.last_update_end}
              broadcastInterval={details.broadcast_interval}
              status={details.status}
            />
          </div>
        )}
      </div>

      <div className="mt-3 px-4 pb-28">
        <DetailTabBar
          tabs={[
            { id: 'overview', label: 'Overview' },
            ...(episodes.length > 0 ? [{ id: 'episodes', label: 'Episodes', count: episodes.length }] : []),
            { id: 'characters', label: 'Characters' },
            { id: 'reviews', label: 'Reviews' },
          ]}
          activeTab={tab}
          onTabChange={setTab}
        />

        {tab === 'overview' && (
          <div className="mt-4">
            {details.description && (
              <Description
                content={details.description}
                className="mb-5 text-[0.9375rem] leading-[1.75] text-[var(--color-text-secondary)]"
              />
            )}
            <dl className="mb-5 grid grid-cols-2 gap-3">
              {(
                [
                  ['Type', details.type],
                  ['Episodes', epCount ? String(epCount) : ''],
                  ['Status', statusOk],
                  [
                    'Aired',
                    details.aired_start
                      ? `${details.aired_start.month && details.aired_start.date ? `${details.aired_start.month}/${details.aired_start.date}/` : ''}${details.aired_start.year}`
                      : '',
                  ],
                  ['Season', details.season ? `${details.season.quarter} ${details.season.year}` : ''],
                  ['Studio', details.studios?.map((s) => s.name).join(' / ') ?? ''],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className={`${label} mb-0.5`}>{k}</dt>
                    <dd className="text-sm font-medium">{v}</dd>
                  </div>
                ))}
            </dl>
            {(statsLoading || (stats && Object.keys(stats).length > 0)) && (
              <>
                <h3 className={`${label} mb-2`}>Scores</h3>
                <ScoreDistribution statistics={stats ?? {}} loading={statsLoading} mediaType="anime" />
              </>
            )}
          </div>
        )}

        {tab === 'episodes' && (
          <div className="mt-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="mr-auto text-base font-semibold">
                {isOnline ? `Episodes (${episodes.length})` : `Downloaded (${offlineEpisodes.length})`}
              </h2>
              {isOnline && ranges.length > 1 && range && (
                <button
                  onClick={() => setSheet('range')}
                  className="glass flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm"
                >
                  {range.label}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              )}
              <button
                onClick={() => (selecting ? exitSelect() : setSelecting(true))}
                className="glass min-h-11 rounded-xl px-3 text-sm"
              >
                {selecting ? 'Done' : 'Select'}
              </button>
            </div>
            {isOnline && (
              <button
                onClick={() => openPicker(episodes)}
                disabled={providerResolving}
                className="mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent-primary)] text-sm font-medium text-white disabled:opacity-50"
              >
                {providerResolving ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Download size={16} aria-hidden="true" />
                )}
                Download All
              </button>
            )}

            {pageEpisodes.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">
                {isOnline ? 'No episodes yet.' : 'No downloaded episodes. Reconnect to browse the rest.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {pageEpisodes.map((e) => {
                  const h = history.get(e.id)
                  const watched = !!h?.completed
                  const partial = !watched && (h?.progress_seconds ?? 0) > 0
                  const pct = h?.duration ? Math.min(100, (h.progress_seconds / h.duration) * 100) : 0
                  const dl = downloadingEpisodes.get(e.number)
                  const isDl = downloaded.has(e.number)
                  const unavailable = isUnavailable(e)
                  const isNew =
                    isAiring(details.status) &&
                    isRecentlyReleased(e.number, lastEp, undefined, details.last_update_end, details.broadcast_interval)
                  return (
                    <li
                      key={e.id}
                      className={`flex items-center gap-3 rounded-xl bg-[var(--color-bg-secondary)] p-2 ${
                        selected.has(e.id) ? 'ring-2 ring-[var(--color-accent-primary)]' : ''
                      } ${unavailable ? 'opacity-50' : ''}`}
                    >
                      {selecting && (
                        <span
                          aria-hidden="true"
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            selected.has(e.id)
                              ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]'
                              : 'border-[var(--color-text-muted)]'
                          }`}
                        >
                          {selected.has(e.id) && <Check size={12} />}
                        </span>
                      )}
                      <button
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        onClick={() => rowTap(e)}
                        onPointerDown={() => startPress(e.id)}
                        onPointerUp={endPress}
                        onPointerLeave={endPress}
                        onContextMenu={(ev) => ev.preventDefault()}
                      >
                        <span className="relative block h-[54px] w-24 shrink-0 overflow-hidden rounded-lg bg-black/40">
                          {e.thumbnail && (
                            <img src={e.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
                          )}
                          {(partial || watched) && (
                            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                              <span
                                className="block h-full bg-[var(--color-accent-primary)]"
                                style={{ width: `${watched ? 100 : pct}%` }}
                              />
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-[var(--color-text-muted)]">
                              EP {String(e.number).padStart(2, '0')}
                            </span>
                            {isNew && (
                              <span className="rounded bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                                NEW
                              </span>
                            )}
                            {watched && <CheckCircle size={14} className="text-blue-400" aria-label="Watched" />}
                            {isDl && <CheckCircle size={14} className="text-green-500" aria-label="Downloaded" />}
                          </span>
                          <span className="block truncate text-sm">{e.title || `Episode ${e.number}`}</span>
                          <span
                            className={`block truncate text-xs ${
                              dl?.status === 'failed' ? 'text-red-400' : 'text-[var(--color-text-muted)]'
                            }`}
                          >
                            {unavailable
                              ? `Not aired · ${new Date(e.aired!).toLocaleDateString()}`
                              : dl
                                ? dl.status === 'queued'
                                  ? 'Queued'
                                  : dl.status === 'failed'
                                    ? 'Download failed'
                                    : `Downloading ${Math.round(dl.total_bytes ? (dl.downloaded_bytes / dl.total_bytes) * 100 : 0)}%`
                                : partial
                                  ? `${Math.round(pct)}% watched`
                                  : ''}
                          </span>
                        </span>
                      </button>
                      {!selecting && (
                        <button
                          aria-label={`Episode ${e.number} actions`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--color-text-muted)]"
                          onClick={() => {
                            setRowEp(e)
                            setSheet('row')
                          }}
                        >
                          {dl && dl.status !== 'failed' ? (
                            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                          ) : (
                            <MoreVertical size={18} aria-hidden="true" />
                          )}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {!isOnline && episodes.length > offlineEpisodes.length && (
              <p className="mt-3 text-center text-sm text-[var(--color-text-muted)]">
                {episodes.length - offlineEpisodes.length} other episodes need a connection.
              </p>
            )}
          </div>
        )}

        {libraryStatus === 'completed' && recs.length > 0 && tab === 'overview' && (
          <div className="mt-5">
            <h3 className={`${label} mb-2`}>What to watch next</h3>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {recs.slice(0, 6).map((rec) => (
                <button
                  key={rec.media.id}
                  className="w-[100px] shrink-0 text-left"
                  onClick={() =>
                    onMediaChange?.({
                      id: rec.media.id,
                      title: rec.media.title,
                      cover_url: rec.media.cover_url || '',
                      year: rec.media.year,
                      status: rec.media.status,
                    })
                  }
                >
                  <span className="block aspect-[2/3] overflow-hidden rounded-lg bg-[var(--color-bg-secondary)]">
                    {rec.media.cover_url && (
                      <img src={rec.media.cover_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug">{rec.media.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'characters' && (
          <div className="mt-4">
            <CharacterGrid characters={characters || []} loading={charsLoading || !characters} />
          </div>
        )}

        {tab === 'reviews' && (
          <div className="mt-4">
            <ReviewList
              reviews={reviews || []}
              loading={reviewsLoading || !reviews}
              hasMore={reviewHasMore}
              loadingMore={reviewLoadingMore}
              onLoadMore={async () => {
                if (reviewLoadingMore || !reviewHasMore) return
                setReviewLoadingMore(true)
                try {
                  const next = reviewPage + 1
                  const more = await jikanAnimeReviews(parseInt(media.id), next)
                  setReviews((p) => [...(p || []), ...more])
                  setReviewPage(next)
                  setReviewHasMore(more.length >= 10)
                } catch {
                  setReviewHasMore(false)
                } finally {
                  setReviewLoadingMore(false)
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Pinned bulk bar */}
      {selecting && (
        <div
          className="fixed inset-x-0 bottom-0 z-[210] flex items-center gap-3 border-t border-[var(--color-glass-border)] bg-[var(--color-bg-secondary)] px-4 pt-3"
          style={{ paddingBottom: 'calc(var(--sab) + 12px)' }}
        >
          <span className="mr-auto text-sm font-medium">{selected.size} selected</span>
          <button
            className="min-h-11 px-2 text-sm text-[var(--color-text-secondary)]"
            onClick={() =>
              setSelected(selected.size === pageEpisodes.length ? new Set() : new Set(pageEpisodes.map((e) => e.id)))
            }
          >
            Select all
          </button>
          <button
            disabled={selected.size === 0 || !isOnline}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-accent-primary)] px-5 text-sm font-semibold text-white disabled:opacity-40"
            onClick={() => openPicker(episodes.filter((e) => selected.has(e.id)))}
          >
            <Download size={16} aria-hidden="true" /> Download
          </button>
          <button aria-label="Cancel selection" className="flex h-11 w-11 items-center justify-center" onClick={exitSelect}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Library status sheet */}
      <BottomSheet isOpen={sheet === 'library'} onClose={() => setSheet(null)} title={inLibrary ? 'Library' : 'Add to Library'}>
        {ANIME_STATUSES.map((s) => (
          <SheetOption
            key={s}
            checked={inLibrary ? libraryStatus === s : undefined}
            onClick={() => {
              setSheet(null)
              if (inLibrary && libraryStatus === s) return
              void addToLib(s)
            }}
          >
            {STATUS_LABEL[s]}
          </SheetOption>
        ))}
        {inLibrary && (
          <SheetOption
            destructive
            icon={<Trash2 size={18} />}
            onClick={() => {
              setSheet(null)
              void removeFromLib()
            }}
          >
            Remove from Library
          </SheetOption>
        )}
      </BottomSheet>

      {/* Range picker */}
      <BottomSheet isOpen={sheet === 'range'} onClose={() => setSheet(null)} title="Episode range">
        {ranges.map((r, i) => (
          <SheetOption
            key={r.label}
            checked={i === rangeIdx}
            onClick={() => {
              setRangeIdx(i)
              setSheet(null)
            }}
          >
            {r.label}
          </SheetOption>
        ))}
      </BottomSheet>

      {/* Episode row actions */}
      <BottomSheet
        isOpen={sheet === 'row' && !!rowEp}
        onClose={() => setSheet(null)}
        title={rowEp ? `EP ${rowEp.number}${rowEp.title ? ` · ${rowEp.title}` : ''}` : ''}
      >
        {rowEp && (
          <>
            <SheetOption
              icon={<Play size={18} />}
              disabled={isUnavailable(rowEp)}
              onClick={() => {
                setSheet(null)
                watch(rowEp.id)
              }}
            >
              Watch EP {rowEp.number}
            </SheetOption>
            {downloaded.has(rowEp.number) ? (
              <SheetOption destructive icon={<Trash2 size={18} />} onClick={() => setSheet('confirmDelete')}>
                Delete download
              </SheetOption>
            ) : (
              <SheetOption
                icon={<Download size={18} />}
                disabled={!isOnline || isUnavailable(rowEp)}
                onClick={() => void openPicker([rowEp])}
              >
                Download episode
              </SheetOption>
            )}
            <SheetOption
              icon={<Check size={18} />}
              onClick={() => {
                setSheet(null)
                void toggleWatched(rowEp)
              }}
            >
              {hasWatched(history.get(rowEp.id)) ? 'Mark as unwatched' : 'Mark as watched'}
            </SheetOption>
            <SheetOption
              icon={<Sparkles size={18} />}
              disabled={!isOnline}
              onClick={() => {
                const e = rowEp
                setSheet(null)
                void showEpInfo(e)
              }}
            >
              Episode info
            </SheetOption>
          </>
        )}
      </BottomSheet>

      {/* Episode info */}
      <BottomSheet
        isOpen={epInfoLoading || !!epInfo}
        onClose={() => {
          setEpInfo(null)
          setEpInfoLoading(false)
        }}
        title={rowEp ? `EP ${rowEp.number}${epInfo?.title ? ` · ${epInfo.title}` : ''}` : ''}
      >
        <div className="px-4 py-3 text-sm">
          {epInfoLoading ? (
            <span className="flex items-center gap-2 text-[var(--color-text-muted)]">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading episode info…
            </span>
          ) : epInfo?.synopsis ? (
            <p className="leading-relaxed text-[var(--color-text-secondary)]">{epInfo.synopsis}</p>
          ) : (
            <p className="italic text-[var(--color-text-muted)]">No synopsis available.</p>
          )}
        </div>
      </BottomSheet>

      <BottomSheet
        isOpen={sheet === 'confirmDelete'}
        onClose={() => setSheet(null)}
        title={rowEp ? `Delete EP ${rowEp.number}?` : ''}
        footer={
          <>
            <button className="btn min-h-11 flex-1" onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button
              className="btn min-h-11 flex-1 bg-[var(--color-accent-primary)] text-white"
              onClick={() => {
                setSheet(null)
                if (rowEp) void deleteEpisode(rowEp.number)
              }}
            >
              Delete download
            </button>
          </>
        }
      >
        <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          Remove the saved file for {details.title} EP {rowEp?.number} from this phone. You can download it again later.
        </p>
      </BottomSheet>

      {/* Download picker */}
      <BottomSheet
        isOpen={sheet === 'download'}
        onClose={() => !starting && setSheet(null)}
        title={picker ? `Download ${picker.episodes.length} episode${picker.episodes.length > 1 ? 's' : ''}` : ''}
        footer={
          <>
            <button className="btn min-h-11 flex-1" disabled={starting} onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary min-h-11 flex-1 disabled:opacity-40"
              disabled={pickerLoading || starting || !activeChoice}
              onClick={() => void startDownloads()}
            >
              {starting ? 'Starting…' : 'Download'}
            </button>
          </>
        }
      >
        {pickerLoading ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-[var(--color-text-muted)]">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Finding sources on {providerLabel}…
          </p>
        ) : (
          <div className="pb-2">
            {subs.length > 0 && dubs.length > 0 && (
              <div className="flex gap-2 px-4 pb-2">
                {(['sub', 'dub'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setAudioTab(t)
                      const c = choicesForAudioTab(choices, t)[0]
                      if (c) {
                        setChoiceKey(c.key)
                        setSubKey(englishSub(c)?.key || 'off')
                      }
                    }}
                    className={`min-h-11 flex-1 rounded-xl text-sm font-medium ${
                      activeAudio === t ? 'bg-[var(--color-accent-primary)] text-white' : 'glass'
                    }`}
                  >
                    {t === 'sub' ? 'Sub' : 'Dub'}
                  </button>
                ))}
              </div>
            )}
            {visibleChoices.map((c) => (
              <SheetOption
                key={c.key}
                checked={c.key === choiceKey}
                detail={c.server}
                onClick={() => {
                  setChoiceKey(c.key)
                  setSubKey(englishSub(c)?.key || 'off')
                }}
              >
                {c.quality} · {audioTypeLabel(c.audioType)}
              </SheetOption>
            ))}
            {subOptions.length > 1 && (
              <>
                <p className={`${label} px-4 pb-1 pt-3`}>Subtitles</p>
                {subOptions.map((o) => (
                  <SheetOption key={o.key} checked={o.key === subKey} onClick={() => setSubKey(o.key)}>
                    {o.label}
                  </SheetOption>
                ))}
              </>
            )}
          </div>
        )}
      </BottomSheet>

      {/* ⋯ menu */}
      <BottomSheet isOpen={sheet === 'menu'} onClose={() => setSheet(null)} title={title}>
        <SheetOption
          icon={<Check size={18} />}
          disabled={episodes.length === 0}
          onClick={() => {
            setSheet(null)
            setTab('episodes')
            setSelecting(true)
          }}
        >
          Select episodes
        </SheetOption>
        <SheetOption
          icon={<Loader2 size={18} />}
          onClick={() => {
            setSheet(null)
            setReloadKey((k) => k + 1)
          }}
        >
          Reload
        </SheetOption>
      </BottomSheet>
    </PushedScreen>
  )
}

function englishSub(choice: DownloadSourceChoice) {
  return subtitleChoices(choice.subtitles).find((o) => {
    const l = o.label.toLowerCase()
    return o.subtitle && (l.includes('english') || o.subtitle.language?.toLowerCase() === 'en')
  })
}
