/**
 * ReaderControls - Top nav bar + bottom controls for the manga reader
 * Matches read.html mock exactly:
 *   Top: back button | title + chapter info | action buttons (fullscreen, bookmark, chapters, settings)
 *   Bottom: progress bar + [prev chapter | page nav + indicator | mode pills | next chapter]
 */

import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Bookmark,
  List,
  Settings,
  BookOpen,
  AlignVerticalSpaceAround,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Icon button style matching mock: 36x36, radius-md, glass border/bg
const iconBtnClass =
  'w-9 h-9 rounded-[var(--radius-md)] border border-white/10 bg-white/[0.06] text-white/70 cursor-pointer flex items-center justify-center transition-all duration-[120ms] hover:bg-white/[0.12] hover:text-white flex-shrink-0'

// Control button style for bottom bar: small padded, radius-md, glass
const ctrlBtnClass =
  'flex items-center gap-[5px] px-3 py-1.5 rounded-[var(--radius-md)] border border-white/10 bg-white/[0.06] text-white/60 text-xs font-medium cursor-pointer transition-all duration-[120ms] whitespace-nowrap hover:bg-white/[0.12] hover:text-white'

// Icon-only control button for bottom bar: 32x32
const ctrlBtnIconClass =
  'w-8 h-8 p-0 flex items-center justify-center rounded-[var(--radius-md)] border border-white/10 bg-white/[0.06] text-white/60 cursor-pointer transition-all duration-[120ms] hover:bg-white/[0.12] hover:text-white'

type ReadingMode = 'single' | 'double' | 'vertical' | 'webtoon'

interface ReaderControlsProps {
  // Page state
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  onPreviousPage: () => void
  onNextPage: () => void

  // Chapter state
  currentChapterNumber?: number
  chapterTitle?: string
  mangaTitle?: string
  hasNextChapter: boolean
  hasPreviousChapter: boolean
  nextChapterNumber?: number
  previousChapterNumber?: number
  onNextChapter: () => void
  onPreviousChapter: () => void

  // UI state
  isFullscreen: boolean
  isBookmarked?: boolean
  onToggleFullscreen: () => void
  onToggleBookmark?: () => void
  onOpenSettings: () => void
  onOpenChapterList: () => void
  onGoBack: () => void

  // Display options
  readingMode?: ReadingMode
  onReadingModeChange?: (mode: ReadingMode) => void
  showControls: boolean
  className?: string
}

export function ReaderControls({
  currentPage,
  totalPages,
  onPreviousPage,
  onNextPage,
  currentChapterNumber,
  chapterTitle,
  mangaTitle,
  hasNextChapter,
  hasPreviousChapter,
  nextChapterNumber,
  previousChapterNumber,
  onNextChapter,
  onPreviousChapter,
  isFullscreen,
  isBookmarked = false,
  onToggleFullscreen,
  onToggleBookmark,
  onOpenSettings,
  onOpenChapterList,
  onGoBack,
  readingMode = 'vertical',
  onReadingModeChange,
}: ReaderControlsProps) {
  return (
    <>
      {/* ── Top Bar ──────────────────────────────────────── */}
      <div
        className={cn(
          'fixed top-0 left-0 right-0 h-14 z-[200]',
          'flex items-center px-5 gap-3',
          'bg-[rgba(10,10,10,0.92)] backdrop-blur-[12px]',
          'border-b border-white/[0.08]',
          'transition-all duration-[350ms] ease-out'
        )}
      >
        {/* Back button */}
        <button
          onClick={onGoBack}
          className={iconBtnClass}
          title="Back to details"
        >
          <ChevronLeft className="w-[18px] h-[18px]" />
        </button>

        {/* Title + chapter info */}
        <div className="flex-1 min-w-0">
          <div className="font-display font-semibold text-[0.9375rem] text-white truncate">
            {mangaTitle || 'Manga'}
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            Chapter {currentChapterNumber || '-'}
            {chapterTitle && (
              <span className="text-[var(--color-accent-light)]"> &middot; {chapterTitle}</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onToggleFullscreen}
            className={iconBtnClass}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <Minimize className="w-[18px] h-[18px]" />
            ) : (
              <Maximize className="w-[18px] h-[18px]" />
            )}
          </button>
          {onToggleBookmark && (
            <button
              onClick={onToggleBookmark}
              className={cn(
                iconBtnClass,
                isBookmarked && 'text-[var(--color-accent-light)] border-[rgba(229,9,20,0.3)] bg-[rgba(229,9,20,0.1)]'
              )}
              title="Bookmark"
            >
              <Bookmark className="w-[18px] h-[18px]" fill={isBookmarked ? 'currentColor' : 'none'} />
            </button>
          )}
          <button
            onClick={onOpenChapterList}
            className={iconBtnClass}
            title="Chapter list"
          >
            <List className="w-[18px] h-[18px]" />
          </button>
          <button
            onClick={onOpenSettings}
            className={iconBtnClass}
            title="Settings"
          >
            <Settings className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>

      {/* ── Bottom Controls Bar ──────────────────────────── */}
      <div
        className={cn(
          'fixed bottom-0 left-0 right-0 z-[200]',
          'bg-[rgba(10,10,10,0.92)] backdrop-blur-[12px]',
          'border-t border-white/[0.08]',
          'transition-all duration-[350ms] ease-out'
        )}
      >
        {/* Controls inner */}
        <div className="flex items-center px-4 py-2.5 gap-2">
          {/* Left: Previous chapter + page nav */}
          <div className="flex items-center gap-1.5 flex-1 justify-start">
            <button
              onClick={hasPreviousChapter ? onPreviousChapter : undefined}
              className={cn(ctrlBtnClass, !hasPreviousChapter && 'opacity-30 pointer-events-none')}
            >
              <ChevronLeft className="w-3 h-3" strokeWidth={2.5} />
              {hasPreviousChapter && previousChapterNumber
                ? `Ch. ${previousChapterNumber}`
                : 'Prev'}
            </button>
            {(() => {
              const isScrollMode = readingMode === 'vertical' || readingMode === 'webtoon'
              return (
                <>
                  <button
                    onClick={onPreviousPage}
                    disabled={isScrollMode || currentPage <= 1}
                    className={cn(ctrlBtnIconClass, (isScrollMode || currentPage <= 1) && 'opacity-30 pointer-events-none')}
                    title="Previous page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className={cn('font-mono-code text-xs whitespace-nowrap px-2', isScrollMode ? 'text-white/30' : 'text-white/50')}>
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={onNextPage}
                    disabled={isScrollMode || currentPage >= totalPages}
                    className={cn(ctrlBtnIconClass, (isScrollMode || currentPage >= totalPages) && 'opacity-30 pointer-events-none')}
                    title="Next page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </>
              )
            })()}
          </div>

          {/* Center: Reading mode pills */}
          <div className="flex-shrink-0">
            <div className="flex items-center gap-0.5 bg-white/[0.04] border border-white/[0.08] rounded-[var(--radius-lg)] p-[3px]">
              <ModePill
                active={readingMode === 'vertical' || readingMode === 'webtoon'}
                onClick={() => onReadingModeChange?.('vertical')}
                title="Vertical Scroll"
              >
                <AlignVerticalSpaceAround className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="hidden sm:inline">Vertical</span>
              </ModePill>
              <ModePill
                active={readingMode === 'single'}
                onClick={() => onReadingModeChange?.('single')}
                title="Single Page"
              >
                {/* Single page icon (rect) */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                  <rect x="5" y="2" width="14" height="20" rx="2"/>
                </svg>
                <span className="hidden sm:inline">Page</span>
              </ModePill>
              <ModePill
                active={readingMode === 'double'}
                onClick={() => onReadingModeChange?.('double')}
                title="Double Page"
              >
                <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="hidden sm:inline">Double</span>
              </ModePill>
            </div>
          </div>

          {/* Right: Next chapter */}
          <div className="flex items-center gap-1.5 flex-1 justify-end">
            <button
              onClick={hasNextChapter ? onNextChapter : undefined}
              className={cn(ctrlBtnClass, !hasNextChapter && 'opacity-30 pointer-events-none')}
            >
              {hasNextChapter && nextChapterNumber
                ? `Ch. ${nextChapterNumber}`
                : 'Next'}
              <ChevronRight className="w-3 h-3" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/** Individual reading mode pill button */
function ModePill({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center gap-[5px] px-2.5 py-[5px] rounded-[var(--radius-md)]',
        'border border-transparent bg-transparent text-white/45 text-[0.7rem] font-medium',
        'cursor-pointer transition-all duration-[120ms] whitespace-nowrap',
        'hover:text-white/80',
        active && 'bg-[#e50914] text-white border-[#e50914] shadow-[0_0_10px_rgba(229,9,20,0.35)]'
      )}
    >
      {children}
    </button>
  )
}
