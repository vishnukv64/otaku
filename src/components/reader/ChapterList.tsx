/**
 * ChapterList - Chapter selector sidebar component
 * Styled with Netflix-inspired red and black accents
 */

import { useEffect, useRef } from 'react'
import { X, ChevronLeft, ChevronRight, Check, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Chapter } from '@/types/extension'

interface ChapterListProps {
  chapters: Chapter[]
  currentChapterId?: string
  currentChapterNumber?: number
  onChapterSelect: (chapterId: string) => void
  onClose: () => void
  isOpen: boolean
  readChapters?: Set<string> // Set of read chapter IDs
}

export function ChapterList({
  chapters,
  currentChapterId,
  currentChapterNumber,
  onChapterSelect,
  onClose,
  isOpen,
  readChapters = new Set(),
}: ChapterListProps) {
  const listContainerRef = useRef<HTMLDivElement>(null)
  const currentChapterRef = useRef<HTMLButtonElement>(null)

  // Sort chapters by number
  const sortedChapters = [...chapters].sort((a, b) => a.number - b.number)

  // Scroll to current chapter when the list opens
  useEffect(() => {
    if (isOpen && currentChapterRef.current && listContainerRef.current) {
      // Small delay to ensure the DOM is ready
      const timer = setTimeout(() => {
        currentChapterRef.current?.scrollIntoView({
          behavior: 'auto',
          block: 'center',
        })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  if (!isOpen) return null

  // Find current chapter index
  const currentIndex = sortedChapters.findIndex(ch => ch.id === currentChapterId)

  // Get prev/next chapters
  const prevChapter = currentIndex > 0 ? sortedChapters[currentIndex - 1] : null
  const nextChapter = currentIndex < sortedChapters.length - 1 ? sortedChapters[currentIndex + 1] : null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="absolute left-0 top-0 h-full w-80 bg-[var(--color-bg-primary)] border-r border-[var(--color-bg-hover)] shadow-2xl flex flex-col animate-in fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'slideInLeft 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-bg-hover)] bg-[var(--color-bg-secondary)]">
          <h2 className="text-lg font-bold flex items-center gap-2 text-white">
            <BookOpen className="w-5 h-5 text-[var(--color-accent-primary)]" />
            Chapters
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--color-bg-hover)] rounded-lg transition-colors text-[var(--color-text-secondary)] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick navigation */}
        <div className="flex items-center justify-between p-3 border-b border-[var(--color-bg-hover)] bg-[var(--color-bg-secondary)]/50">
          <button
            onClick={() => prevChapter && onChapterSelect(prevChapter.id)}
            disabled={!prevChapter}
            className={cn(
              'flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all',
              prevChapter
                ? 'hover:bg-[var(--color-accent-primary)] hover:text-white text-[var(--color-text-secondary)]'
                : 'text-[var(--color-text-muted)] cursor-not-allowed opacity-50'
            )}
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </button>

          <div className="flex flex-col items-center">
            <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Current</span>
            <span className="text-sm font-bold text-[var(--color-accent-primary)]">
              Ch. {currentChapterNumber || '-'}
            </span>
          </div>

          <button
            onClick={() => nextChapter && onChapterSelect(nextChapter.id)}
            disabled={!nextChapter}
            className={cn(
              'flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all',
              nextChapter
                ? 'hover:bg-[var(--color-accent-primary)] hover:text-white text-[var(--color-text-secondary)]'
                : 'text-[var(--color-text-muted)] cursor-not-allowed opacity-50'
            )}
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Chapter list */}
        <div ref={listContainerRef} className="flex-1 overflow-y-auto scrollbar-hide">
          <div className="p-2 space-y-1">
            {sortedChapters.map((chapter) => {
              const isCurrentChapter = chapter.id === currentChapterId
              const isRead = readChapters.has(chapter.id)

              return (
                <button
                  key={chapter.id}
                  ref={isCurrentChapter ? currentChapterRef : undefined}
                  onClick={() => onChapterSelect(chapter.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all group',
                    isCurrentChapter
                      ? 'bg-[var(--color-accent-primary)]/20 border-l-4 border-[var(--color-accent-primary)]'
                      : 'hover:bg-[var(--color-bg-hover)] border-l-4 border-transparent hover:border-[var(--color-accent-primary)]/50'
                  )}
                >
                  {/* Chapter number badge */}
                  <div className={cn(
                    'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold transition-colors',
                    isCurrentChapter
                      ? 'bg-[var(--color-accent-primary)] text-white'
                      : 'bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] group-hover:bg-[var(--color-accent-primary)]/30'
                  )}>
                    {chapter.number}
                  </div>

                  {/* Chapter info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'font-medium truncate transition-colors',
                        isCurrentChapter
                          ? 'text-white'
                          : isRead
                            ? 'text-[var(--color-text-muted)]'
                            : 'text-[var(--color-text-secondary)] group-hover:text-white'
                      )}>
                        Chapter {chapter.number}
                      </span>
                      {isRead && (
                        <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      )}
                      {isCurrentChapter && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[var(--color-accent-primary)] text-white rounded uppercase">
                          Reading
                        </span>
                      )}
                    </div>
                    {chapter.title && chapter.title !== `Chapter ${chapter.number}` && (
                      <p className="text-sm text-[var(--color-text-muted)] truncate mt-0.5">
                        {chapter.title}
                      </p>
                    )}
                    {chapter.releaseDate && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        {chapter.releaseDate}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer with chapter count */}
        <div className="p-3 border-t border-[var(--color-bg-hover)] bg-[var(--color-bg-secondary)]/50 text-center">
          <span className="text-sm text-[var(--color-text-muted)]">
            {sortedChapters.length} chapters
          </span>
          {readChapters.size > 0 && (
            <span className="text-sm text-[var(--color-text-muted)]">
              {' '} • {readChapters.size} read
            </span>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInLeft {
          from {
            transform: translateX(-100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}
