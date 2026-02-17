/**
 * ContinueReadingSection Component
 *
 * Displays recently read manga in a horizontal scrolling carousel
 * with progress indicators
 */

import { useEffect, useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { BookOpen, Loader2, ChevronLeft, ChevronRight, X, Info } from 'lucide-react'
import { getContinueReadingWithDetails, removeFromContinueReadingManga, type ContinueReadingEntry } from '@/utils/tauri-commands'
import { useSettingsStore } from '@/store/settingsStore'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import { MangaDetailModal } from './MangaDetailModal'
import type { SearchResult } from '@/types/extension'
import { notifySuccess, notifyError } from '@/utils/notify'

interface ContinueReadingSectionProps {
  extensionId: string
}

export function ContinueReadingSection({ extensionId }: ContinueReadingSectionProps) {
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const [continueReading, setContinueReading] = useState<ContinueReadingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [selectedManga, setSelectedManga] = useState<SearchResult | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const loadContinueReading = async () => {
      try {
        const results = await getContinueReadingWithDetails(20)
        // Filter out NSFW content using genres and title keywords
        const filtered = filterNsfwContent(
          results,
          entry => entry.media.genres,
          nsfwFilter,
          entry => entry.media.title
        )
        setContinueReading(filtered)
      } catch (error) {
        console.error('Failed to load continue reading:', error)
      } finally {
        setLoading(false)
      }
    }

    loadContinueReading()
  }, [nsfwFilter])

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
    const isJikanEntry = entry.media.extension_id === 'jikan'

    navigate({
      to: '/read',
      search: {
        extensionId,
        mangaId: entry.media.id,
        chapterId: entry.chapter_id,
        ...(isJikanEntry ? { malId: entry.media.id } : {}),
      },
    })
  }

  const handleRemove = async (e: React.MouseEvent, mediaId: string, title: string) => {
    e.stopPropagation() // Prevent card click
    try {
      await removeFromContinueReadingManga(mediaId)
      setContinueReading(prev => prev.filter(entry => entry.media.id !== mediaId))
      notifySuccess('Removed', `Removed "${title}" from Continue Reading`)
    } catch (error) {
      console.error('Failed to remove from continue reading:', error)
      notifyError('Remove Failed', 'Failed to remove from Continue Reading')
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
    <div className="mb-8 overflow-visible">
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <BookOpen className="w-6 h-6 text-[var(--color-accent-primary)]" />
        Continue Reading
      </h2>

      {/* Carousel Container */}
      <div className="relative group/carousel overflow-visible">
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
          className="flex gap-4 overflow-x-auto overflow-y-visible scrollbar-hide scroll-smooth py-4 -my-4 px-4 -mx-4"
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
              <div key={entry.media.id} className="flex-shrink-0 w-[180px] group/card relative">
                {/* Invisible spacer that maintains flex position */}
                <div className="w-full">
                  <div className="aspect-[2/3]" />
                  <div className="h-12" /> {/* Space for title */}
                </div>

                {/* Actual card - positioned absolute so it can scale without affecting layout */}
                <div className="absolute inset-0 transition-all duration-300 ease-out origin-top group-hover/card:scale-110 group-hover/card:z-50">
                  {/* Cover Image */}
                  <button
                    onClick={() => handleContinueReading(entry)}
                    className="w-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)] rounded-md"
                  >
                    <div className="relative w-full aspect-[2/3] rounded-md overflow-hidden bg-[var(--color-bg-secondary)] shadow-lg group-hover/card:shadow-2xl group-hover/card:shadow-black/60 transition-shadow duration-300">
                      {media.cover_url ? (
                        <img
                          src={media.cover_url}
                          alt={media.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl">
                          📖
                        </div>
                      )}

                      {/* Progress badge - inside image at bottom */}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent pt-6 pb-2 px-2">
                        {entry.completed ? (
                          <>
                            <div className="flex justify-between items-center text-xs text-white">
                              <span className="font-semibold">Next: Ch. {entry.chapter_number + 1}</span>
                              <span className="text-emerald-400 font-medium">Completed</span>
                            </div>
                            <div className="mt-1.5 h-1 bg-white/20 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full w-full" />
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between items-center text-xs text-white">
                              <span className="font-semibold">Ch. {entry.chapter_number}</span>
                              <span className="text-white/70">{pageProgress}</span>
                            </div>
                            {entry.total_pages && (
                              <div className="mt-1.5 h-1 bg-white/20 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[var(--color-accent-primary)] rounded-full transition-all"
                                  style={{ width: `${(entry.current_page / entry.total_pages) * 100}%` }}
                                />
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Resume/Next overlay on hover */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity bg-black/50">
                        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-accent-primary)] rounded-lg">
                          <BookOpen className="w-5 h-5" />
                          <span className="text-sm font-bold">{entry.completed ? 'NEXT CHAPTER' : 'RESUME'}</span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Info button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedManga(media)
                    }}
                    className="absolute top-2 left-2 z-[60] p-1.5 rounded-full bg-black/70 hover:bg-[var(--color-accent-primary)] text-white opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-auto"
                    title="View Details"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                  {/* Remove button */}
                  <button
                    onClick={(e) => handleRemove(e, entry.media.id, entry.media.title)}
                    className="absolute top-2 right-2 z-[60] p-1.5 rounded-full bg-black/70 hover:bg-red-600 text-white opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-auto"
                    title="Remove from Continue Reading"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Title - Below Image */}
                <div className="mt-2 px-1">
                  <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">
                    {media.title}
                  </h3>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Manga Detail Modal */}
      {selectedManga && (
        <MangaDetailModal
          manga={selectedManga}
          extensionId={extensionId}
          onClose={() => setSelectedManga(null)}
        />
      )}
    </div>
  )
}
