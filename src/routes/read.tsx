/**
 * Read Route - Manga Reader Page
 *
 * Full-screen manga reader with chapter navigation
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, useRef } from 'react'
import { Loader2, X, Home } from 'lucide-react'
import { MangaReader } from '@/components/reader/MangaReader'
import { useSettingsStore } from '@/store/settingsStore'

// NSFW genres that should be blocked when filter is enabled
const NSFW_GENRES = ['hentai', 'ecchi', 'adult', 'mature', 'erotica', 'smut', 'adult cast', 'sexual violence']
import {
  getMangaDetails,
  getChapterImages,
  saveMediaDetails,
  saveEpisodes,
  getCachedMediaDetails,
  getReadingProgress,
  isChapterDownloaded,
  getDownloadedChapterImages,
  resolveAllanimeId,
  loadExtension,
  searchManga,
  type MediaEntry,
  type EpisodeEntry,
} from '@/utils/tauri-commands'
import { ALLANIME_MANGA_EXTENSION } from '@/extensions/allanime-manga-extension'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { MangaDetails, ChapterImages } from '@/types/extension'
import { toastInfo } from '@/utils/notify'

interface ReadSearch {
  extensionId: string
  mangaId: string
  chapterId?: string
  malId?: string
}

export const Route = createFileRoute('/read')({
  component: ReadPage,
  validateSearch: (search: Record<string, unknown>): ReadSearch => {
    return {
      extensionId: (search.extensionId as string) || '',
      mangaId: (search.mangaId as string) || '',
      chapterId: search.chapterId as string | undefined,
      malId: search.malId as string | undefined,
    }
  },
})

function ReadPage() {
  const navigate = useNavigate()
  const { extensionId, mangaId, chapterId: initialChapterId, malId } = Route.useSearch()
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)

  // Use MAL ID for progress/library tracking when available, otherwise fall back to AllAnime ID
  const trackingId = malId || mangaId

  // Debug logging for ContinueReading navigation issues
  console.log('[Read] Mounted with params:', { extensionId, mangaId, initialChapterId, malId, trackingId })

  const [details, setDetails] = useState<MangaDetails | null>(null)
  const [isNsfwBlocked, setIsNsfwBlocked] = useState(false)
  const [chapterImages, setChapterImages] = useState<ChapterImages | null>(null)
  const [currentChapterId, setCurrentChapterId] = useState<string>(initialChapterId || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resumePage, setResumePage] = useState<number>(1)
  const [readChapters, setReadChapters] = useState<Set<string>>(new Set())
  const shownResumeToastRef = useRef<string | null>(null)

  // AllAnime ID resolution for Jikan (MAL ID) entries
  // When malId is provided and equals mangaId, we need to resolve the AllAnime ID
  const needsResolution = malId !== undefined && malId === mangaId
  const [resolvedMangaId, setResolvedMangaId] = useState<string | null>(needsResolution ? null : mangaId)
  const [allanimeExtId, setAllanimeExtId] = useState<string | null>(null)

  // Load AllAnime extension when resolution is needed
  useEffect(() => {
    if (!needsResolution) {
      setResolvedMangaId(mangaId)
      return
    }

    loadExtension(ALLANIME_MANGA_EXTENSION)
      .then(meta => setAllanimeExtId(meta.id))
      .catch(err => {
        console.error('[Read] Failed to load AllAnime extension:', err)
        setError('Failed to load manga reader extension')
      })
  }, [needsResolution, mangaId])

  // Resolve AllAnime ID from MAL ID (bridge + fallback search)
  useEffect(() => {
    if (!needsResolution || !allanimeExtId) return

    const resolve = async () => {
      try {
        // Try cached media details to get the title for bridge resolution
        let title = ''
        let englishTitle: string | undefined
        let year: number | undefined

        try {
          const cached = await getCachedMediaDetails(malId!)
          title = cached?.media.title || ''
          englishTitle = cached?.media.english_name ?? undefined
          year = cached?.media.year ?? undefined
        } catch (cacheErr) {
          console.warn('[Read] Cache lookup failed, will try bridge with MAL ID only:', cacheErr)
        }

        if (title) {
          // Step 1: Bridge resolution (SQLite cache + GraphQL search)
          const bridgeId = await resolveAllanimeId(title, 'manga', malId!, englishTitle, year)
          if (bridgeId) {
            console.log('[Read] Resolved AllAnime ID via bridge:', bridgeId)
            setResolvedMangaId(bridgeId)
            return
          }

          // Step 2: Fallback — search AllAnime directly
          const searchResults = await searchManga(allanimeExtId, title, 1, true)
          if (searchResults.results.length > 0) {
            console.log('[Read] Resolved AllAnime ID via search:', searchResults.results[0].id)
            setResolvedMangaId(searchResults.results[0].id)
            return
          }
        }

        // Step 3: If no cached title, try bridge with just the MAL ID (it may have a cached mapping)
        if (!title) {
          const bridgeId = await resolveAllanimeId('', 'manga', malId!, undefined, undefined)
          if (bridgeId) {
            console.log('[Read] Resolved AllAnime ID via bridge (no title):', bridgeId)
            setResolvedMangaId(bridgeId)
            return
          }
        }

        console.error('[Read] Could not resolve AllAnime ID for MAL ID:', malId)
        setError('Could not find this manga for reading. Try opening it from the manga page.')
        setLoading(false)
      } catch (err) {
        console.error('[Read] AllAnime ID resolution failed:', err)
        setError('Failed to resolve manga source for reading')
        setLoading(false)
      }
    }

    resolve()
  }, [needsResolution, allanimeExtId, malId])

  // Effective extension ID: use AllAnime extension for Jikan entries, otherwise the passed extensionId
  const effectiveExtId = needsResolution ? (allanimeExtId || extensionId) : extensionId

  // Load manga details
  useEffect(() => {
    if (!effectiveExtId || !resolvedMangaId) {
      if (!needsResolution && (!extensionId || !mangaId)) {
        setError('Missing extension ID or manga ID')
      }
      return
    }

    const loadDetails = async () => {
      let result: MangaDetails | null = null

      // Try to load from API first
      try {
        result = await getMangaDetails(effectiveExtId, resolvedMangaId, !nsfwFilter)
        console.log('[Read] Manga details loaded:', result.title, '- Genres from API:', result.genres)

        // Check if content is NSFW and should be blocked
        if (nsfwFilter && result.genres) {
          const hasNsfwGenre = result.genres.some(genre =>
            NSFW_GENRES.includes(genre.toLowerCase())
          )
          if (hasNsfwGenre) {
            setIsNsfwBlocked(true)
            setLoading(false)
            return
          }
        }

        // Sort chapters by number
        if (result.chapters) {
          result.chapters.sort((a, b) => a.number - b.number)
        }

        // Save media details to database for offline use
        try {
          const genresJson = result.genres ? JSON.stringify(result.genres) : undefined
          console.log('[Read] Saving media with genres:', genresJson)

          const mediaEntry: MediaEntry = {
            id: trackingId,
            extension_id: malId ? 'jikan' : extensionId,
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
            genres: genresJson,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          await saveMediaDetails(mediaEntry)

          // Also cache chapters for offline reading
          if (result.chapters.length > 0) {
            const chapterEntries: EpisodeEntry[] = result.chapters.map(ch => ({
              id: ch.id,
              media_id: trackingId,
              extension_id: malId ? 'jikan' : extensionId,
              number: ch.number,
              title: ch.title,
              description: undefined,
              thumbnail_url: undefined,
              aired_date: undefined,
              duration: undefined,
            }))
            await saveEpisodes(trackingId, malId ? 'jikan' : extensionId, chapterEntries)
          }
        } catch (saveErr) {
          console.error('Failed to save media details:', saveErr)
        }
      } catch (apiErr) {
        console.warn('[Read] API failed, trying cache:', apiErr)

        // API failed - try to load from cache
        try {
          const cached = await getCachedMediaDetails(trackingId)
          if (cached && cached.episodes.length > 0) {
            // Convert cached data to MangaDetails format
            result = {
              id: cached.media.id,
              title: cached.media.title,
              english_name: cached.media.english_name,
              native_name: cached.media.native_name,
              description: cached.media.description,
              cover_url: cached.media.cover_url,
              type: cached.media.content_type,
              status: cached.media.status,
              year: cached.media.year,
              rating: cached.media.rating,
              genres: cached.media.genres ? JSON.parse(cached.media.genres) : [],
              chapters: cached.episodes.map(ch => ({
                id: ch.id,
                number: ch.number,
                title: ch.title,
              })),
            }
            // Sort chapters
            result.chapters.sort((a, b) => a.number - b.number)
            console.log('[Read] Loaded from cache:', cached.episodes.length, 'chapters')
          }
        } catch (cacheErr) {
          console.error('[Read] Cache also failed:', cacheErr)
        }
      }

      // If we have no data from either source, show error
      if (!result) {
        setError('Failed to load manga details - no cached data available')
        setLoading(false)
        return
      }

      setDetails(result)

      // Set initial chapter or validate the provided chapter ID
      if (!initialChapterId && result.chapters.length > 0) {
        setCurrentChapterId(result.chapters[0].id)
      } else if (initialChapterId && result.chapters.length > 0) {
        // Validate that the saved chapter ID exists in the loaded chapters
        const chapterExists = result.chapters.some(ch => ch.id === initialChapterId)
        if (!chapterExists) {
          // Chapter ID mismatch (AllAnime may have changed IDs, or manga was re-imported)
          // Try to find a chapter with matching number from reading progress
          console.warn(`[Read] Chapter ID "${initialChapterId}" not found in loaded chapters, falling back`)
          setCurrentChapterId(result.chapters[0].id)
        }
      } else if (result.chapters.length === 0) {
        setError('This manga has no available chapters')
        setLoading(false)
      }
    }

    loadDetails()
  }, [effectiveExtId, resolvedMangaId, trackingId, initialChapterId, nsfwFilter])

  // Get current chapter info
  const currentChapter = details?.chapters.find((ch) => ch.id === currentChapterId)
  const currentChapterIndex = details?.chapters.findIndex((ch) => ch.id === currentChapterId) ?? -1

  // Load chapter images and reading progress
  useEffect(() => {
    if (!effectiveExtId || !resolvedMangaId || !currentChapterId || !currentChapter) return

    const loadChapterData = async () => {
      setLoading(true)
      setError(null)

      try {
        // Step 1: Load reading progress FIRST
        try {
          const progress = await getReadingProgress(currentChapterId)

          if (progress && progress.current_page > 1) {
            setResumePage(progress.current_page)

            // Only show toast once per chapter (avoid duplicates from effect re-runs)
            if (shownResumeToastRef.current !== currentChapterId) {
              shownResumeToastRef.current = currentChapterId
              toastInfo('Resuming Reading', `Resuming from page ${progress.current_page}`)
            }

            // Mark as read if completed
            if (progress.completed) {
              setReadChapters(prev => new Set(prev).add(currentChapterId))
            }
          } else {
            setResumePage(1)
          }
        } catch {
          setResumePage(1)
        }

        // Step 2: Check if chapter is downloaded first
        const downloaded = await isChapterDownloaded(trackingId, currentChapterId)

        if (downloaded) {
          // Load from local storage
          const localPaths = await getDownloadedChapterImages(trackingId, currentChapterId)

          if (localPaths.length > 0) {
            // Convert local file paths to asset URLs
            const localImages = localPaths.map((path, index) => ({
              url: convertFileSrc(path),
              page: index + 1,
            }))

            setChapterImages({
              images: localImages,
              total_pages: localImages.length,
              title: `Chapter ${currentChapter.number}`,
            })

            toastInfo('Offline Mode', 'Reading from downloaded content')
            return
          }
        }

        // Step 3: Load chapter images from network
        const images = await getChapterImages(effectiveExtId, currentChapterId)
        setChapterImages(images)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chapter images')
      } finally {
        setLoading(false)
      }
    }

    loadChapterData()
  }, [effectiveExtId, resolvedMangaId, trackingId, currentChapterId, currentChapter])

  const handleNextChapter = () => {
    if (!details || currentChapterIndex === -1) return

    const nextChapter = details.chapters[currentChapterIndex + 1]
    if (nextChapter) {
      setCurrentChapterId(nextChapter.id)
      setResumePage(1) // Reset to page 1 for new chapter
    }
  }

  const handlePreviousChapter = () => {
    if (!details || currentChapterIndex === -1) return

    const previousChapter = details.chapters[currentChapterIndex - 1]
    if (previousChapter) {
      setCurrentChapterId(previousChapter.id)
      setResumePage(1) // Reset to page 1 for new chapter
    }
  }

  const handleChapterSelect = (chapterId: string) => {
    setCurrentChapterId(chapterId)
    setResumePage(1) // Reset to page 1 for new chapter
  }

  const handleGoBack = () => {
    navigate({ to: '/manga' })
  }

  return (
    <div className="fixed inset-0 bg-black z-50" style={{ paddingTop: '64px' }}>
      {/* Reader Container */}
      <div className="w-full h-full">
        {loading && !isNsfwBlocked && (
          <div className="w-full h-full flex items-center justify-center bg-black">
            <Loader2 className="w-12 h-12 animate-spin text-[var(--color-accent-primary)]" />
          </div>
        )}

        {error && (
          <div className="w-full h-full flex flex-col items-center justify-center bg-black text-white">
            <p className="text-lg font-semibold mb-2">Error Loading Chapter</p>
            <p className="text-[var(--color-text-secondary)]">{error}</p>
          </div>
        )}

        {/* NSFW Content Blocked */}
        {isNsfwBlocked && (
          <div className="w-full h-full flex flex-col items-center justify-center bg-black text-white">
            <div className="w-20 h-20 mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <X className="w-10 h-10 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold mb-3">Content Blocked</h2>
            <p className="text-[var(--color-text-secondary)] max-w-md text-center mb-6">
              This manga contains adult content and has been blocked by your NSFW filter settings.
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mb-8">
              You can disable the NSFW filter in Settings to view this content.
            </p>
            <button
              onClick={handleGoBack}
              className="flex items-center gap-2 px-6 py-3 bg-[var(--color-bg-secondary)] text-white rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Home className="w-5 h-5" />
              Go Back
            </button>
          </div>
        )}

        {!loading && !error && !isNsfwBlocked && chapterImages && chapterImages.images.length > 0 && (
          <MangaReader
            images={chapterImages.images}
            mangaId={trackingId}
            chapterId={currentChapterId}
            _mangaTitle={details?.title}
            _chapterTitle={chapterImages.title}
            currentChapter={currentChapter?.number}
            _totalChapters={details?.chapters.length}
            hasNextChapter={currentChapterIndex >= 0 && currentChapterIndex < (details?.chapters.length ?? 0) - 1}
            hasPreviousChapter={currentChapterIndex > 0}
            chapters={details?.chapters}
            onNextChapter={handleNextChapter}
            onPreviousChapter={handlePreviousChapter}
            onChapterSelect={handleChapterSelect}
            onGoBack={handleGoBack}
            initialPage={resumePage}
            readChapters={readChapters}
          />
        )}

        {!loading && !error && !isNsfwBlocked && chapterImages && chapterImages.images.length === 0 && (
          <div className="w-full h-full flex flex-col items-center justify-center bg-black text-white">
            <p className="text-lg font-semibold mb-2">No Pages Available</p>
            <p className="text-[var(--color-text-secondary)]">
              This chapter does not have any available pages.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
