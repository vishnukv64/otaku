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
  readingDirection = 'ltr',
  showControls,
  className,
}: ReaderControlsProps) {
  if (!showControls) return null

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
            {hasPreviousChapter && (
              <button
                onClick={onPreviousChapter}
                className="p-2 rounded-md hover:bg-white/20 transition-colors"
                title="Previous Chapter"
              >
                <SkipBack className="w-5 h-5" />
              </button>
            )}
            <span className="text-sm font-medium">
              Chapter {currentChapterNumber || '-'}
            </span>
            {hasNextChapter && (
              <button
                onClick={onNextChapter}
                className="p-2 rounded-md hover:bg-white/20 transition-colors"
                title="Next Chapter"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            )}
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
              onClick={readingDirection === 'rtl' ? onNextPage : onPreviousPage}
              disabled={readingDirection === 'rtl' ? currentPage >= totalPages : currentPage <= 1}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-white transition-colors',
                (readingDirection === 'rtl' ? currentPage >= totalPages : currentPage <= 1)
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-white/20'
              )}
            >
              <ChevronLeft className="w-5 h-5" />
              <span className="text-sm hidden sm:inline">Previous</span>
            </button>

            <div className="text-white text-sm font-medium">
              Page {currentPage} of {totalPages}
            </div>

            <button
              onClick={readingDirection === 'rtl' ? onPreviousPage : onNextPage}
              disabled={readingDirection === 'rtl' ? currentPage <= 1 : currentPage >= totalPages}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-white transition-colors',
                (readingDirection === 'rtl' ? currentPage <= 1 : currentPage >= totalPages)
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-white/20'
              )}
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
