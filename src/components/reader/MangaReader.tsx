/**
 * MangaReader - Main manga reader component
 *
 * Features:
 * - 4 reading modes: single, double, vertical, webtoon
 * - Keyboard navigation
 * - Touch/click navigation
 * - Progress tracking
 * - Chapter navigation
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useReaderStore } from '@/store/readerStore'
import { saveReadingProgress } from '@/utils/tauri-commands'
import type { ChapterImage, Chapter } from '@/types/extension'

import { PageView } from './PageView'
import { VerticalScrollView } from './VerticalScrollView'
import { ReaderControls } from './ReaderControls'
import { ReaderSettings } from './ReaderSettings'
import { ChapterList } from './ChapterList'

interface MangaReaderProps {
  images: ChapterImage[]
  mangaId?: string
  chapterId?: string
  _mangaTitle?: string // For display purposes (future use)
  _chapterTitle?: string // For display purposes (future use)
  currentChapter?: number
  totalChapters?: number
  chapters?: Chapter[]
  onNextChapter?: () => void
  onPreviousChapter?: () => void
  onChapterSelect?: (chapterId: string) => void
  onGoBack?: () => void
  initialPage?: number
  readChapters?: Set<string>
}

export function MangaReader({
  images,
  mangaId,
  chapterId,
  currentChapter,
  totalChapters,
  chapters = [],
  onNextChapter,
  onPreviousChapter,
  onChapterSelect,
  onGoBack,
  initialPage = 1,
  readChapters = new Set(),
}: MangaReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hideControlsTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  // Refs for unmount save (to avoid stale closures)
  const mangaIdRef = useRef(mangaId)
  const chapterIdRef = useRef(chapterId)
  const currentChapterRef = useRef(currentChapter)
  const currentPageRef = useRef(1)
  const totalPagesRef = useRef(0)
  const markReadThresholdRef = useRef(80)

  const {
    currentPage,
    totalPages,
    isFullscreen,
    showControls,
    settings,
    setCurrentPage,
    nextPage,
    previousPage,
    setTotalPages,
    setFullscreen,
    setShowControls,
  } = useReaderStore()

  // Keep refs updated with latest values (for unmount cleanup)
  useEffect(() => {
    mangaIdRef.current = mangaId
    chapterIdRef.current = chapterId
    currentChapterRef.current = currentChapter
  }, [mangaId, chapterId, currentChapter])

  useEffect(() => {
    currentPageRef.current = currentPage
    totalPagesRef.current = totalPages
    markReadThresholdRef.current = settings.markReadThreshold
  }, [currentPage, totalPages, settings.markReadThreshold])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chapterListOpen, setChapterListOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Check if we can navigate to adjacent chapters
  const canGoToPreviousChapter = !!(onPreviousChapter && currentChapter && currentChapter > 1)
  const canGoToNextChapter = !!(onNextChapter && currentChapter && totalChapters && currentChapter < totalChapters)

  // Wrapper for next page that handles chapter boundary
  const handleNextPage = useCallback(() => {
    if (currentPage >= totalPages) {
      // At the last page - go to next chapter if available
      if (canGoToNextChapter && onNextChapter) {
        onNextChapter()
      }
      // Otherwise do nothing (stay on last page)
    } else {
      nextPage()
    }
  }, [currentPage, totalPages, canGoToNextChapter, onNextChapter, nextPage])

  // Wrapper for previous page that handles chapter boundary
  const handlePreviousPage = useCallback(() => {
    if (currentPage <= 1) {
      // At the first page - go to previous chapter if available
      if (canGoToPreviousChapter && onPreviousChapter) {
        onPreviousChapter()
      }
      // Otherwise do nothing (stay on first page)
    } else {
      previousPage()
    }
  }, [currentPage, canGoToPreviousChapter, onPreviousChapter, previousPage])

  // Initialize reader state
  useEffect(() => {
    setTotalPages(images.length)
    setCurrentPage(initialPage)
    setIsLoading(false)
  }, [images, initialPage, setTotalPages, setCurrentPage])

  // Save reading progress when page changes
  useEffect(() => {
    // Check for undefined/null explicitly (not !currentChapter, which would be true for chapter 0)
    if (!mangaId || !chapterId || currentChapter === undefined || currentChapter === null) return
    if (totalPages === 0) return // Don't save if no pages loaded yet

    const saveProgress = async () => {
      try {
        await saveReadingProgress(
          mangaId,
          chapterId,
          currentChapter,
          currentPage,
          totalPages,
          currentPage >= totalPages * (settings.markReadThreshold / 100)
        )
      } catch (error) {
        console.error('Failed to save reading progress:', error)
      }
    }

    // Debounce save to avoid too many writes
    const timeoutId = setTimeout(saveProgress, 500) // Reduced to 500ms for faster saves
    return () => clearTimeout(timeoutId)
  }, [mangaId, chapterId, currentChapter, currentPage, totalPages, settings.markReadThreshold])

  // Save progress immediately when component unmounts
  useEffect(() => {
    return () => {
      // On unmount, try to save progress immediately using refs (avoids stale closures)
      const mId = mangaIdRef.current
      const cId = chapterIdRef.current
      const cChapter = currentChapterRef.current
      const cPage = currentPageRef.current
      const tPages = totalPagesRef.current
      const threshold = markReadThresholdRef.current

      if (mId && cId && cChapter !== undefined && cChapter !== null && tPages > 0) {
        saveReadingProgress(
          mId,
          cId,
          cChapter,
          cPage,
          tPages,
          cPage >= tPages * (threshold / 100)
        ).catch(err => console.error('Failed to save reading progress on unmount:', err))
      }
    }
  }, []) // Empty deps is correct - we use refs to get current values

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if settings or chapter list is open
      if (settingsOpen || chapterListOpen) {
        if (e.key === 'Escape') {
          setSettingsOpen(false)
          setChapterListOpen(false)
        }
        return
      }

      switch (e.key) {
        case 'ArrowLeft':
          if (settings.readingDirection === 'rtl') {
            handleNextPage()
          } else {
            handlePreviousPage()
          }
          break
        case 'ArrowRight':
          if (settings.readingDirection === 'rtl') {
            handlePreviousPage()
          } else {
            handleNextPage()
          }
          break
        case 'ArrowUp':
          handlePreviousPage()
          break
        case 'ArrowDown':
          handleNextPage()
          break
        case 'PageUp':
        case 'Home':
          setCurrentPage(1)
          break
        case 'PageDown':
        case 'End':
          setCurrentPage(totalPages)
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'm':
        case 'M':
          // Cycle through reading modes
          const modes = ['single', 'double', 'vertical', 'webtoon'] as const
          const currentIndex = modes.indexOf(settings.readingMode)
          const nextMode = modes[(currentIndex + 1) % modes.length]
          useReaderStore.getState().setReadingMode(nextMode)
          break
        case 'n':
        case 'N':
          if (onNextChapter && currentChapter && totalChapters && currentChapter < totalChapters) {
            onNextChapter()
          }
          break
        case 'p':
        case 'P':
          if (onPreviousChapter && currentChapter && currentChapter > 1) {
            onPreviousChapter()
          }
          break
        case 'Escape':
          if (isFullscreen) {
            toggleFullscreen()
          } else {
            onGoBack?.()
          }
          break
        case ' ':
          e.preventDefault()
          setShowControls(!showControls)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    settings.readingDirection,
    settings.readingMode,
    settingsOpen,
    chapterListOpen,
    showControls,
    isFullscreen,
    totalPages,
    currentChapter,
    totalChapters,
    handleNextPage,
    handlePreviousPage,
    setCurrentPage,
    setShowControls,
    onNextChapter,
    onPreviousChapter,
    onGoBack,
  ])

  // Auto-hide controls
  const resetControlsTimer = useCallback(() => {
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current)
    }
    setShowControls(true)
    hideControlsTimeoutRef.current = setTimeout(() => {
      if (!settingsOpen && !chapterListOpen) {
        setShowControls(false)
      }
    }, 3000)
  }, [settingsOpen, chapterListOpen, setShowControls])

  // Mouse movement shows controls
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseMove = () => resetControlsTimer()
    container.addEventListener('mousemove', handleMouseMove)

    return () => {
      container.removeEventListener('mousemove', handleMouseMove)
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current)
      }
    }
  }, [resetControlsTimer])

  // Fullscreen handling
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen()
      setFullscreen(true)
    } else {
      document.exitFullscreen()
      setFullscreen(false)
    }
  }, [setFullscreen])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [setFullscreen])

  // Handle page click zones
  const handlePageClick = useCallback((zone: 'left' | 'center' | 'right') => {
    if (!settings.tapToNavigate) {
      setShowControls(!showControls)
      return
    }

    if (zone === 'center') {
      setShowControls(!showControls)
      return
    }

    if (settings.readingDirection === 'rtl') {
      if (zone === 'left') handleNextPage()
      else handlePreviousPage()
    } else {
      if (zone === 'left') handlePreviousPage()
      else handleNextPage()
    }
  }, [settings.tapToNavigate, settings.readingDirection, showControls, handleNextPage, handlePreviousPage, setShowControls])

  // Auto-advance to next chapter
  useEffect(() => {
    if (
      settings.autoAdvanceChapter &&
      currentPage >= totalPages &&
      onNextChapter &&
      currentChapter &&
      totalChapters &&
      currentChapter < totalChapters
    ) {
      // Add a small delay before advancing
      const timeoutId = setTimeout(() => {
        onNextChapter()
      }, 1500)
      return () => clearTimeout(timeoutId)
    }
  }, [currentPage, totalPages, settings.autoAdvanceChapter, onNextChapter, currentChapter, totalChapters])

  // Render current reading mode
  const renderContent = () => {
    if (isLoading || images.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      )
    }

    const currentImage = images.find(img => img.page === currentPage) || images[currentPage - 1]

    switch (settings.readingMode) {
      case 'vertical':
      case 'webtoon':
        return (
          <VerticalScrollView
            images={images}
            fitMode={settings.fitMode}
            zoom={settings.zoom}
            onPageChange={setCurrentPage}
            initialPage={initialPage} // Use the original initial page, not the updating currentPage
            preloadCount={settings.preloadPages}
            gap={settings.readingMode === 'webtoon' ? 0 : 8}
            className="flex-1"
          />
        )

      case 'double':
        // Show two pages side by side
        const leftPage = settings.readingDirection === 'rtl'
          ? images.find(img => img.page === currentPage + 1)
          : currentImage
        const rightPage = settings.readingDirection === 'rtl'
          ? currentImage
          : images.find(img => img.page === currentPage + 1)

        return (
          <div className="flex-1 flex items-center justify-center gap-1">
            {leftPage && (
              <PageView
                imageUrl={leftPage.url}
                pageNumber={leftPage.page}
                totalPages={totalPages}
                fitMode={settings.fitMode}
                zoom={settings.zoom}
                showPageNumber={false}
                onClick={handlePageClick}
                className="max-w-[50%] h-full"
              />
            )}
            {rightPage && (
              <PageView
                imageUrl={rightPage.url}
                pageNumber={rightPage.page}
                totalPages={totalPages}
                fitMode={settings.fitMode}
                zoom={settings.zoom}
                showPageNumber={false}
                onClick={handlePageClick}
                className="max-w-[50%] h-full"
              />
            )}
          </div>
        )

      case 'single':
      default:
        return (
          <PageView
            imageUrl={currentImage?.url || ''}
            pageNumber={currentPage}
            totalPages={totalPages}
            fitMode={settings.fitMode}
            zoom={settings.zoom}
            showPageNumber={settings.showPageNumbers && !showControls}
            onClick={handlePageClick}
            className="flex-1"
          />
        )
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full h-full flex flex-col overflow-hidden',
        'select-none'
      )}
      style={{ backgroundColor: settings.backgroundColor }}
    >
      {/* Main content */}
      {renderContent()}

      {/* Controls overlay */}
      <ReaderControls
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        onPreviousPage={previousPage}
        onNextPage={nextPage}
        currentChapterNumber={currentChapter}
        hasNextChapter={!!(currentChapter && totalChapters && currentChapter < totalChapters)}
        hasPreviousChapter={!!(currentChapter && currentChapter > 1)}
        onNextChapter={() => onNextChapter?.()}
        onPreviousChapter={() => onPreviousChapter?.()}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onOpenSettings={() => {
          setSettingsOpen(true)
          setShowControls(true)
        }}
        onOpenChapterList={() => {
          setChapterListOpen(true)
          setShowControls(true)
        }}
        onGoBack={() => onGoBack?.()}
        readingDirection={settings.readingDirection}
        showControls={showControls}
      />

      {/* Settings panel */}
      <ReaderSettings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Chapter list */}
      <ChapterList
        chapters={chapters}
        currentChapterId={chapterId}
        currentChapterNumber={currentChapter}
        onChapterSelect={(id) => {
          onChapterSelect?.(id)
          setChapterListOpen(false)
        }}
        onClose={() => setChapterListOpen(false)}
        isOpen={chapterListOpen}
        readChapters={readChapters}
      />

      {/* Progress bar at very bottom */}
      {settings.showProgressBar && !showControls && totalPages > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted/30">
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${(currentPage / totalPages) * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
