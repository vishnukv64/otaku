/**
 * ChapterList - Chapter sidebar sliding from the right
 * Matches read.html mock: 300px, right-side, with search + chapter items
 */

import { useEffect, useRef, useState } from 'react'
import { X, Search, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Chapter } from '@/types/extension'

interface ChapterListProps {
  chapters: Chapter[]
  currentChapterId?: string
  currentChapterNumber?: number
  onChapterSelect: (chapterId: string) => void
  onClose: () => void
  isOpen: boolean
  readChapters?: Set<string>
}

export function ChapterList({
  chapters,
  currentChapterId,
  onChapterSelect,
  onClose,
  isOpen,
  readChapters = new Set(),
}: ChapterListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Sort chapters descending (newest first, matching mock)
  const sortedChapters = [...chapters].sort((a, b) => b.number - a.number)

  // Filter by search
  const filteredChapters = searchQuery
    ? sortedChapters.filter(ch => {
        const q = searchQuery.toLowerCase()
        return (
          `ch. ${ch.number}`.includes(q) ||
          ch.title?.toLowerCase().includes(q) ||
          `chapter ${ch.number}`.includes(q)
        )
      })
    : sortedChapters

  // Scroll to current chapter when sidebar opens
  useEffect(() => {
    if (isOpen && currentRef.current) {
      const timer = setTimeout(() => {
        currentRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' })
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  return (
    <>
      {/* Overlay backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/50 z-[299] transition-opacity duration-300',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* Sidebar */}
      <div
        className={cn(
          'fixed right-0 top-0 bottom-0 w-[300px] z-[300]',
          'bg-[rgba(14,14,14,0.97)] backdrop-blur-[20px]',
          'border-l border-white/[0.08]',
          'flex flex-col',
          'transition-transform duration-[350ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/[0.08] flex-shrink-0">
          <span className="font-display font-bold text-base text-white">Chapters</span>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-[var(--radius-md)] border border-white/10 bg-white/[0.06] text-white/60 cursor-pointer flex items-center justify-center transition-all duration-[120ms] hover:bg-white/[0.12] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chapters..."
              className={cn(
                'w-full py-2 pl-[34px] pr-3 rounded-[var(--radius-md)]',
                'border border-white/10 bg-white/[0.05]',
                'text-white text-[0.8125rem] font-sans',
                'outline-none transition-all duration-[120ms]',
                'placeholder:text-[var(--color-text-muted)]',
                'focus:border-[rgba(229,9,20,0.4)] focus:bg-white/[0.08]'
              )}
            />
          </div>
        </div>

        {/* Chapter list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.1)_transparent]"
        >
          {filteredChapters.map((chapter) => {
            const isCurrent = chapter.id === currentChapterId
            const isRead = readChapters.has(chapter.id)

            return (
              <div
                key={chapter.id}
                ref={isCurrent ? currentRef : undefined}
                onClick={() => onChapterSelect(chapter.id)}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 cursor-pointer',
                  'transition-[background] duration-[120ms]',
                  'border-b border-white/[0.04]',
                  'hover:bg-white/[0.04]',
                  isCurrent && 'bg-[rgba(229,9,20,0.1)] border-l-[3px] border-l-[#e50914]',
                  !isCurrent && 'border-l-[3px] border-l-transparent'
                )}
              >
                {/* Chapter info */}
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    'font-semibold text-[0.8125rem] truncate',
                    isCurrent
                      ? 'text-[var(--color-accent-light)]'
                      : isRead
                        ? 'text-[var(--color-text-muted)]'
                        : 'text-white'
                  )}>
                    Ch. {chapter.number}
                    {chapter.title && chapter.title !== `Chapter ${chapter.number}` && (
                      <> - {chapter.title}</>
                    )}
                  </div>
                  {chapter.releaseDate && (
                    <div className="text-[0.65rem] text-[var(--color-text-dim)] mt-0.5">
                      {chapter.releaseDate}
                    </div>
                  )}
                </div>

                {/* Status */}
                <div className="flex-shrink-0 flex items-center gap-1">
                  {isCurrent ? (
                    <span className="text-[0.6rem] font-semibold text-[var(--color-accent-light)] px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[rgba(229,9,20,0.15)] border border-[rgba(229,9,20,0.25)]">
                      Reading
                    </span>
                  ) : isRead ? (
                    <Check className="w-3.5 h-3.5 text-[var(--color-green)]" strokeWidth={2.5} />
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
