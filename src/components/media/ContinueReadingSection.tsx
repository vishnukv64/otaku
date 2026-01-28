/**
 * ContinueReadingSection Component
 *
 * Displays recently read manga in a horizontal scrolling carousel
 * with progress indicators
 */

import { useEffect, useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { BookOpen, Loader2, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { getContinueReadingWithDetails, removeFromContinueReadingManga, type ContinueReadingEntry } from '@/utils/tauri-commands'
import { MediaCard } from './MediaCard'
import type { SearchResult } from '@/types/extension'
import toast from 'react-hot-toast'

interface ContinueReadingSectionProps {
  extensionId: string
}

export function ContinueReadingSection({ extensionId }: ContinueReadingSectionProps) {
  const [continueReading, setContinueReading] = useState<ContinueReadingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const loadContinueReading = async () => {
      try {
        const results = await getContinueReadingWithDetails(20)
        setContinueReading(results)
      } catch (error) {
        console.error('Failed to load continue reading:', error)
      } finally {
        setLoading(false)
      }
    }

    loadContinueReading()
  }, [])

  // Check scroll position and update arrow visibility
  const checkScrollPosition = () => {
    const container = scrollContainerRef.current
    if (!container) return

    setCanScrollLeft(container.scrollLeft > 0)
    setCanScrollRight(
      container.scrollLeft < container.scrollWidth - container.clientWidth - 10
    )
  }

  useEffect(() => {
    checkScrollPosition()
    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener('scroll', checkScrollPosition)
      window.addEventListener('resize', checkScrollPosition)
    }
    return () => {
      container?.removeEventListener('scroll', checkScrollPosition)
      window.removeEventListener('resize', checkScrollPosition)
    }
  }, [continueReading])

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current
    if (!container) return

    const cardWidth = 200 // approximate card width + gap
    const scrollAmount = cardWidth * 3 // scroll 3 cards at a time
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    })
  }

  const handleContinueReading = (entry: ContinueReadingEntry) => {
    navigate({
      to: '/read',
      search: {
        extensionId,
        mangaId: entry.media.id,
        chapterId: entry.chapter_id,
      },
    })
  }

  const handleRemove = async (e: React.MouseEvent, mediaId: string, title: string) => {
    e.stopPropagation() // Prevent card click
    try {
      await removeFromContinueReadingManga(mediaId)
      setContinueReading(prev => prev.filter(entry => entry.media.id !== mediaId))
      toast.success(`Removed "${title}" from Continue Reading`)
    } catch (error) {
      console.error('Failed to remove from continue reading:', error)
      toast.error('Failed to remove from Continue Reading')
    }
  }

  if (loading) {
    return (
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-[var(--color-accent-primary)]" />
          Continue Reading
        </h2>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
        </div>
      </div>
    )
  }

  if (continueReading.length === 0) {
    return null // Don't show section if no continue reading items
  }

  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <BookOpen className="w-6 h-6 text-[var(--color-accent-primary)]" />
        Continue Reading
      </h2>

      {/* Carousel Container */}
      <div className="relative group/carousel">
        {/* Left Arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-black/80 hover:bg-black rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-opacity -ml-2"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* Right Arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-black/80 hover:bg-black rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-opacity -mr-2"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {/* Scrollable Container */}
        <div
          ref={scrollContainerRef}
          className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth pb-2"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {continueReading.map((entry) => {
            // Convert MediaEntry to SearchResult format for MediaCard
            const media: SearchResult = {
              id: entry.media.id,
              title: entry.media.title,
              cover_url: entry.media.cover_url,
              description: entry.media.description,
              rating: entry.media.rating,
              year: entry.media.year,
              status: entry.media.status,
            }

            // Calculate page progress for display
            const pageProgress = entry.total_pages
              ? `${entry.current_page}/${entry.total_pages}`
              : `Page ${entry.current_page}`

            return (
              <div key={entry.media.id} className="flex-shrink-0 w-[180px] relative group/card">
                <MediaCard
                  media={media}
                  onClick={() => handleContinueReading(entry)}
                />
                {/* Progress badge */}
                <div className="absolute bottom-2 left-2 right-2 bg-black/80 rounded px-2 py-1 text-xs text-white">
                  <div className="flex justify-between items-center">
                    <span>Ch. {entry.chapter_number}</span>
                    <span className="text-[var(--color-text-muted)]">{pageProgress}</span>
                  </div>
                  {entry.total_pages && (
                    <div className="mt-1 h-1 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--color-accent-primary)] rounded-full transition-all"
                        style={{ width: `${(entry.current_page / entry.total_pages) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
                {/* Remove button */}
                <button
                  onClick={(e) => handleRemove(e, entry.media.id, entry.media.title)}
                  className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-black/70 hover:bg-red-600 text-white opacity-0 group-hover/card:opacity-100 transition-opacity"
                  title="Remove from Continue Reading"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
