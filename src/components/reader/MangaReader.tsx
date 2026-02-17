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
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import type { ChapterImage, Chapter } from '@/types/extension'
import { useProxiedImage } from '@/hooks/useProxiedImage'
import { useMobileLayout } from '@/hooks/useMobileLayout'

import { PageView } from './PageView'
import { VerticalScrollView } from './VerticalScrollView'
import { ReaderControls } from './ReaderControls'
import { ReaderSettings } from './ReaderSettings'
import { ChapterList } from './ChapterList'

/** Sub-component for double-page mode images that proxies remote URLs */
function DoublePageImage({
  image,
  fitMode,
  zoom,
  onClick,
}: {
  image: ChapterImage
  fitMode: string
  zoom: number
  onClick: () => void
}) {
  const { src, loading, error } = useProxiedImage(image.url)

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ width: 'calc(50vw - 1rem)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !src) return null

  return (
    <div className="h-full flex items-center justify-center">
      <img
        src={src}
        alt={`Page ${image.page}`}
        className="select-none"
        style={{
          maxHeight: fitMode === 'original' ? 'none' : '100%',
          maxWidth: fitMode === 'original' ? 'none' : 'calc(50vw - 1rem)',
          width: fitMode === 'width' ? 'calc(50vw - 1rem)' : 'auto',
          height: fitMode === 'height' ? '100%' : 'auto',
          objectFit: 'contain' as const,
          transform: `scale(${zoom})`,
          transformOrigin: 'center',
        }}
        draggable={false}
        onClick={onClick}
      />
    </div>
  )
}

interface MangaReaderProps {
  images: ChapterImage[]
  mangaId?: string
  chapterId?: string
  _mangaTitle?: string // For display purposes (future use)
  _chapterTitle?: string // For display purposes (future use)
  currentChapter?: number
  _totalChapters?: number
  hasNextChapter?: boolean
  hasPreviousChapter?: boolean
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
  // _totalChapters - intentionally unused, kept for API compatibility
  hasNextChapter = false,
  hasPreviousChapter = false,
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
  const { refresh: refreshMediaStatus } = useMediaStatusContext()
  const { isMobile: mobile } = useMobileLayout()

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

  // Check if we can navigate to adjacent chapters (use props passed from parent)
  const canGoToPreviousChapter = !!(onPreviousChapter && hasPreviousChapter)
  const canGoToNextChapter = !!(onNextChapter && hasNextChapter)

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

  // Fullscreen handling - defined before keyboard effect that uses it
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen()
      setFullscreen(true)
    } else {
      document.exitFullscreen()
      setFullscreen(false)
    }
  }, [setFullscreen])

  // Initialize reader state
  useEffect(() => {
    setTotalPages(images.length)
    setCurrentPage(initialPage)
    setIsLoading(false)
  }, [images, initialPage, setTotalPages, setCurrentPage])

  // Track if we've marked this chapter as completed (to avoid multiple refreshes)
  const [wasMarkedComplete, setWasMarkedComplete] = useState(false)

  // Reset completion tracking when chapter changes
  useEffect(() => {
    setWasMarkedComplete(false)
  }, [chapterId])

  // Save reading progress when page changes
  useEffect(() => {
    // Check for undefined/null explicitly (not !currentChapter, which would be true for chapter 0)
    if (!mangaId || !chapterId || currentChapter === undefined || currentChapter === null) return
    if (totalPages === 0) return // Don't save if no pages loaded yet

    const isCompleted = currentPage >= totalPages * (settings.markReadThreshold / 100)

    const saveProgress = async () => {
      try {
        await saveReadingProgress(
          mangaId,
          chapterId,
          currentChapter,
          currentPage,
          totalPages,
          isCompleted
        )

        // Refresh media status when chapter is marked as completed (only once per chapter)
        if (isCompleted && !wasMarkedComplete) {
          setWasMarkedComplete(true)
          refreshMediaStatus()
        }
      } catch (error) {
        console.error('Failed to save reading progress:', error)
      }
    }

    // Debounce save to avoid too many writes
    const timeoutId = setTimeout(saveProgress, 500) // Reduced to 500ms for faster saves
    return () => clearTimeout(timeoutId)
  }, [mangaId, chapterId, currentChapter, currentPage, totalPages, settings.markReadThreshold, wasMarkedComplete, refreshMediaStatus])

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

      // Refresh media status when leaving reader so badges update
      refreshMediaStatus()
    }
  }, [refreshMediaStatus]) // Include refreshMediaStatus in deps

  // On mobile, only allow single and webtoon modes
  const effectiveReadingMode = mobile
    ? (settings.readingMode === 'double' || settings.readingMode === 'vertical' ? 'single' : settings.readingMode)
    : settings.readingMode

  // Check if current mode is vertical scroll (webtoon or vertical)
  const isVerticalScrollMode = effectiveReadingMode === 'vertical' || effectiveReadingMode === 'webtoon'

  // Note: Image preloading for single/double page modes is handled by the
  // useProxiedImage hook in each component. The hook proxies remote images
  // through the Rust backend (adding required Referer headers), so native
  // browser preloading via `new Image()` would not work for remote URLs.

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
          // In vertical/webtoon mode, don't intercept arrow keys - let browser handle scroll
          if (isVerticalScrollMode) break
          if (settings.readingDirection === 'rtl') {
            handleNextPage()
          } else {
            handlePreviousPage()
          }
          break
        case 'ArrowRight':
          // In vertical/webtoon mode, don't intercept arrow keys - let browser handle scroll
          if (isVerticalScrollMode) break
          if (settings.readingDirection === 'rtl') {
            handlePreviousPage()
          } else {
            handleNextPage()
          }
          break
        case 'ArrowUp':
          // In vertical/webtoon mode, don't intercept arrow keys - let browser handle scroll
          if (isVerticalScrollMode) break
          handlePreviousPage()
          break
        case 'ArrowDown':
          // In vertical/webtoon mode, don't intercept arrow keys - let browser handle scroll
          if (isVerticalScrollMode) break
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
        case 'M': {
          // Cycle through reading modes
          const modes = ['single', 'double', 'vertical', 'webtoon'] as const
          const currentIndex = modes.indexOf(settings.readingMode)
          const nextMode = modes[(currentIndex + 1) % modes.length]
          useReaderStore.getState().setReadingMode(nextMode)
          break
        }
        case 'n':
        case 'N':
          if (canGoToNextChapter && onNextChapter) {
            onNextChapter()
          }
          break
        case 'p':
        case 'P':
          if (canGoToPreviousChapter && onPreviousChapter) {
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
    canGoToNextChapter,
    canGoToPreviousChapter,
    handleNextPage,
    handlePreviousPage,
    setCurrentPage,
    setShowControls,
    onNextChapter,
    onPreviousChapter,
    onGoBack,
    toggleFullscreen,
    isVerticalScrollMode,
  ])

  // Swipe gesture navigation for mobile (horizontal swipe = page turn)
  useEffect(() => {
    if (!mobile || isVerticalScrollMode) return
    const container = containerRef.current
    if (!container) return

    let startX = 0
    const onTouchStart = (e: TouchEvent) => { startX = e.touches[0].clientX }
    const onTouchEnd = (e: TouchEvent) => {
      const deltaX = e.changedTouches[0].clientX - startX
      if (Math.abs(deltaX) < 50) return // ignore small swipes
      if (settings.readingDirection === 'rtl') {
        deltaX > 0 ? handleNextPage() : handlePreviousPage()
      } else {
        deltaX < 0 ? handleNextPage() : handlePreviousPage()
      }
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchend', onTouchEnd)
    }
  }, [mobile, isVerticalScrollMode, settings.readingDirection, handleNextPage, handlePreviousPage])

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

  // Sync fullscreen state with document
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
      canGoToNextChapter &&
      onNextChapter
    ) {
      // Add a small delay before advancing
      const timeoutId = setTimeout(() => {
        onNextChapter()
      }, 1500)
      return () => clearTimeout(timeoutId)
    }
  }, [currentPage, totalPages, settings.autoAdvanceChapter, onNextChapter, canGoToNextChapter])

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

    switch (effectiveReadingMode) {
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

      case 'double': {
        // Show two pages side by side
        const leftPage = settings.readingDirection === 'rtl'
          ? images.find(img => img.page === currentPage + 1)
          : currentImage
        const rightPage = settings.readingDirection === 'rtl'
          ? currentImage
          : images.find(img => img.page === currentPage + 1)

        return (
          <div className={cn(
            'flex-1 flex items-center justify-center gap-2 p-2',
            settings.fitMode === 'original' ? 'overflow-auto' : 'overflow-hidden'
          )}>
            {leftPage && (
              <DoublePageImage
                image={leftPage}
                fitMode={settings.fitMode}
                zoom={settings.zoom}
                onClick={() => handlePageClick('left')}
              />
            )}
            {rightPage && (
              <DoublePageImage
                image={rightPage}
                fitMode={settings.fitMode}
                zoom={settings.zoom}
                onClick={() => handlePageClick('right')}
              />
            )}
          </div>
        )
      }

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
        hasNextChapter={hasNextChapter}
        hasPreviousChapter={hasPreviousChapter}
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
        readingMode={settings.readingMode}
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
