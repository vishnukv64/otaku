/**
 * ReaderControls - Bottom/overlay controls for the manga reader
 */

import {
  ChevronLeft,
  ChevronRight,
  Settings,
  List,
  Maximize,
  Minimize,
  Home,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageSlider } from './PageSlider'

interface ReaderControlsProps {
  // Page state
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  onPreviousPage: () => void
  onNextPage: () => void

  // Chapter state
  currentChapterNumber?: number
  hasNextChapter: boolean
  hasPreviousChapter: boolean
  onNextChapter: () => void
  onPreviousChapter: () => void

  // UI state
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onOpenSettings: () => void
  onOpenChapterList: () => void
  onGoBack: () => void

  // Display options
  readingMode?: 'single' | 'double' | 'vertical' | 'webtoon'
  readingDirection?: 'ltr' | 'rtl'
  showControls: boolean
  className?: string
}

export function ReaderControls({
  currentPage,
  totalPages,
  onPageChange,
  onPreviousPage,
  onNextPage,
  currentChapterNumber,
  hasNextChapter,
  hasPreviousChapter,
  onNextChapter,
  onPreviousChapter,
  isFullscreen,
  onToggleFullscreen,
  onOpenSettings,
  onOpenChapterList,
  onGoBack,
  readingMode = 'single',
  readingDirection = 'ltr',
  showControls,
  className,
}: ReaderControlsProps) {
  if (!showControls) return null

  // In vertical/webtoon mode, page buttons are disabled (user scrolls instead)
  const isScrollMode = readingMode === 'vertical' || readingMode === 'webtoon'

  return (
    <>
      {/* Top bar */}
      <div
        className={cn(
          'absolute top-0 left-0 right-0 z-40',
          'bg-gradient-to-b from-black/80 to-transparent',
          'transition-opacity duration-300',
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none',
          className
        )}
      >
        <div className="flex items-center justify-between p-4">
          {/* Left: Back button */}
          <button
            onClick={onGoBack}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-white hover:bg-white/20 transition-colors"
          >
            <Home className="w-5 h-5" />
            <span className="text-sm font-medium hidden sm:inline">Exit</span>
          </button>

          {/* Center: Chapter info */}
          <div className="flex items-center gap-4 text-white">
            <button
              onClick={hasPreviousChapter ? onPreviousChapter : undefined}
              disabled={!hasPreviousChapter}
              className={cn(
                'p-2 rounded-md transition-colors',
                hasPreviousChapter
                  ? 'hover:bg-white/20'
                  : 'opacity-40 cursor-not-allowed'
              )}
              title={hasPreviousChapter ? 'Previous Chapter' : 'No previous chapter'}
            >
              <SkipBack className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium">
              Chapter {currentChapterNumber || '-'}
            </span>
            <button
              onClick={hasNextChapter ? onNextChapter : undefined}
              disabled={!hasNextChapter}
              className={cn(
                'p-2 rounded-md transition-colors',
                hasNextChapter
                  ? 'hover:bg-white/20'
                  : 'opacity-40 cursor-not-allowed'
              )}
              title={hasNextChapter ? 'Next Chapter' : 'No next chapter'}
            >
              <SkipForward className="w-5 h-5" />
            </button>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenChapterList}
              className="p-2 rounded-md text-white hover:bg-white/20 transition-colors"
              title="Chapter List"
            >
              <List className="w-5 h-5" />
            </button>
            <button
              onClick={onOpenSettings}
              className="p-2 rounded-md text-white hover:bg-white/20 transition-colors"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={onToggleFullscreen}
              className="p-2 rounded-md text-white hover:bg-white/20 transition-colors"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize className="w-5 h-5" />
              ) : (
                <Maximize className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 z-40',
          'bg-gradient-to-t from-black/80 to-transparent',
          'transition-opacity duration-300',
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        <div className="p-4 space-y-3">
          {/* Page slider */}
          <PageSlider
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={onPageChange}
            direction={readingDirection}
            className="text-white"
          />

          {/* Page navigation buttons */}
          <div className="flex items-center justify-between">
            <button
              onClick={isScrollMode ? undefined : (readingDirection === 'rtl' ? onNextPage : onPreviousPage)}
              disabled={isScrollMode || (readingDirection === 'rtl' ? currentPage >= totalPages : currentPage <= 1)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-white transition-colors',
                isScrollMode || (readingDirection === 'rtl' ? currentPage >= totalPages : currentPage <= 1)
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-white/20'
              )}
              title={isScrollMode ? 'Scroll to navigate' : 'Previous page'}
            >
              <ChevronLeft className="w-5 h-5" />
              <span className="text-sm hidden sm:inline">Previous</span>
            </button>

            <div className="text-white text-sm font-medium flex flex-col items-center">
              <span>Page {currentPage} of {totalPages}</span>
              {isScrollMode && (
                <span className="text-xs text-white/60">Scroll to read</span>
              )}
            </div>

            <button
              onClick={isScrollMode ? undefined : (readingDirection === 'rtl' ? onPreviousPage : onNextPage)}
              disabled={isScrollMode || (readingDirection === 'rtl' ? currentPage <= 1 : currentPage >= totalPages)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-white transition-colors',
                isScrollMode || (readingDirection === 'rtl' ? currentPage <= 1 : currentPage >= totalPages)
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-white/20'
              )}
              title={isScrollMode ? 'Scroll to navigate' : 'Next page'}
            >
              <span className="text-sm hidden sm:inline">Next</span>
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
