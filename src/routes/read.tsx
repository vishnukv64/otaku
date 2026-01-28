/**
 * Read Route - Manga Reader Page
 *
 * Full-screen manga reader with chapter navigation
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { MangaReader } from '@/components/reader/MangaReader'
import {
  getMangaDetails,
  getChapterImages,
  saveMediaDetails,
  getReadingProgress,
  isChapterDownloaded,
  getDownloadedChapterImages,
  type MediaEntry,
} from '@/utils/tauri-commands'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { MangaDetails, ChapterImages } from '@/types/extension'
import toast from 'react-hot-toast'

interface ReadSearch {
  extensionId: string
  mangaId: string
  chapterId?: string
}

export const Route = createFileRoute('/read')({
  component: ReadPage,
  validateSearch: (search: Record<string, unknown>): ReadSearch => {
    return {
      extensionId: (search.extensionId as string) || '',
      mangaId: (search.mangaId as string) || '',
      chapterId: search.chapterId as string | undefined,
    }
  },
})

function ReadPage() {
  const navigate = useNavigate()
  const { extensionId, mangaId, chapterId: initialChapterId } = Route.useSearch()

  const [details, setDetails] = useState<MangaDetails | null>(null)
  const [chapterImages, setChapterImages] = useState<ChapterImages | null>(null)
  const [currentChapterId, setCurrentChapterId] = useState<string>(initialChapterId || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resumePage, setResumePage] = useState<number>(1)
  const [readChapters, setReadChapters] = useState<Set<string>>(new Set())

  // Load manga details
  useEffect(() => {
    if (!extensionId || !mangaId) {
      setError('Missing extension ID or manga ID')
      return
    }

    const loadDetails = async () => {
      try {
        const result = await getMangaDetails(extensionId, mangaId)
        console.log('[Read] Manga details loaded:', result.title, '- Genres from API:', result.genres)

        // Sort chapters by number
        if (result.chapters) {
          result.chapters.sort((a, b) => a.number - b.number)
        }

        setDetails(result)

        // Save media details to database
        try {
          const genresJson = result.genres ? JSON.stringify(result.genres) : undefined
          console.log('[Read] Saving media with genres:', genresJson)

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
            genres: genresJson,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          await saveMediaDetails(mediaEntry)
        } catch (saveErr) {
          console.error('Failed to save media details:', saveErr)
        }

        // Set initial chapter if not provided
        if (!initialChapterId && result.chapters.length > 0) {
          setCurrentChapterId(result.chapters[0].id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load manga details')
      }
    }

    loadDetails()
  }, [extensionId, mangaId, initialChapterId])

  // Get current chapter info
  const currentChapter = details?.chapters.find((ch) => ch.id === currentChapterId)
  const currentChapterIndex = details?.chapters.findIndex((ch) => ch.id === currentChapterId) ?? -1

  // Load chapter images and reading progress
  useEffect(() => {
    if (!extensionId || !currentChapterId || !currentChapter) return

    const loadChapterData = async () => {
      setLoading(true)
      setError(null)

      try {
        // Step 1: Load reading progress FIRST
        try {
          const progress = await getReadingProgress(currentChapterId)

          if (progress && progress.current_page > 1) {
            setResumePage(progress.current_page)
            toast.success(`Resuming from page ${progress.current_page}`, {
              id: `resume-${currentChapterId}`,
              duration: 3000,
              position: 'bottom-center',
            })

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
        const downloaded = await isChapterDownloaded(mangaId, currentChapterId)

        if (downloaded) {
          // Load from local storage
          const localPaths = await getDownloadedChapterImages(mangaId, currentChapterId)

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

            toast.success('Reading from downloaded content', {
              id: `offline-${currentChapterId}`,
              duration: 2000,
              position: 'bottom-center',
            })
            return
          }
        }

        // Step 3: Load chapter images from network
        const images = await getChapterImages(extensionId, currentChapterId)
        setChapterImages(images)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chapter images')
      } finally {
        setLoading(false)
      }
    }

    loadChapterData()
  }, [extensionId, mangaId, currentChapterId, currentChapter])

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
        {loading && (
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

        {!loading && !error && chapterImages && chapterImages.images.length > 0 && (
          <MangaReader
            images={chapterImages.images}
            mangaId={mangaId}
            chapterId={currentChapterId}
            _mangaTitle={details?.title}
            _chapterTitle={chapterImages.title}
            currentChapter={currentChapter?.number}
            totalChapters={details?.chapters.length}
            chapters={details?.chapters}
            onNextChapter={handleNextChapter}
            onPreviousChapter={handlePreviousChapter}
            onChapterSelect={handleChapterSelect}
            onGoBack={handleGoBack}
            initialPage={resumePage}
            readChapters={readChapters}
          />
        )}

        {!loading && !error && chapterImages && chapterImages.images.length === 0 && (
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
