/**
 * MangaDetailModal - Detailed information modal for manga
 *
 * Similar to MediaDetailModal but with manga-specific features:
 * - Chapter list instead of episodes
 * - "Read Now" / "Continue Reading" buttons
 * - Reading progress indicators
 */

import { useEffect, useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  X,
  BookOpen,
  Info,
  Heart,
  Check,
  Loader2,
  BookMarked,
  Download,
  CheckCircle,
  Trash2,
  Bell,
  Tags,
} from 'lucide-react'
import {
  getMangaDetails,
  jikanMangaDetails,
  resolveAllanimeId,
  loadExtension,
  searchManga,
  saveMediaDetails,
  addToLibrary,
  removeFromLibrary,
  isInLibrary,
  toggleFavorite,
  getLatestReadingProgressForMedia,
  getBatchReadingProgress,
  saveReadingProgress,
  getChapterImages,
  startChapterDownload,
  isChapterDownloaded,
  deleteChapterDownload,
  initializeReleaseTracking,
  getMediaTags,
  unassignLibraryTag,
  type MediaEntry,
  type LibraryStatus,
  type LibraryTag,
  jikanMangaCharacters,
  jikanMangaStatistics,
  jikanMangaReviews,
  jikanMangaPictures,
  jikanMangaNews,
  jikanMangaRecommendations,
  type JikanCharacterEntry,
  type JikanStatistics,
  type JikanReview,
  type JikanPicture,
  type JikanNews,
} from '@/utils/tauri-commands'
import { ALLANIME_MANGA_EXTENSION } from '@/extensions/allanime-manga-extension'
import { savePendingReturn } from '@/utils/return-media'
import { TagSelector, TagChips } from '@/components/library'
import { Description } from '@/components/ui/Description'
import { useSettingsStore } from '@/store/settingsStore'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import { useChapterDownloadEvents } from '@/hooks/useChapterDownloadEvents'
import { hasNsfwGenres } from '@/utils/nsfw-filter'
import type { SearchResult, MangaDetails, Chapter } from '@/types/extension'
import { notifySuccess, notifyError, notifyInfo } from '@/utils/notify'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { isMobile } from '@/utils/platform'
import { DetailTabBar } from './DetailTabBar'
import { CharacterGrid } from './CharacterGrid'
import { ScoreDistribution } from './ScoreDistribution'
import { ReviewList } from './ReviewCard'
import { GalleryGrid } from './GalleryGrid'
import { NewsList } from './NewsCard'
import { LibraryDropdown } from './LibraryDropdown'

/** MAL IDs are purely numeric; AllAnime IDs contain letters/hyphens */
function isMalId(id: string): boolean {
  return /^\d+$/.test(id)
}

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Returns true if the chapter/episode was released within the last 3 days.
 * Uses releaseDate if available on the chapter, otherwise back-calculates
 * from the last-update-end timestamp and broadcast interval.
 */
function isChapterRecentlyReleased(
  chNumber: number,
  lastChNumber: number,
  releaseDate: string | undefined,
  lastUpdateEnd: string | undefined,
  broadcastInterval: number | undefined
): boolean {
  if (releaseDate) {
    const age = Date.now() - new Date(releaseDate).getTime()
    return age >= 0 && age <= THREE_DAYS_MS
  }
  if (!lastUpdateEnd || !broadcastInterval) return false
  const lastMs = new Date(lastUpdateEnd).getTime()
  if (isNaN(lastMs)) return false
  const chAirMs = lastMs - (lastChNumber - chNumber) * broadcastInterval
  const age = Date.now() - chAirMs
  return age >= 0 && age <= THREE_DAYS_MS
}

const CHAPTERS_PER_PAGE = 50

interface MangaDetailModalProps {
  manga: SearchResult | null
  extensionId?: string
  onClose: () => void
}

export function MangaDetailModal({ manga, extensionId = '', onClose }: MangaDetailModalProps) {
  const navigate = useNavigate()
  const maxConcurrentDownloads = useSettingsStore((state) => state.maxConcurrentDownloads)
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const customDownloadLocation = useSettingsStore((state) => state.downloadLocation)
  const { getStatus, refresh: refreshMediaStatus } = useMediaStatusContext()
  const [details, setDetails] = useState<MangaDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inLibrary, setInLibrary] = useState(false)
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(null)
  const [isFavorite, setIsFavorite] = useState(false)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [isTracked, setIsTracked] = useState(false)
  const [chapterPage, setChapterPage] = useState(0)
  const [readingProgress, setReadingProgress] = useState<{
    chapterId: string
    chapterNumber: number
    page: number
  } | null>(null)
  const [downloadedChapters, setDownloadedChapters] = useState<Set<string>>(new Set())
  const [chapterReadSet, setChapterReadSet] = useState<Set<string>>(new Set())
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const [isNsfwBlocked, setIsNsfwBlocked] = useState(false)
  // Enrichment tab state
  const [activeTab, setActiveTab] = useState('overview')
  const [characters, setCharacters] = useState<JikanCharacterEntry[] | null>(null)
  const [charactersLoading, setCharactersLoading] = useState(false)
  const [statistics, setStatistics] = useState<JikanStatistics | null>(null)
  const [statisticsLoading, setStatisticsLoading] = useState(false)
  const [mangaReviews, setMangaReviews] = useState<JikanReview[] | null>(null)
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [mangaPictures, setMangaPictures] = useState<JikanPicture[] | null>(null)
  const [picturesLoading, setPicturesLoading] = useState(false)
  const [mangaNews, setMangaNews] = useState<JikanNews[] | null>(null)
  const [newsLoading, setNewsLoading] = useState(false)
  const [recommendations, setRecommendations] = useState<SearchResult[] | null>(null)
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const loadedTabsRef = useRef<Set<string>>(new Set())

  // Hybrid Jikan + AllAnime state
  const [allanimeExtId, setAllanimeExtId] = useState<string | null>(null)
  const [allanimeShowId, setAllanimeShowId] = useState<string | null>(null)
  const [allanimeChapters, setAllanimeChapters] = useState<Chapter[]>([])
  const [chaptersLoading, setChaptersLoading] = useState(false)

  // Determine if this manga was sourced from Jikan (MAL ID) vs AllAnime
  const malIdMode = manga ? isMalId(manga.id) : false

  // Tag state
  const [mediaTags, setMediaTags] = useState<LibraryTag[]>([])
  const [showTagSelector, setShowTagSelector] = useState(false)
  const tagButtonRef = useRef<HTMLButtonElement>(null)

  // Use event-based download tracking instead of polling
  // Note: Toast notifications are handled globally by the notification system
  const { downloadingChapters } = useChapterDownloadEvents({
    mediaId: manga?.id,
    onComplete: (download) => {
      // Add to downloaded chapters when a download completes
      setDownloadedChapters((prev) => new Set(prev).add(download.chapter_id))
    },
  })

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Lazy-load AllAnime extension (needed for chapter fetching in MAL ID flow)
  useEffect(() => {
    loadExtension(ALLANIME_MANGA_EXTENSION)
      .then((meta) => setAllanimeExtId(meta.id))
      .catch(() => {})
  }, [])

  // Load manga details — branches on MAL ID vs AllAnime ID
  useEffect(() => {
    if (!manga) return

    const loadDetails = async () => {
      setLoading(true)
      setError(null)

      try {
        let result: MangaDetails

        if (isMalId(manga.id)) {
          // MAL ID flow: use Jikan for metadata
          result = await jikanMangaDetails(parseInt(manga.id))
        } else {
          // AllAnime ID flow: existing behavior
          result = await getMangaDetails(extensionId, manga.id, !nsfwFilter)
        }

        setDetails(result)

        // Check if content is NSFW and should be blocked
        if (nsfwFilter) {
          setIsNsfwBlocked(hasNsfwGenres(result.genres))
        } else {
          setIsNsfwBlocked(false)
        }

        // Save to database for library (use manga.id as tracking ID)
        try {
          const mediaEntry: MediaEntry = {
            id: manga.id,
            extension_id: isMalId(manga.id) ? 'jikan' : extensionId,
            title: result.title,
            english_name: result.english_name,
            native_name: result.native_name,
            description: result.description,
            cover_url: result.cover_url,
            banner_url: result.cover_url,
            trailer_url: undefined,
            media_type: 'manga',
            content_type: result.type,
            status: result.status,
            year: result.year,
            rating: result.rating,
            episode_count: result.chapters.length,
            episode_duration: undefined,
            season_quarter: undefined,
            season_year: undefined,
            aired_start_year: undefined,
            aired_start_month: undefined,
            aired_start_date: undefined,
            genres: result.genres ? JSON.stringify(result.genres) : undefined,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          await saveMediaDetails(mediaEntry)
        } catch {
          // Non-fatal error
        }

        // Check library status and media status
        try {
          const inLib = await isInLibrary(manga.id)
          setInLibrary(inLib)

          const mediaStatus = getStatus(manga.id)
          setIsFavorite(mediaStatus.isFavorite)
          setIsTracked(mediaStatus.isTracked)
          setLibraryStatus(mediaStatus.libraryStatus || null)

          if (inLib) {
            try {
              const tags = await getMediaTags(manga.id)
              setMediaTags(tags)
            } catch {
              // Ignore tag loading errors
            }
          }
        } catch {
          // Ignore
        }

        // Check reading progress
        try {
          const progress = await getLatestReadingProgressForMedia(manga.id)
          if (progress) {
            setReadingProgress({
              chapterId: progress.chapter_id,
              chapterNumber: progress.chapter_number,
              page: progress.current_page,
            })
          }
        } catch {
          // Ignore
        }

        // Load batch reading history for per-chapter read indicators
        try {
          const history = await getBatchReadingProgress(manga.id)
          setChapterReadSet(new Set(history.filter((h) => h.completed).map((h) => h.chapter_id)))
        } catch {
          // Ignore
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load manga details')
      } finally {
        setLoading(false)
      }
    }

    loadDetails()
  }, [manga, extensionId, nsfwFilter, getStatus])

  // For MAL-sourced manga: resolve AllAnime ID with 2-step fallback
  useEffect(() => {
    if (!details || !manga || !isMalId(manga.id) || !allanimeExtId) return

    const resolveId = async () => {
      setChaptersLoading(true)
      try {
        // Step 1: Try bridge resolution (cached mappings)
        const bridgeId = await resolveAllanimeId(
          details.title,
          'manga',
          manga.id,
          details.english_name,
          details.year,
          details.title_synonyms,
          details.type,
          details.totalChapters,
          details.native_name
        )
        if (bridgeId) {
          setAllanimeShowId(bridgeId)
          return
        }

        // Step 2: Fallback — search AllAnime directly by title
        const searchResults = await searchManga(allanimeExtId, details.title, 1, true)
        if (searchResults.results.length > 0) {
          setAllanimeShowId(searchResults.results[0].id)
          return
        }
      } catch {
        // Both methods failed — chapters won't be available
      } finally {
        setChaptersLoading(false)
      }
    }
    resolveId()
  }, [details, manga, allanimeExtId])

  // Fetch AllAnime chapters after ID resolution (MAL flow only)
  useEffect(() => {
    if (!allanimeShowId || !allanimeExtId || !manga || !isMalId(manga.id)) return

    const fetchChapters = async () => {
      setChaptersLoading(true)
      try {
        const allanimeDetails = await getMangaDetails(allanimeExtId, allanimeShowId, true)
        if (allanimeDetails.chapters) {
          allanimeDetails.chapters.sort((a, b) => a.number - b.number)
          setAllanimeChapters(allanimeDetails.chapters)
        }
      } catch (err) {
        console.error('[MangaDetailModal] Failed to fetch AllAnime chapters:', err)
      } finally {
        setChaptersLoading(false)
      }
    }
    fetchChapters()
  }, [allanimeShowId, allanimeExtId, manga])

  // Backward compat: check reading progress under AllAnime ID if not found under MAL ID
  useEffect(() => {
    if (!allanimeShowId || !manga || !isMalId(manga.id) || readingProgress) return

    const checkLegacyProgress = async () => {
      try {
        const progress = await getLatestReadingProgressForMedia(allanimeShowId)
        if (progress) {
          setReadingProgress({
            chapterId: progress.chapter_id,
            chapterNumber: progress.chapter_number,
            page: progress.current_page,
          })
        }
      } catch {
        // Ignore
      }
    }
    checkLegacyProgress()
  }, [allanimeShowId, manga, readingProgress])

  // Effective chapters: AllAnime chapters for MAL flow, details.chapters for AllAnime flow
  const effectiveChapters = malIdMode ? allanimeChapters : details?.chapters || []
  // Effective extension ID for content operations (reading, downloads)
  const effectiveExtId = malIdMode ? allanimeExtId || extensionId : extensionId

  // Auto-navigate to page containing latest read chapter
  useEffect(() => {
    if (!readingProgress || effectiveChapters.length === 0) return
    const chapterIndex = effectiveChapters.findIndex((ch) => ch.id === readingProgress.chapterId)
    if (chapterIndex >= 0) {
      setChapterPage(Math.floor(chapterIndex / CHAPTERS_PER_PAGE))
    }
  }, [readingProgress, effectiveChapters])

  // Check which chapters are downloaded
  useEffect(() => {
    if (!manga || effectiveChapters.length === 0) return

    const checkDownloads = async () => {
      const downloaded = new Set<string>()
      for (const chapter of effectiveChapters) {
        try {
          const isDl = await isChapterDownloaded(manga.id, chapter.id)
          if (isDl) {
            downloaded.add(chapter.id)
          }
        } catch {
          // Ignore errors
        }
      }
      setDownloadedChapters(downloaded)
    }

    checkDownloads()
  }, [manga, effectiveChapters])

  // Reset enrichment state when manga changes
  useEffect(() => {
    setActiveTab('overview')
    setCharacters(null)
    setStatistics(null)
    setMangaReviews(null)
    setMangaPictures(null)
    setMangaNews(null)
    setRecommendations(null)
    loadedTabsRef.current = new Set()
  }, [manga?.id])

  // Lazy-load enrichment data when tab changes
  useEffect(() => {
    if (!manga || !details || !malIdMode) return
    if (loadedTabsRef.current.has(activeTab)) return

    const malId = parseInt(manga.id)

    if (activeTab === 'characters') {
      loadedTabsRef.current.add('characters')
      setCharactersLoading(true)
      jikanMangaCharacters(malId)
        .then(setCharacters)
        .catch(() => setCharacters([]))
        .finally(() => setCharactersLoading(false))
    } else if (activeTab === 'stats') {
      loadedTabsRef.current.add('stats')
      setStatisticsLoading(true)
      jikanMangaStatistics(malId)
        .then(setStatistics)
        .catch(() => setStatistics({} as JikanStatistics))
        .finally(() => setStatisticsLoading(false))
    } else if (activeTab === 'reviews') {
      loadedTabsRef.current.add('reviews')
      setReviewsLoading(true)
      jikanMangaReviews(malId, 1)
        .then(setMangaReviews)
        .catch(() => setMangaReviews([]))
        .finally(() => setReviewsLoading(false))
    } else if (activeTab === 'gallery') {
      loadedTabsRef.current.add('gallery')
      setPicturesLoading(true)
      jikanMangaPictures(malId)
        .then(setMangaPictures)
        .catch(() => setMangaPictures([]))
        .finally(() => setPicturesLoading(false))
    } else if (activeTab === 'news') {
      loadedTabsRef.current.add('news')
      setNewsLoading(true)
      jikanMangaNews(malId)
        .then(setMangaNews)
        .catch(() => setMangaNews([]))
        .finally(() => setNewsLoading(false))
    } else if (activeTab === 'recommendations') {
      loadedTabsRef.current.add('recommendations')
      setRecommendationsLoading(true)
      jikanMangaRecommendations(malId)
        .then((data) => setRecommendations(data.results))
        .catch(() => setRecommendations([]))
        .finally(() => setRecommendationsLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, manga?.id, details, malIdMode])

  if (!manga) return null

  // Tag functions
  const loadMediaTags = async () => {
    if (!manga) return
    try {
      const tags = await getMediaTags(manga.id)
      setMediaTags(tags)
    } catch (error) {
      console.error('Failed to load media tags:', error)
    }
  }

  const handleRemoveTag = async (tagId: number) => {
    if (!manga) return
    try {
      await unassignLibraryTag(manga.id, tagId)
      setMediaTags((prev) => prev.filter((t) => t.id !== tagId))
    } catch (error) {
      console.error('Failed to remove tag:', error)
      notifyError('Error', 'Failed to remove tag')
    }
  }

  const handleReadNow = (chapterId?: string) => {
    if (!details) return

    // Save manga so the modal can reopen when user navigates back
    savePendingReturn('manga', manga)

    if (malIdMode && allanimeShowId) {
      // MAL flow: AllAnime IDs for content, MAL ID for tracking
      navigate({
        to: '/read',
        search: {
          extensionId: effectiveExtId,
          mangaId: allanimeShowId,
          chapterId: chapterId || effectiveChapters[0]?.id,
          malId: manga!.id,
        },
      })
    } else {
      // AllAnime flow: existing behavior
      navigate({
        to: '/read',
        search: {
          extensionId,
          mangaId: manga!.id,
          chapterId: chapterId || details.chapters[0]?.id,
        },
      })
    }
    // Don't call onClose() - it triggers state updates that can interfere with navigation.
    // The modal will unmount when the route changes.
  }

  const handleContinueReading = () => {
    if (!readingProgress) return
    handleReadNow(readingProgress.chapterId)
  }

  const handleToggleChapterRead = async (e: React.MouseEvent, chapter: Chapter) => {
    e.stopPropagation()
    const mediaId = manga?.id
    if (!mediaId) return
    const isRead = chapterReadSet.has(chapter.id)
    try {
      if (isRead) {
        // Mark as unread: save with page 0, not completed
        await saveReadingProgress(mediaId, chapter.id, chapter.number, 0, undefined, false)
        setChapterReadSet((prev) => {
          const next = new Set(prev)
          next.delete(chapter.id)
          return next
        })
        // If this was the latest read chapter, clear/update readingProgress
        if (readingProgress?.chapterId === chapter.id) {
          setReadingProgress(null)
        }
      } else {
        // Mark as read: save with completed = true
        await saveReadingProgress(mediaId, chapter.id, chapter.number, 1, undefined, true)
        setChapterReadSet((prev) => new Set(prev).add(chapter.id))
        // Update latest reading progress if this is newer
        if (!readingProgress || chapter.number >= readingProgress.chapterNumber) {
          setReadingProgress({ chapterId: chapter.id, chapterNumber: chapter.number, page: 1 })
        }
      }
    } catch (err) {
      console.error('Failed to toggle chapter read state:', err)
    }
  }

  // Helper to ensure media is saved before library operations
  const ensureMediaSaved = async () => {
    if (!details || !manga) return false

    try {
      const mediaEntry: MediaEntry = {
        id: manga.id,
        extension_id: malIdMode ? 'jikan' : extensionId,
        title: details.title,
        english_name: details.english_name,
        native_name: details.native_name,
        description: details.description,
        cover_url: details.cover_url,
        banner_url: details.cover_url,
        trailer_url: undefined,
        media_type: 'manga',
        content_type: details.type,
        status: details.status,
        year: details.year,
        rating: details.rating,
        episode_count: effectiveChapters.length || details.chapters.length,
        episode_duration: undefined,
        season_quarter: undefined,
        season_year: undefined,
        aired_start_year: undefined,
        aired_start_month: undefined,
        aired_start_date: undefined,
        genres: details.genres ? JSON.stringify(details.genres) : undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      await saveMediaDetails(mediaEntry)
      return true
    } catch (err) {
      console.error('Failed to save media details:', err)
      return false
    }
  }

  const handleAddToLibrary = async (status: LibraryStatus) => {
    if (!details || !manga) return

    const statusLabels: Record<LibraryStatus, string> = {
      watching: 'Watching',
      completed: 'Completed',
      on_hold: 'On Hold',
      dropped: 'Dropped',
      plan_to_watch: 'Plan to Watch',
      reading: 'Reading',
      plan_to_read: 'Plan to Read',
    }

    setLibraryLoading(true)
    try {
      await ensureMediaSaved()
      await addToLibrary(manga.id, status)
      setInLibrary(true)
      setLibraryStatus(status)
      notifySuccess(details.title, `Added to "${statusLabels[status]}" list`)
      const chapterCount = effectiveChapters.length || details.chapters.length
      if (chapterCount > 0) {
        try {
          await initializeReleaseTracking(
            manga.id,
            malIdMode ? 'jikan' : extensionId,
            'manga',
            chapterCount
          )
        } catch (trackingError) {
          console.error('Failed to initialize release tracking:', trackingError)
        }
      }
      refreshMediaStatus()
    } catch (err) {
      notifyError('Library Error', `Failed to add "${details.title}" to library`)
      console.error(err)
    } finally {
      setLibraryLoading(false)
    }
  }

  const handleRemoveFromLibrary = async () => {
    if (!details || !manga) return

    setLibraryLoading(true)
    try {
      await removeFromLibrary(manga.id)
      setInLibrary(false)
      setLibraryStatus(null)
      setIsFavorite(false)
      notifySuccess(details.title, 'Removed from your library')
      refreshMediaStatus()
    } catch (err) {
      notifyError('Library Error', `Failed to remove "${details.title}" from library`)
      console.error(err)
    } finally {
      setLibraryLoading(false)
    }
  }

  const handleToggleFavorite = async () => {
    if (!details || !manga) return

    try {
      await ensureMediaSaved()

      if (!inLibrary) {
        await addToLibrary(manga.id, 'plan_to_read')
        setInLibrary(true)
        const chapterCount = effectiveChapters.length || details.chapters.length
        if (chapterCount > 0) {
          try {
            await initializeReleaseTracking(
              manga.id,
              malIdMode ? 'jikan' : extensionId,
              'manga',
              chapterCount
            )
          } catch (trackingError) {
            console.error('Failed to initialize release tracking:', trackingError)
          }
        }
      }
      const newFavorite = await toggleFavorite(manga.id)
      setIsFavorite(newFavorite)
      const notificationCover = details.cover_url || manga.cover_url
      notifySuccess(
        details.title,
        newFavorite ? 'Added to your favorites' : 'Removed from your favorites',
        {
          metadata: {
            media_id: manga.id,
            ...(notificationCover
              ? {
                  thumbnail: notificationCover,
                  image: notificationCover,
                }
              : {}),
          },
        }
      )
      refreshMediaStatus()
    } catch (err) {
      notifyError('Favorites Error', `Failed to update favorites for "${details.title}"`)
      console.error(err)
    }
  }

  // Handle chapter download
  const handleDownloadChapter = async (
    e: React.MouseEvent,
    chapter: { id: string; number: number }
  ) => {
    e.stopPropagation()
    if (!details || !manga) return

    try {
      const chapterImages = await getChapterImages(effectiveExtId, chapter.id)
      if (!chapterImages.images || chapterImages.images.length === 0) {
        throw new Error('No images found for this chapter')
      }

      const imageUrls = chapterImages.images.map((img) => img.url)
      await startChapterDownload(
        manga.id,
        details.title,
        chapter.id,
        chapter.number,
        imageUrls,
        customDownloadLocation || undefined
      )
    } catch (err) {
      console.error('Download failed:', err)
      notifyError(
        'Download Failed',
        `Failed to download "${details.title}" Chapter ${chapter.number}`
      )
    }
  }

  // Handle chapter download deletion
  const handleDeleteChapterDownload = async (
    e: React.MouseEvent,
    chapter: { id: string; number: number }
  ) => {
    e.stopPropagation()
    if (!details || !manga) return

    try {
      await deleteChapterDownload(manga.id, chapter.id)
      setDownloadedChapters((prev) => {
        const next = new Set(prev)
        next.delete(chapter.id)
        return next
      })
      notifySuccess(details.title, `Chapter ${chapter.number} download deleted`)
    } catch (err) {
      console.error('Delete failed:', err)
      notifyError(
        'Delete Failed',
        `Failed to delete "${details.title}" Chapter ${chapter.number} download`
      )
    }
  }

  // Download a single chapter - helper for concurrent downloads
  const downloadSingleChapter = async (chapter: Chapter): Promise<boolean> => {
    if (!details || !manga) return false

    try {
      const chapterImages = await getChapterImages(effectiveExtId, chapter.id)
      if (!chapterImages.images || chapterImages.images.length === 0) {
        throw new Error('No images found')
      }

      const imageUrls = chapterImages.images.map((img) => img.url)
      await startChapterDownload(
        manga.id,
        details.title,
        chapter.id,
        chapter.number,
        imageUrls,
        customDownloadLocation || undefined
      )
      return true
    } catch (err) {
      console.error(`Failed to download chapter ${chapter.number}:`, err)
      return false
    }
  }

  // Handle download all chapters - concurrent downloads
  const handleDownloadAllChapters = async () => {
    if (!details || isDownloadingAll) return

    const chaptersToDownload = effectiveChapters.filter((ch) => !downloadedChapters.has(ch.id))

    if (chaptersToDownload.length === 0) {
      notifyInfo(details.title, 'All chapters are already downloaded')
      return
    }

    setIsDownloadingAll(true)
    let successCount = 0
    let failCount = 0

    const concurrency = maxConcurrentDownloads || 3
    for (let i = 0; i < chaptersToDownload.length; i += concurrency) {
      const batch = chaptersToDownload.slice(i, i + concurrency)

      const results = await Promise.all(batch.map((chapter) => downloadSingleChapter(chapter)))

      results.forEach((success) => {
        if (success) {
          successCount++
        } else {
          failCount++
        }
      })
    }

    setIsDownloadingAll(false)

    if (failCount === 0) {
      notifySuccess(
        details.title,
        `Successfully downloaded ${successCount} chapter${successCount > 1 ? 's' : ''}`
      )
    } else {
      notifyError(
        details.title,
        `Downloaded ${successCount} chapter${successCount > 1 ? 's' : ''}, ${failCount} failed`
      )
    }
  }

  const totalChapterPages = Math.ceil(effectiveChapters.length / CHAPTERS_PER_PAGE)
  const paginatedChapters = effectiveChapters.slice(
    chapterPage * CHAPTERS_PER_PAGE,
    (chapterPage + 1) * CHAPTERS_PER_PAGE
  )

  const mobile = isMobile()

  const modalContent = (
    <>
      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="text-center py-12">
          {!mobile && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 bg-black/50 rounded-full hover:bg-black/70 transition-colors z-10"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          )}
          <Info className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-[var(--color-text-secondary)]">{error}</p>
        </div>
      )}

      {/* NSFW Content Blocked */}
      {!loading && !error && isNsfwBlocked && (
        <div className="text-center py-12">
          {!mobile && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 bg-black/50 rounded-full hover:bg-black/70 transition-colors z-10"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          )}
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
            <X className="w-8 h-8 text-red-500" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Content Blocked</h3>
          <p className="text-[var(--color-text-secondary)] max-w-md mx-auto mb-4">
            This manga contains adult content and has been blocked by your NSFW filter settings.
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            You can disable the NSFW filter in Settings to view this content.
          </p>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && details && !isNsfwBlocked && (
        <>
          {/* Banner */}
          <div className="relative h-[280px] overflow-hidden rounded-t-xl">
            {(details.cover_url || manga.cover_url) && (
              <img
                src={details.cover_url || manga.cover_url}
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
                {details.year && <span className="chip">{details.year}</span>}
                {details.rating && (
                  <span className="chip chip-gold">★ {details.rating.toFixed(2)}</span>
                )}
                {details.status && details.status.toLowerCase() !== 'unknown' && (
                  <span
                    className={`chip ${details.status.toLowerCase().includes('publishing') ? 'chip-green' : ''}`}
                  >
                    {details.status}
                  </span>
                )}
                {(effectiveChapters.length > 0 || details.totalChapters) && (
                  <span className="chip">
                    {effectiveChapters.length > 0
                      ? effectiveChapters.length
                      : details.totalChapters}{' '}
                    CH
                  </span>
                )}
                {details.volumes && <span className="chip">{details.volumes} VOL</span>}
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
            {/* Read / Continue Reading button */}
            {readingProgress ? (
              <button
                onClick={handleContinueReading}
                className="flex items-center gap-2 px-5 py-2.5 text-white font-semibold rounded-[var(--radius-md)] transition-all duration-150 bg-[var(--color-accent-gradient)] shadow-[0_0_20px_rgba(229,9,20,0.3)] hover:shadow-[0_0_30px_rgba(229,9,20,0.45)] whitespace-nowrap text-sm"
              >
                <BookOpen size={16} />
                <span>
                  Continue Ch. {readingProgress.chapterNumber} (p.{readingProgress.page})
                </span>
              </button>
            ) : (
              <button
                onClick={() => handleReadNow()}
                disabled={malIdMode && effectiveChapters.length === 0}
                className={`flex items-center gap-2 px-5 py-2.5 font-semibold rounded-[var(--radius-md)] transition-all duration-150 whitespace-nowrap text-sm ${
                  malIdMode && effectiveChapters.length === 0
                    ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] cursor-not-allowed'
                    : 'text-white bg-[var(--color-accent-gradient)] shadow-[0_0_20px_rgba(229,9,20,0.3)] hover:shadow-[0_0_30px_rgba(229,9,20,0.45)]'
                }`}
              >
                <BookOpen size={16} />
                <span>{chaptersLoading ? 'Loading...' : 'Start Reading'}</span>
              </button>
            )}

            {/* Library dropdown */}
            {(() => {
              let smartDisplayStatus = libraryStatus
              if (details && libraryStatus && readingProgress && effectiveChapters.length > 0) {
                const maxChapter = Math.max(...effectiveChapters.map((ch) => ch.number))
                if (readingProgress.chapterNumber < maxChapter && libraryStatus !== 'dropped') {
                  smartDisplayStatus = 'reading'
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
                  mediaType="manga"
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
              <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
            </button>

            {/* Release tracking indicator */}
            {isTracked && (
              <div
                className="flex items-center justify-center w-10 h-10 bg-indigo-500 text-white rounded-[var(--radius-md)] border border-indigo-400"
                title="Tracking new chapter releases"
              >
                <Bell size={18} />
              </div>
            )}

            {/* Tags */}
            {inLibrary && (
              <>
                <div className="w-px h-6 bg-[var(--color-glass-border)] mx-1" />
                <TagChips tags={mediaTags} onRemove={handleRemoveTag} />
                <div className="relative">
                  <button
                    ref={tagButtonRef}
                    onClick={() => setShowTagSelector(!showTagSelector)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium glass rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:text-white transition-colors"
                  >
                    <Tags size={14} />
                    <span>{mediaTags.length > 0 ? 'Tags' : 'Add Tags'}</span>
                  </button>
                  <TagSelector
                    mediaId={manga.id}
                    isOpen={showTagSelector}
                    onClose={() => setShowTagSelector(false)}
                    onTagsChange={loadMediaTags}
                    anchorRef={tagButtonRef}
                  />
                </div>
              </>
            )}
          </div>

          {/* Tab Content */}
          <div className="p-4 sm:p-8">
            {/* Detail Tabs (only for Jikan/MAL-sourced manga) */}
            {malIdMode && (
              <DetailTabBar
                tabs={[
                  { id: 'overview', label: 'Overview' },
                  {
                    id: 'chapters',
                    label: 'Chapters',
                    count: effectiveChapters.length || undefined,
                  },
                  { id: 'characters', label: 'Characters' },
                  { id: 'stats', label: 'Stats' },
                  { id: 'reviews', label: 'Reviews' },
                  { id: 'gallery', label: 'Gallery' },
                  { id: 'news', label: 'News' },
                  { id: 'recommendations', label: 'Recommendations' },
                ]}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
            )}

            <div className="mt-4">
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div>
                  {details.description && (
                    <Description
                      content={details.description}
                      className="text-[0.9375rem] leading-[1.75] text-[var(--color-text-secondary)] mb-5"
                    />
                  )}
                  {details.background && (
                    <div className="mb-5 p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-glass-border)]">
                      <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-1">
                        Background
                      </div>
                      <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                        {details.background}
                      </p>
                    </div>
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
                    {(effectiveChapters.length > 0 || details.totalChapters) && (
                      <div>
                        <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                          Chapters
                        </div>
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">
                          {effectiveChapters.length > 0
                            ? effectiveChapters.length
                            : details.totalChapters}
                          {details.totalChapters &&
                            effectiveChapters.length > 0 &&
                            effectiveChapters.length !== details.totalChapters && (
                              <span className="text-[var(--color-text-muted)] ml-1">
                                / {details.totalChapters}
                              </span>
                            )}
                        </div>
                      </div>
                    )}
                    {details.volumes && (
                      <div>
                        <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                          Volumes
                        </div>
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">
                          {details.volumes}
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
                    {details.year && (
                      <div>
                        <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                          Year
                        </div>
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">
                          {details.year}
                        </div>
                      </div>
                    )}
                    {details.rating && (
                      <div>
                        <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                          Score
                        </div>
                        <div className="text-sm font-medium text-yellow-400">
                          ★ {details.rating.toFixed(2)}
                        </div>
                      </div>
                    )}
                    {details.authors && details.authors.length > 0 && (
                      <div>
                        <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                          Authors
                        </div>
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">
                          {details.authors.join(', ')}
                        </div>
                      </div>
                    )}
                    {details.serializations && details.serializations.length > 0 && (
                      <div>
                        <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                          Serialization
                        </div>
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">
                          {details.serializations.join(', ')}
                        </div>
                      </div>
                    )}
                    {details.english_name && (
                      <div>
                        <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                          English
                        </div>
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">
                          {details.english_name}
                        </div>
                      </div>
                    )}
                    {details.native_name && (
                      <div>
                        <div className="text-[0.65rem] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.08em] mb-0.5">
                          Native
                        </div>
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">
                          {details.native_name}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Demographics & Themes as chips */}
                  {((details.demographics && details.demographics.length > 0) ||
                    (details.themes && details.themes.length > 0)) && (
                    <div className="flex flex-wrap gap-2">
                      {details.demographics?.map((d) => (
                        <span key={d} className="chip chip-accent">
                          {d}
                        </span>
                      ))}
                      {details.themes?.map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Chapters */}
              {activeTab === 'chapters' && (
                <div>
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
                    <h2 className="text-xl sm:text-2xl font-semibold flex items-center gap-2 border-l-[3px] border-[var(--color-accent-primary)] pl-3">
                      <BookMarked className="w-5 h-5 sm:w-6 sm:h-6 text-[var(--color-accent-primary)]" />
                      Chapters {effectiveChapters.length > 0 ? `(${effectiveChapters.length})` : ''}
                      {chaptersLoading && <Loader2 className="w-4 h-4 animate-spin inline ml-2" />}
                    </h2>
                    {effectiveChapters.length > 0 && (
                      <button
                        onClick={handleDownloadAllChapters}
                        disabled={
                          isDownloadingAll || downloadedChapters.size === effectiveChapters.length
                        }
                        className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                          downloadedChapters.size === effectiveChapters.length
                            ? 'bg-green-600 text-white cursor-default'
                            : isDownloadingAll
                              ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] cursor-wait'
                              : 'bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-secondary)] text-white'
                        }`}
                      >
                        {isDownloadingAll ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Downloading...
                          </>
                        ) : downloadedChapters.size === effectiveChapters.length ? (
                          <>
                            <CheckCircle className="w-4 h-4" />
                            All Downloaded
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4" />
                            Download All ({effectiveChapters.length - downloadedChapters.size})
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Chapters unavailable message (MAL flow, AllAnime resolution failed) */}
                  {malIdMode &&
                    !chaptersLoading &&
                    effectiveChapters.length === 0 &&
                    !allanimeShowId && (
                      <div className="text-center py-6 text-[var(--color-text-secondary)]">
                        <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">This manga is not available for reading yet.</p>
                        {details.totalChapters && (
                          <p className="text-xs text-[var(--color-text-muted)] mt-1">
                            {details.totalChapters} chapters on MyAnimeList
                          </p>
                        )}
                      </div>
                    )}

                  {effectiveChapters.length > 0 && (
                    <>
                      {/* Pagination controls */}
                      {effectiveChapters.length > CHAPTERS_PER_PAGE && (
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm text-[var(--color-text-muted)]">
                            {chapterPage * CHAPTERS_PER_PAGE + 1}–
                            {Math.min(
                              (chapterPage + 1) * CHAPTERS_PER_PAGE,
                              effectiveChapters.length
                            )}{' '}
                            of {effectiveChapters.length}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setChapterPage((p) => Math.max(0, p - 1))}
                              disabled={chapterPage === 0}
                              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors text-sm font-medium"
                            >
                              Prev
                            </button>
                            <span className="text-sm text-[var(--color-text-secondary)] tabular-nums">
                              {chapterPage + 1} / {totalChapterPages}
                            </span>
                            <button
                              onClick={() =>
                                setChapterPage((p) => Math.min(totalChapterPages - 1, p + 1))
                              }
                              disabled={chapterPage >= totalChapterPages - 1}
                              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors text-sm font-medium"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {paginatedChapters.map((chapter: Chapter) => {
                          const isDownloaded = downloadedChapters.has(chapter.id)
                          const isDownloading = downloadingChapters.has(chapter.id)

                          return (
                            <div
                              key={chapter.id}
                              className="relative p-3 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] rounded-lg transition-colors group"
                            >
                              <button
                                onClick={() => handleReadNow(chapter.id)}
                                className="w-full text-left"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-medium group-hover:text-[var(--color-accent-primary)]">
                                    Ch. {chapter.number}
                                  </span>
                                  {isDownloaded && (
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                                  )}
                                  {chapter.number > (readingProgress?.chapterNumber ?? 0) &&
                                    isChapterRecentlyReleased(
                                      chapter.number,
                                      effectiveChapters[effectiveChapters.length - 1]?.number ??
                                        chapter.number,
                                      chapter.releaseDate,
                                      details?.last_update_end,
                                      details?.broadcast_interval
                                    ) && (
                                      <span className="px-1.5 py-0.5 bg-emerald-500/90 rounded text-[10px] font-bold uppercase tracking-wide text-white">
                                        NEW
                                      </span>
                                    )}
                                </div>
                                {chapter.title && (
                                  <p className="text-xs text-[var(--color-text-muted)] truncate mt-1">
                                    {chapter.title}
                                  </p>
                                )}
                              </button>

                              {/* Download button */}
                              <button
                                onClick={(e) =>
                                  isDownloaded
                                    ? handleDeleteChapterDownload(e, chapter)
                                    : handleDownloadChapter(e, chapter)
                                }
                                disabled={isDownloading}
                                className={`absolute top-2 right-2 p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-all ${
                                  isDownloaded
                                    ? 'bg-green-600 hover:bg-red-600 text-white'
                                    : 'bg-[var(--color-bg-hover)] hover:bg-[var(--color-accent-primary)] text-[var(--color-text-secondary)] hover:text-white'
                                }`}
                                title={isDownloaded ? 'Delete download' : 'Download chapter'}
                              >
                                {isDownloading ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : isDownloaded ? (
                                  <Trash2 className="w-4 h-4" />
                                ) : (
                                  <Download className="w-4 h-4" />
                                )}
                              </button>

                              {/* Read toggle button */}
                              {chapterReadSet.has(chapter.id) ? (
                                <button
                                  onClick={(e) => handleToggleChapterRead(e, chapter)}
                                  className="absolute bottom-2 right-2 px-2 py-0.5 bg-blue-600/90 hover:bg-red-600/90 rounded text-[10px] font-bold flex items-center gap-1 transition-colors z-10"
                                  title="Click to mark as unread"
                                >
                                  <Check className="w-3 h-3" />
                                  Read
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => handleToggleChapterRead(e, chapter)}
                                  className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/60 hover:bg-blue-600 rounded text-[10px] font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all z-10"
                                  title="Mark as read"
                                >
                                  <Check className="w-3 h-3" />
                                  Read
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Characters Tab */}
              {activeTab === 'characters' && (
                <CharacterGrid
                  characters={characters || []}
                  loading={charactersLoading || !characters}
                />
              )}

              {/* Stats Tab */}
              {activeTab === 'stats' && (
                <ScoreDistribution
                  statistics={statistics || ({} as JikanStatistics)}
                  loading={statisticsLoading || !statistics}
                  mediaType="manga"
                />
              )}

              {/* Reviews Tab */}
              {activeTab === 'reviews' && (
                <ReviewList
                  reviews={mangaReviews || []}
                  loading={reviewsLoading || !mangaReviews}
                />
              )}

              {/* Gallery Tab */}
              {activeTab === 'gallery' && (
                <GalleryGrid
                  pictures={mangaPictures || []}
                  loading={picturesLoading || !mangaPictures}
                />
              )}

              {/* News Tab */}
              {activeTab === 'news' && (
                <NewsList news={mangaNews || []} loading={newsLoading || !mangaNews} />
              )}

              {/* Recommendations Tab */}
              {activeTab === 'recommendations' &&
                (recommendationsLoading || !recommendations ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {[...Array(6)].map((_, i) => (
                      <div
                        key={i}
                        className="aspect-[2/3] bg-[var(--color-bg-secondary)] rounded-lg animate-pulse"
                      />
                    ))}
                  </div>
                ) : recommendations.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {recommendations.map((rec) => (
                      <div
                        key={rec.id}
                        className="aspect-[2/3] rounded-lg overflow-hidden bg-[var(--color-bg-secondary)] relative group cursor-pointer"
                        onClick={() => {
                          // Could open this manga's detail modal
                        }}
                      >
                        {rec.cover_url && (
                          <img
                            src={rec.cover_url}
                            alt={rec.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                        <div className="absolute bottom-0 left-0 right-0 p-2">
                          <p className="text-xs font-medium text-white line-clamp-2">{rec.title}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center py-8 text-[var(--color-text-secondary)]">
                    No recommendations available
                  </p>
                ))}
            </div>
          </div>
        </>
      )}
    </>
  )

  if (mobile) {
    return (
      <BottomSheet isOpen={!!manga} onClose={onClose}>
        {modalContent}
      </BottomSheet>
    )
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto animate-in fade-in duration-300">
      <div
        className="fixed inset-0 bg-black/90 backdrop-blur-md animate-in fade-in duration-300"
        onClick={onClose}
      />
      <div className="relative min-h-screen flex items-start justify-center p-4 sm:p-6 lg:p-8">
        <div
          className="relative bg-[var(--color-bg-primary)] rounded-xl max-w-[1000px] w-full my-8 shadow-2xl animate-in slide-in-from-bottom-4 duration-500 border border-white/5"
          onClick={(e) => e.stopPropagation()}
        >
          {modalContent}
        </div>
      </div>
    </div>
  )
}
