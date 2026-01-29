/**
 * MangaDetailModal - Detailed information modal for manga
 *
 * Similar to MediaDetailModal but with manga-specific features:
 * - Chapter list instead of episodes
 * - "Read Now" / "Continue Reading" buttons
 * - Reading progress indicators
 */

import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  X,
  BookOpen,
  Star,
  Calendar,
  Info,
  Heart,
  Plus,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Library,
  BookMarked,
  Download,
  CheckCircle,
  Trash2,
} from 'lucide-react'
import { getMangaDetails, saveMediaDetails, addToLibrary, removeFromLibrary, isInLibrary, toggleFavorite, getLatestReadingProgressForMedia, getChapterImages, startChapterDownload, isChapterDownloaded, deleteChapterDownload, type MediaEntry, type LibraryStatus } from '@/utils/tauri-commands'
import { useSettingsStore } from '@/store/settingsStore'
import type { SearchResult, MangaDetails, Chapter } from '@/types/extension'
import toast from 'react-hot-toast'

interface MangaDetailModalProps {
  manga: SearchResult | null
  extensionId: string
  onClose: () => void
}

// NSFW genres that should be blocked when filter is enabled
const NSFW_GENRES = ['hentai', 'ecchi', 'adult', 'mature', 'erotica', 'smut', 'adult cast', 'sexual violence']

export function MangaDetailModal({ manga, extensionId, onClose }: MangaDetailModalProps) {
  const navigate = useNavigate()
  const maxConcurrentDownloads = useSettingsStore((state) => state.maxConcurrentDownloads)
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const [details, setDetails] = useState<MangaDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inLibrary, setInLibrary] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)
  const [showAllChapters, setShowAllChapters] = useState(false)
  const [readingProgress, setReadingProgress] = useState<{ chapterId: string; chapterNumber: number; page: number } | null>(null)
  const [downloadedChapters, setDownloadedChapters] = useState<Set<string>>(new Set())
  const [downloadingChapters, setDownloadingChapters] = useState<Set<string>>(new Set())
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const [isNsfwBlocked, setIsNsfwBlocked] = useState(false)

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Load manga details
  useEffect(() => {
    if (!manga) return

    const loadDetails = async () => {
      setLoading(true)
      setError(null)

      try {
        const result = await getMangaDetails(extensionId, manga.id, !nsfwFilter)
        setDetails(result)

        // Check if content is NSFW and should be blocked
        if (nsfwFilter && result.genres) {
          const hasNsfwGenre = result.genres.some(genre =>
            NSFW_GENRES.includes(genre.toLowerCase())
          )
          setIsNsfwBlocked(hasNsfwGenre)
        } else {
          setIsNsfwBlocked(false)
        }

        // Save to database for library
        try {
          const mediaEntry: MediaEntry = {
            id: result.id,
            extension_id: extensionId,
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

        // Check library status
        try {
          const inLib = await isInLibrary(result.id)
          setInLibrary(inLib)
        } catch {
          // Ignore
        }

        // Check reading progress
        try {
          const progress = await getLatestReadingProgressForMedia(result.id)
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
  }, [manga, extensionId, nsfwFilter])

  // Check which chapters are downloaded
  useEffect(() => {
    if (!details) return

    const checkDownloads = async () => {
      const downloaded = new Set<string>()
      for (const chapter of details.chapters) {
        try {
          const isDownloaded = await isChapterDownloaded(details.id, chapter.id)
          if (isDownloaded) {
            downloaded.add(chapter.id)
          }
        } catch {
          // Ignore errors
        }
      }
      setDownloadedChapters(downloaded)
    }

    checkDownloads()
  }, [details])

  if (!manga) return null

  const handleReadNow = (chapterId?: string) => {
    if (!details) return

    navigate({
      to: '/read',
      search: {
        extensionId,
        mangaId: details.id,
        chapterId: chapterId || (details.chapters[0]?.id),
      },
    })
    onClose()
  }

  const handleContinueReading = () => {
    if (!readingProgress) return
    handleReadNow(readingProgress.chapterId)
  }

  // Helper to ensure media is saved before library operations
  const ensureMediaSaved = async () => {
    if (!details) return false

    try {
      const mediaEntry: MediaEntry = {
        id: details.id,
        extension_id: extensionId,
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
        episode_count: details.chapters.length,
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
    if (!details) return

    try {
      // Ensure media is saved first (required for foreign key constraint)
      await ensureMediaSaved()
      await addToLibrary(details.id, status)
      setInLibrary(true)
      toast.success(`Added to ${status.replace('_', ' ')}`)
    } catch (err) {
      toast.error('Failed to add to library')
      console.error(err)
    }
  }

  const handleRemoveFromLibrary = async () => {
    if (!details) return

    try {
      await removeFromLibrary(details.id)
      setInLibrary(false)
      setIsFavorite(false)
      toast.success('Removed from library')
    } catch (err) {
      toast.error('Failed to remove from library')
      console.error(err)
    }
  }

  const handleToggleFavorite = async () => {
    if (!details) return

    try {
      // Ensure media is saved first (required for foreign key constraint)
      await ensureMediaSaved()

      if (!inLibrary) {
        await addToLibrary(details.id, 'plan_to_read')
        setInLibrary(true)
      }
      const newFavorite = await toggleFavorite(details.id)
      setIsFavorite(newFavorite)
      toast.success(newFavorite ? 'Added to favorites' : 'Removed from favorites')
    } catch (err) {
      toast.error('Failed to toggle favorite')
      console.error(err)
    }
  }

  // Handle chapter download
  const handleDownloadChapter = async (e: React.MouseEvent, chapter: { id: string; number: number }) => {
    e.stopPropagation() // Prevent triggering the read action
    if (!details) return

    try {
      setDownloadingChapters(prev => new Set(prev).add(chapter.id))
      toast.loading(`Downloading Chapter ${chapter.number}...`, { id: `download-${chapter.id}` })

      // Get chapter images first
      const chapterImages = await getChapterImages(extensionId, chapter.id)
      if (!chapterImages.images || chapterImages.images.length === 0) {
        throw new Error('No images found for this chapter')
      }

      // Start download with image URLs
      const imageUrls = chapterImages.images.map(img => img.url)
      await startChapterDownload(
        details.id,
        details.title,
        chapter.id,
        chapter.number,
        imageUrls
      )

      // Mark as downloaded
      setDownloadedChapters(prev => new Set(prev).add(chapter.id))
      toast.success(`Chapter ${chapter.number} downloaded!`, { id: `download-${chapter.id}` })
    } catch (err) {
      console.error('Download failed:', err)
      toast.error(`Failed to download chapter ${chapter.number}`, { id: `download-${chapter.id}` })
    } finally {
      setDownloadingChapters(prev => {
        const next = new Set(prev)
        next.delete(chapter.id)
        return next
      })
    }
  }

  // Handle chapter download deletion
  const handleDeleteChapterDownload = async (e: React.MouseEvent, chapter: { id: string; number: number }) => {
    e.stopPropagation() // Prevent triggering the read action
    if (!details) return

    try {
      await deleteChapterDownload(details.id, chapter.id)
      setDownloadedChapters(prev => {
        const next = new Set(prev)
        next.delete(chapter.id)
        return next
      })
      toast.success(`Chapter ${chapter.number} download deleted`)
    } catch (err) {
      console.error('Delete failed:', err)
      toast.error(`Failed to delete chapter ${chapter.number} download`)
    }
  }

  // Download a single chapter - helper for concurrent downloads
  const downloadSingleChapter = async (chapter: Chapter): Promise<boolean> => {
    if (!details) return false

    try {
      setDownloadingChapters(prev => new Set(prev).add(chapter.id))

      // Get chapter images
      const chapterImages = await getChapterImages(extensionId, chapter.id)
      if (!chapterImages.images || chapterImages.images.length === 0) {
        throw new Error('No images found')
      }

      // Start download
      const imageUrls = chapterImages.images.map(img => img.url)
      await startChapterDownload(
        details.id,
        details.title,
        chapter.id,
        chapter.number,
        imageUrls
      )

      // Mark as downloaded
      setDownloadedChapters(prev => new Set(prev).add(chapter.id))
      return true
    } catch (err) {
      console.error(`Failed to download chapter ${chapter.number}:`, err)
      return false
    } finally {
      setDownloadingChapters(prev => {
        const next = new Set(prev)
        next.delete(chapter.id)
        return next
      })
    }
  }

  // Handle download all chapters - concurrent downloads
  const handleDownloadAllChapters = async () => {
    if (!details || isDownloadingAll) return

    // Filter out already downloaded chapters
    const chaptersToDownload = details.chapters.filter(ch => !downloadedChapters.has(ch.id))

    if (chaptersToDownload.length === 0) {
      toast.success('All chapters already downloaded!')
      return
    }

    setIsDownloadingAll(true)
    const toastId = 'download-all'
    let successCount = 0
    let failCount = 0

    toast.loading(`Downloading ${chaptersToDownload.length} chapters (${maxConcurrentDownloads} concurrent)...`, { id: toastId })

    // Process chapters in batches of maxConcurrentDownloads
    const concurrency = maxConcurrentDownloads || 3
    for (let i = 0; i < chaptersToDownload.length; i += concurrency) {
      const batch = chaptersToDownload.slice(i, i + concurrency)

      // Download batch concurrently
      const results = await Promise.all(
        batch.map(chapter => downloadSingleChapter(chapter))
      )

      // Count successes and failures
      results.forEach(success => {
        if (success) {
          successCount++
        } else {
          failCount++
        }
      })

      // Update progress toast
      const total = successCount + failCount
      toast.loading(`Downloaded ${total}/${chaptersToDownload.length} chapters...`, { id: toastId })
    }

    setIsDownloadingAll(false)

    if (failCount === 0) {
      toast.success(`Successfully downloaded ${successCount} chapters!`, { id: toastId })
    } else {
      toast.error(`Downloaded ${successCount} chapters, ${failCount} failed`, { id: toastId })
    }
  }

  const displayedChapters = showAllChapters
    ? details?.chapters || []
    : (details?.chapters || []).slice(0, 20)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-bg-primary)] rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with cover */}
        <div className="relative h-64">
          {/* Background blur */}
          <div
            className="absolute inset-0 bg-cover bg-center blur-lg scale-110 opacity-50"
            style={{ backgroundImage: `url(${manga.cover_url})` }}
          />

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-primary)] to-transparent" />

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-black/50 rounded-full hover:bg-black/70 transition-colors z-10"
          >
            <X className="w-5 h-5 text-white" />
          </button>

          {/* Cover and title */}
          <div className="absolute bottom-0 left-0 right-0 flex gap-6 p-6">
            <img
              src={manga.cover_url || '/placeholder-manga.png'}
              alt={manga.title}
              className="w-32 h-48 object-cover rounded-lg shadow-lg flex-shrink-0"
            />
            <div className="flex-1 min-w-0 self-end">
              <h1 className="text-2xl font-bold text-white truncate mb-2">{manga.title}</h1>
              <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
                {manga.rating && (
                  <span className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                    {manga.rating.toFixed(1)}
                  </span>
                )}
                {manga.year && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {manga.year}
                  </span>
                )}
                {details?.chapters && (
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-4 h-4" />
                    {details.chapters.length} chapters
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-16rem)]">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <Info className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <p className="text-[var(--color-text-secondary)]">{error}</p>
            </div>
          )}

          {/* NSFW Content Blocked */}
          {!loading && !error && isNsfwBlocked && (
            <div className="text-center py-12">
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

          {!loading && !error && details && !isNsfwBlocked && (
            <div className="space-y-6">
              {/* Action buttons */}
              <div className="flex flex-wrap gap-3">
                {/* Read / Continue Reading button */}
                {readingProgress ? (
                  <button
                    onClick={handleContinueReading}
                    className="flex items-center gap-2 px-6 py-3 bg-[var(--color-accent-primary)] text-white font-semibold rounded-lg hover:opacity-90 transition-opacity"
                  >
                    <BookOpen className="w-5 h-5" />
                    Continue Ch. {readingProgress.chapterNumber} (p.{readingProgress.page})
                  </button>
                ) : (
                  <button
                    onClick={() => handleReadNow()}
                    className="flex items-center gap-2 px-6 py-3 bg-[var(--color-accent-primary)] text-white font-semibold rounded-lg hover:opacity-90 transition-opacity"
                  >
                    <BookOpen className="w-5 h-5" />
                    Start Reading
                  </button>
                )}

                {/* Library button */}
                {inLibrary ? (
                  <button
                    onClick={handleRemoveFromLibrary}
                    className="flex items-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Check className="w-5 h-5" />
                    In Library
                  </button>
                ) : (
                  <div className="relative group">
                    <button
                      onClick={() => handleAddToLibrary('plan_to_read')}
                      className="flex items-center gap-2 px-4 py-3 bg-[var(--color-bg-secondary)] text-white rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors"
                    >
                      <Plus className="w-5 h-5" />
                      Add to Library
                    </button>
                    {/* Dropdown menu */}
                    <div className="absolute top-full left-0 mt-1 bg-[var(--color-bg-secondary)] rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[180px]">
                      <button
                        onClick={() => handleAddToLibrary('reading')}
                        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-[var(--color-bg-hover)] text-left text-sm"
                      >
                        <BookMarked className="w-4 h-4" />
                        Reading
                      </button>
                      <button
                        onClick={() => handleAddToLibrary('plan_to_read')}
                        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-[var(--color-bg-hover)] text-left text-sm"
                      >
                        <Library className="w-4 h-4" />
                        Plan to Read
                      </button>
                      <button
                        onClick={() => handleAddToLibrary('completed')}
                        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-[var(--color-bg-hover)] text-left text-sm"
                      >
                        <Check className="w-4 h-4" />
                        Completed
                      </button>
                    </div>
                  </div>
                )}

                {/* Favorite button */}
                <button
                  onClick={handleToggleFavorite}
                  className={`p-3 rounded-lg transition-colors ${
                    isFavorite
                      ? 'bg-red-500 text-white'
                      : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                  }`}
                >
                  <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
                </button>
              </div>

              {/* Genres */}
              {details.genres && details.genres.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {details.genres.map((genre) => (
                    <span
                      key={genre}
                      className="px-3 py-1 bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] text-sm rounded-full"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              {/* Description */}
              {details.description && (
                <div>
                  <h3 className="text-lg font-semibold mb-2">Synopsis</h3>
                  <p className="text-[var(--color-text-secondary)] leading-relaxed">
                    {details.description}
                  </p>
                </div>
              )}

              {/* Chapters */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">
                    Chapters ({details.chapters.length})
                  </h3>
                  <button
                    onClick={handleDownloadAllChapters}
                    disabled={isDownloadingAll || downloadedChapters.size === details.chapters.length}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      downloadedChapters.size === details.chapters.length
                        ? 'bg-green-600 text-white cursor-default'
                        : isDownloadingAll
                          ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] cursor-wait'
                          : 'bg-[var(--color-bg-secondary)] hover:bg-[var(--color-accent-primary)] text-[var(--color-text-secondary)] hover:text-white'
                    }`}
                  >
                    {isDownloadingAll ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Downloading...
                      </>
                    ) : downloadedChapters.size === details.chapters.length ? (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        All Downloaded
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Download All ({details.chapters.length - downloadedChapters.size})
                      </>
                    )}
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {displayedChapters.map((chapter: Chapter) => {
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

                {/* Show more/less button */}
                {details.chapters.length > 20 && (
                  <button
                    onClick={() => setShowAllChapters(!showAllChapters)}
                    className="flex items-center gap-1 mt-4 text-[var(--color-accent-primary)] hover:underline"
                  >
                    {showAllChapters ? (
                      <>
                        <ChevronUp className="w-4 h-4" />
                        Show Less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" />
                        Show All {details.chapters.length} Chapters
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
