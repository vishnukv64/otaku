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
  Plus,
  Check,
  Loader2,
  Library,
  BookMarked,
  Download,
  CheckCircle,
  Trash2,
  Bell,
  Tags,
} from 'lucide-react'
import { getMangaDetails, jikanMangaDetails, resolveAllanimeId, loadExtension, searchManga, saveMediaDetails, addToLibrary, removeFromLibrary, isInLibrary, toggleFavorite, getLatestReadingProgressForMedia, getChapterImages, startChapterDownload, isChapterDownloaded, deleteChapterDownload, initializeReleaseTracking, getMediaTags, unassignLibraryTag, type MediaEntry, type LibraryStatus, type LibraryTag } from '@/utils/tauri-commands'
import { ALLANIME_MANGA_EXTENSION } from '@/extensions/allanime-manga-extension'
import { TagSelector, TagChips } from '@/components/library'
import { Description } from '@/components/ui/Description'
import { useSettingsStore } from '@/store/settingsStore'
import { useMediaStatusContext, getStatusLabel } from '@/contexts/MediaStatusContext'
import { useChapterDownloadEvents } from '@/hooks/useChapterDownloadEvents'
import { hasNsfwGenres } from '@/utils/nsfw-filter'
import type { SearchResult, MangaDetails, Chapter } from '@/types/extension'
import { notifySuccess, notifyError, notifyInfo } from '@/utils/notify'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { isMobile } from '@/utils/platform'

/** MAL IDs are purely numeric; AllAnime IDs contain letters/hyphens */
function isMalId(id: string): boolean {
  return /^\d+$/.test(id)
}

const CHAPTERS_PER_PAGE = 50

interface MangaDetailModalProps {
  manga: SearchResult | null
  extensionId: string
  onClose: () => void
}

export function MangaDetailModal({ manga, extensionId, onClose }: MangaDetailModalProps) {
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
  const [isTracked, setIsTracked] = useState(false)
  const [chapterPage, setChapterPage] = useState(0)
  const [readingProgress, setReadingProgress] = useState<{ chapterId: string; chapterNumber: number; page: number } | null>(null)
  const [downloadedChapters, setDownloadedChapters] = useState<Set<string>>(new Set())
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const [isNsfwBlocked, setIsNsfwBlocked] = useState(false)
  const [showLibraryMenu, setShowLibraryMenu] = useState(false)

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
      setDownloadedChapters(prev => new Set(prev).add(download.chapter_id))
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
      .then(meta => setAllanimeExtId(meta.id))
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
          details.title, 'manga', manga.id, details.english_name, details.year, details.title_synonyms, details.type, details.totalChapters
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
  const effectiveChapters = malIdMode ? allanimeChapters : (details?.chapters || [])
  // Effective extension ID for content operations (reading, downloads)
  const effectiveExtId = malIdMode ? (allanimeExtId || extensionId) : extensionId

  // Auto-navigate to page containing latest read chapter
  useEffect(() => {
    if (!readingProgress || effectiveChapters.length === 0) return
    const chapterIndex = effectiveChapters.findIndex(ch => ch.id === readingProgress.chapterId)
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
      setMediaTags(prev => prev.filter(t => t.id !== tagId))
    } catch (error) {
      console.error('Failed to remove tag:', error)
      notifyError('Error', 'Failed to remove tag')
    }
  }

  const handleReadNow = (chapterId?: string) => {
    if (!details) return

    if (malIdMode && allanimeShowId) {
      // MAL flow: AllAnime IDs for content, MAL ID for tracking
      navigate({
        to: '/read',
        search: {
          extensionId: effectiveExtId,
          mangaId: allanimeShowId,
          chapterId: chapterId || (effectiveChapters[0]?.id),
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
          chapterId: chapterId || (details.chapters[0]?.id),
        },
      })
    }
    onClose()
  }

  const handleContinueReading = () => {
    if (!readingProgress) return
    handleReadNow(readingProgress.chapterId)
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

    try {
      await ensureMediaSaved()
      await addToLibrary(manga.id, status)
      setInLibrary(true)
      setLibraryStatus(status)
      notifySuccess(details.title, `Added to "${statusLabels[status]}" list`)
      const chapterCount = effectiveChapters.length || details.chapters.length
      if (chapterCount > 0) {
        try {
          await initializeReleaseTracking(manga.id, malIdMode ? 'jikan' : extensionId, 'manga', chapterCount)
        } catch (trackingError) {
          console.error('Failed to initialize release tracking:', trackingError)
        }
      }
      refreshMediaStatus()
    } catch (err) {
      notifyError('Library Error', `Failed to add "${details.title}" to library`)
      console.error(err)
    }
  }

  const handleRemoveFromLibrary = async () => {
    if (!details || !manga) return

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
            await initializeReleaseTracking(manga.id, malIdMode ? 'jikan' : extensionId, 'manga', chapterCount)
          } catch (trackingError) {
            console.error('Failed to initialize release tracking:', trackingError)
          }
        }
      }
      const newFavorite = await toggleFavorite(manga.id)
      setIsFavorite(newFavorite)
      notifySuccess(details.title, newFavorite ? 'Added to your favorites' : 'Removed from your favorites')
      refreshMediaStatus()
    } catch (err) {
      notifyError('Favorites Error', `Failed to update favorites for "${details.title}"`)
      console.error(err)
    }
  }

  // Handle chapter download
  const handleDownloadChapter = async (e: React.MouseEvent, chapter: { id: string; number: number }) => {
    e.stopPropagation()
    if (!details || !manga) return

    try {
      const chapterImages = await getChapterImages(effectiveExtId, chapter.id)
      if (!chapterImages.images || chapterImages.images.length === 0) {
        throw new Error('No images found for this chapter')
      }

      const imageUrls = chapterImages.images.map(img => img.url)
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
      notifyError('Download Failed', `Failed to download "${details.title}" Chapter ${chapter.number}`)
    }
  }

  // Handle chapter download deletion
  const handleDeleteChapterDownload = async (e: React.MouseEvent, chapter: { id: string; number: number }) => {
    e.stopPropagation()
    if (!details || !manga) return

    try {
      await deleteChapterDownload(manga.id, chapter.id)
      setDownloadedChapters(prev => {
        const next = new Set(prev)
        next.delete(chapter.id)
        return next
      })
      notifySuccess(details.title, `Chapter ${chapter.number} download deleted`)
    } catch (err) {
      console.error('Delete failed:', err)
      notifyError('Delete Failed', `Failed to delete "${details.title}" Chapter ${chapter.number} download`)
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

      const imageUrls = chapterImages.images.map(img => img.url)
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

    const chaptersToDownload = effectiveChapters.filter(ch => !downloadedChapters.has(ch.id))

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

      const results = await Promise.all(
        batch.map(chapter => downloadSingleChapter(chapter))
      )

      results.forEach(success => {
        if (success) {
          successCount++
        } else {
          failCount++
        }
      })
    }

    setIsDownloadingAll(false)

    if (failCount === 0) {
      notifySuccess(details.title, `Successfully downloaded ${successCount} chapter${successCount > 1 ? 's' : ''}`)
    } else {
      notifyError(details.title, `Downloaded ${successCount} chapter${successCount > 1 ? 's' : ''}, ${failCount} failed`)
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
          {/* Hero Banner */}
          <div className="relative rounded-t-xl overflow-hidden">
            {/* Background Image (blurred) */}
            {(details.cover_url || manga.cover_url) && (
              <>
                <img
                  src={details.cover_url || manga.cover_url}
                  alt={details.title}
                  className="absolute inset-0 w-full h-full object-cover blur-3xl scale-110 opacity-40"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-primary)] via-black/80 to-black/40" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
              </>
            )}

            {/* Close button (desktop only) */}
            {!mobile && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 bg-black/50 rounded-full hover:bg-black/70 transition-colors z-10"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            )}

            {/* Content */}
            <div className={`relative ${mobile ? 'p-5' : 'p-10'}`}>
              <div className={`${mobile ? 'flex flex-col items-center text-center gap-4' : 'flex gap-8 w-full items-start'}`}>
                {/* Poster */}
                {(details.cover_url || manga.cover_url) && (
                  <div className="relative flex-shrink-0 group">
                    <img
                      src={details.cover_url || manga.cover_url}
                      alt={details.title}
                      className={`object-cover rounded-xl shadow-2xl ring-1 ring-white/10 ${mobile ? 'w-full h-48' : 'w-48 sm:w-56 h-72 sm:h-80 transform group-hover:scale-105 transition-transform duration-300'}`}
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

                  {/* Metadata Row */}
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
                    {(effectiveChapters.length > 0 || details.totalChapters) && (
                      <>
                        <span className="text-[var(--color-text-muted)]">•</span>
                        <span className="text-white font-medium">
                          {effectiveChapters.length > 0 ? effectiveChapters.length : details.totalChapters} Chapters
                        </span>
                      </>
                    )}
                    {details.type && (
                      <>
                        <span className="text-[var(--color-text-muted)]">•</span>
                        <span className="text-white font-medium capitalize">{details.type}</span>
                      </>
                    )}
                  </div>

                  {/* Genres */}
                  {details.genres && details.genres.length > 0 && (
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
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    {/* Read / Continue Reading button */}
                    {readingProgress ? (
                      <button
                        onClick={handleContinueReading}
                        className="flex items-center gap-1.5 sm:gap-2 px-4 sm:px-8 py-2.5 sm:py-3.5 bg-[var(--color-accent-primary)] text-white font-bold rounded-lg hover:opacity-90 transition-all transform hover:scale-105 shadow-lg whitespace-nowrap text-sm sm:text-base"
                      >
                        <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
                        Continue Ch. {readingProgress.chapterNumber} (p.{readingProgress.page})
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReadNow()}
                        disabled={malIdMode && effectiveChapters.length === 0}
                        className={`flex items-center gap-1.5 sm:gap-2 px-4 sm:px-8 py-2.5 sm:py-3.5 font-bold rounded-lg transition-all shadow-lg whitespace-nowrap text-sm sm:text-base ${
                          malIdMode && effectiveChapters.length === 0
                            ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] cursor-not-allowed'
                            : 'bg-[var(--color-accent-primary)] text-white hover:opacity-90 transform hover:scale-105 shadow-[var(--color-accent-primary)]/50'
                        }`}
                      >
                        <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
                        {chaptersLoading ? 'Loading...' : 'Start Reading'}
                      </button>
                    )}

                    {/* Library button */}
                    {inLibrary ? (() => {
                      let displayStatus = libraryStatus
                      if (details && libraryStatus && readingProgress && effectiveChapters.length > 0) {
                        const maxChapter = Math.max(...effectiveChapters.map(ch => ch.number))
                        if (readingProgress.chapterNumber < maxChapter && libraryStatus !== 'dropped') {
                          displayStatus = 'reading'
                        }
                      }
                      return (
                        <button
                          key="in-library-btn"
                          onClick={handleRemoveFromLibrary}
                          className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-6 py-2.5 sm:py-3.5 font-bold rounded-lg transition-all border bg-green-600 text-white border-green-500 hover:bg-green-700 whitespace-nowrap text-sm sm:text-base"
                        >
                          <Check className="w-5 h-5" />
                          {displayStatus ? getStatusLabel(displayStatus) : 'In Library'}
                        </button>
                      )
                    })() : (
                      <div key="add-library-btn" className="relative">
                        <button
                          onClick={() => setShowLibraryMenu(!showLibraryMenu)}
                          className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-6 py-2.5 sm:py-3.5 font-bold rounded-lg transition-all border bg-white/10 backdrop-blur-sm text-white border-white/20 hover:bg-white/20 whitespace-nowrap text-sm sm:text-base"
                        >
                          <Plus className="w-5 h-5" />
                          My List
                        </button>
                        {showLibraryMenu && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowLibraryMenu(false)} />
                            <div className="absolute bottom-full left-0 mb-1 bg-[var(--color-bg-secondary)] rounded-lg shadow-xl z-20 min-w-[180px] border border-white/10">
                              <button
                                onClick={() => { handleAddToLibrary('reading'); setShowLibraryMenu(false) }}
                                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--color-bg-hover)] text-left text-sm rounded-t-lg"
                              >
                                <BookMarked className="w-4 h-4" />
                                Reading
                              </button>
                              <button
                                onClick={() => { handleAddToLibrary('plan_to_read'); setShowLibraryMenu(false) }}
                                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--color-bg-hover)] text-left text-sm"
                              >
                                <Library className="w-4 h-4" />
                                Plan to Read
                              </button>
                              <button
                                onClick={() => { handleAddToLibrary('completed'); setShowLibraryMenu(false) }}
                                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--color-bg-hover)] text-left text-sm rounded-b-lg"
                              >
                                <Check className="w-4 h-4" />
                                Completed
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Favorite button */}
                    <button
                      onClick={handleToggleFavorite}
                      className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg transition-all border ${
                        isFavorite
                          ? 'bg-red-500 text-white border-red-500 hover:bg-red-600'
                          : 'bg-white/10 backdrop-blur-sm text-white border-white/20 hover:bg-white/20'
                      }`}
                      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Heart className={`w-5 h-5 sm:w-6 sm:h-6 ${isFavorite ? 'fill-current' : ''}`} />
                    </button>

                    {/* Release tracking indicator */}
                    {isTracked && (
                      <div
                        className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-indigo-500 text-white rounded-lg transition-all border border-indigo-400"
                        title="Tracking new chapter releases"
                      >
                        <Bell className="w-5 h-5 sm:w-6 sm:h-6" />
                      </div>
                    )}
                  </div>

                  {/* Tags Section */}
                  {inLibrary && (
                    <div className="mt-4 flex items-center gap-3 flex-wrap">
                      <TagChips
                        tags={mediaTags}
                        onRemove={handleRemoveTag}
                      />
                      <div className="relative">
                        <button
                          ref={tagButtonRef}
                          onClick={() => setShowTagSelector(!showTagSelector)}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 rounded-full transition-colors border border-white/20"
                        >
                          <Tags className="w-4 h-4" />
                          <span>{mediaTags.length > 0 ? 'Edit Tags' : 'Add Tags'}</span>
                        </button>
                        <TagSelector
                          mediaId={manga.id}
                          isOpen={showTagSelector}
                          onClose={() => setShowTagSelector(false)}
                          onTagsChange={loadMediaTags}
                          anchorRef={tagButtonRef}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Description & Chapters */}
          <div className="p-4 sm:p-8">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg">
                <div className="text-[var(--color-text-muted)] text-sm mb-1">Score</div>
                <div className="text-2xl font-bold text-yellow-400">
                  {details.rating ? details.rating.toFixed(2) : 'N/A'}
                </div>
              </div>
              <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg">
                <div className="text-[var(--color-text-muted)] text-sm mb-1">Chapters</div>
                <div className="text-2xl font-bold">
                  {effectiveChapters.length > 0 ? effectiveChapters.length : (details.totalChapters || 'N/A')}
                  {details.totalChapters && effectiveChapters.length > 0 && effectiveChapters.length !== details.totalChapters && (
                    <span className="text-sm text-[var(--color-text-muted)] ml-1">/ {details.totalChapters}</span>
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
            </div>

            {/* Description */}
            {details.description && (
              <div className="mb-8">
                <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
                  <BookOpen className="w-6 h-6 text-[var(--color-accent-primary)]" />
                  Synopsis
                </h2>
                <Description content={details.description} className="text-lg" />
              </div>
            )}

            {/* Chapters */}
            <div>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
                <h2 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
                  <BookMarked className="w-5 h-5 sm:w-6 sm:h-6 text-[var(--color-accent-primary)]" />
                  Chapters {effectiveChapters.length > 0 ? `(${effectiveChapters.length})` : ''}
                  {chaptersLoading && (
                    <Loader2 className="w-4 h-4 animate-spin inline ml-2" />
                  )}
                </h2>
                {effectiveChapters.length > 0 && (
                  <button
                    onClick={handleDownloadAllChapters}
                    disabled={isDownloadingAll || downloadedChapters.size === effectiveChapters.length}
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
              {malIdMode && !chaptersLoading && effectiveChapters.length === 0 && !allanimeShowId && (
                <div className="text-center py-6 text-[var(--color-text-secondary)]">
                  <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">This manga is not available for reading yet.</p>
                  {details.totalChapters && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">{details.totalChapters} chapters on MyAnimeList</p>
                  )}
                </div>
              )}

              {effectiveChapters.length > 0 && (
                <>
                  {/* Pagination controls */}
                  {effectiveChapters.length > CHAPTERS_PER_PAGE && (
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-[var(--color-text-muted)]">
                        {chapterPage * CHAPTERS_PER_PAGE + 1}–{Math.min((chapterPage + 1) * CHAPTERS_PER_PAGE, effectiveChapters.length)} of {effectiveChapters.length}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setChapterPage(p => Math.max(0, p - 1))}
                          disabled={chapterPage === 0}
                          className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors text-sm font-medium"
                        >
                          Prev
                        </button>
                        <span className="text-sm text-[var(--color-text-secondary)] tabular-nums">
                          {chapterPage + 1} / {totalChapterPages}
                        </span>
                        <button
                          onClick={() => setChapterPage(p => Math.min(totalChapterPages - 1, p + 1))}
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
                            </div>
                            {chapter.title && (
                              <p className="text-xs text-[var(--color-text-muted)] truncate mt-1">
                                {chapter.title}
                              </p>
                            )}
                          </button>

                          {/* Download button */}
                          <button
                            onClick={(e) => isDownloaded
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
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
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
          className="relative bg-[var(--color-bg-primary)] rounded-xl max-w-6xl w-full my-8 shadow-2xl animate-in slide-in-from-bottom-4 duration-500 border border-white/5"
          onClick={(e) => e.stopPropagation()}
        >
          {modalContent}
        </div>
      </div>
    </div>
  )
}
