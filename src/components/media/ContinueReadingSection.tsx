/**
 * ContinueReadingSection Component
 *
 * Displays recently read manga in a horizontal scrolling carousel
 * with progress indicators
 */

import { useEffect, useState, useRef } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { BookOpen, Loader2, ChevronLeft, ChevronRight, X, Info } from 'lucide-react'
import { getContinueReadingWithDetails, removeFromContinueReadingManga, type ContinueReadingEntry } from '@/utils/tauri-commands'
import { useSettingsStore } from '@/store/settingsStore'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import { MangaDetailModal } from './MangaDetailModal'
import type { SearchResult } from '@/types/extension'
import { notifySuccess, notifyError } from '@/utils/notify'
import { loadBundledMangaExtensions, resolveMangaExtensionId, type MangaExtensionIds } from '@/utils/manga-extensions'
import { useProxiedImage } from '@/hooks/useProxiedImage'

interface SelectedManga {
  manga: SearchResult
  extensionId: string
}

function ContinueReadingCardImage({ url, title }: { url?: string; title: string }) {
  const { src } = useProxiedImage(url || '')

  if (!src) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <BookOpen size={24} className="text-[var(--color-text-dim)]" />
      </div>
    )
  }

  return <img src={src} alt={title} className="w-full h-full object-cover" loading="lazy" />
}

export function ContinueReadingSection() {
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const [continueReading, setContinueReading] = useState<ContinueReadingEntry[]>([])
  const [extensionIds, setExtensionIds] = useState<Partial<MangaExtensionIds>>({})
  const [loading, setLoading] = useState(true)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [selectedManga, setSelectedManga] = useState<SelectedManga | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    loadBundledMangaExtensions()
      .then(setExtensionIds)
      .catch((error) => {
        console.error('Failed to load manga extensions:', error)
      })
  }, [])

  useEffect(() => {
    const loadContinueReading = async () => {
      try {
        const results = await getContinueReadingWithDetails(20)
        // Filter out NSFW content using genres and title keywords
        const filtered = filterNsfwContent(
          results,
          entry => entry.media.genres,
          nsfwFilter,
          entry => `${entry.media.title || ''} ${entry.media.description || ''}`
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
    const effectiveExtensionId = resolveMangaExtensionId(entry.media.extension_id, extensionIds)

    if (!effectiveExtensionId) {
      notifyError('Source unavailable', 'The manga source is still loading. Try again in a moment.')
      return
    }

    navigate({
      to: '/read',
      search: {
        extensionId: effectiveExtensionId,
        mangaId: entry.media.id,
        chapterId: entry.chapter_id,
        ...(isJikanEntry ? { malId: entry.media.id } : {}),
      },
    })
  }

  const handleRemove = async (
    e: React.MouseEvent,
    mediaId: string,
    title: string,
    coverUrl?: string
  ) => {
    e.stopPropagation() // Prevent card click
    try {
      await removeFromContinueReadingManga(mediaId)
      setContinueReading(prev => prev.filter(entry => entry.media.id !== mediaId))
      notifySuccess('Removed', `Removed "${title}" from Continue Reading`, {
        metadata: coverUrl
          ? {
              media_id: mediaId,
              thumbnail: coverUrl,
              image: coverUrl,
            }
          : {
              media_id: mediaId,
            },
      })
    } catch (error) {
      console.error('Failed to remove from continue reading:', error)
      notifyError('Remove Failed', 'Failed to remove from Continue Reading')
    }
  }

  if (loading) {
    return (
      <div className="mb-10">
        <h2 className="text-xl font-bold font-display mb-4 border-l-[3px] border-[var(--color-accent-primary)] pl-3">Continue Reading</h2>
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
    <div className="mb-10 overflow-visible">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold font-display border-l-[3px] border-[var(--color-accent-primary)] pl-3">Continue Reading</h2>
        <Link
          to="/library"
          className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-accent-light)] transition-colors"
        >
          See all
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        </Link>
      </div>

      {/* Carousel Container */}
      <div className="relative group/carousel overflow-visible">
        {/* Left Arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 glass rounded-full flex items-center justify-center shadow-[var(--shadow-md)] opacity-0 group-hover/carousel:opacity-100 transition-opacity -ml-2"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {/* Right Arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 glass rounded-full flex items-center justify-center shadow-[var(--shadow-md)] opacity-0 group-hover/carousel:opacity-100 transition-opacity -mr-2"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-5 h-5" />
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
            const media: SearchResult = {
              id: entry.media.id,
              title: entry.media.title,
              cover_url: entry.media.cover_url,
              description: entry.media.description,
              rating: entry.media.rating,
              year: entry.media.year,
              status: entry.media.status,
            }

            const pageProgress = entry.total_pages
              ? `${entry.current_page}/${entry.total_pages}`
              : `Page ${entry.current_page}`
            const progressPercent = entry.total_pages ? (entry.current_page / entry.total_pages) * 100 : 0

            return (
              <div key={entry.media.id} className="flex-shrink-0 w-[240px] group/card relative">
                <button
                  onClick={() => handleContinueReading(entry)}
                  className="w-full cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)] rounded-[var(--radius-md)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_20px_var(--color-accent-glow)]"
                >
                  {/* Card container */}
                  <div className="rounded-[var(--radius-md)] overflow-hidden bg-[var(--color-card)] shadow-[var(--shadow-card)]">
                    {/* 16:9 Thumbnail */}
                    <div className="relative w-full h-[135px] bg-[var(--color-panel)]">
                      {media.cover_url ? (
                        <ContinueReadingCardImage url={media.cover_url} title={media.title} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BookOpen size={24} className="text-[var(--color-text-dim)]" />
                        </div>
                      )}

                      {/* Hover read overlay */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 bg-[rgba(20,20,20,0.5)]">
                        <div className="w-[42px] h-[42px] rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center shadow-[0_0_30px_rgba(229,9,20,0.45)]">
                          <BookOpen size={18} className="text-white" />
                        </div>
                      </div>
                    </div>

                    {/* Card info panel */}
                    <div className="px-3 py-2.5 pb-3">
                      <h3 className="text-[0.875rem] font-semibold font-display text-white truncate mb-1">
                        {media.title}
                      </h3>
                      <p className="text-xs text-[var(--color-text-muted)] mb-2">
                        {entry.completed
                          ? `Next: Ch. ${entry.chapter_number + 1}`
                          : `Ch. ${entry.chapter_number}${entry.total_pages ? ` · ${pageProgress}` : ''}`
                        }
                      </p>
                      {/* Progress bar inside info panel */}
                      {!entry.completed && entry.total_pages != null && entry.total_pages > 0 && (
                        <div className="h-[3px] rounded-full bg-[var(--color-glass-border)] overflow-hidden">
                          <div
                            className="h-full rounded-full shadow-[0_0_8px_var(--color-accent-glow)]"
                            style={{ width: `${progressPercent}%`, background: 'var(--accent-gradient-h)' }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </button>

                {/* Info button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    const effectiveExtensionId = resolveMangaExtensionId(entry.media.extension_id, extensionIds)
                    if (!effectiveExtensionId) {
                      notifyError('Source unavailable', 'The manga source is still loading. Try again in a moment.')
                      return
                    }
                    setSelectedManga({ manga: media, extensionId: effectiveExtensionId })
                  }}
                  className="absolute top-2 left-2 z-[60] p-1.5 rounded-full glass text-white opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-auto"
                  title="View Details"
                >
                  <Info className="w-4 h-4" />
                </button>
                {/* Remove button */}
                <button
                  onClick={(e) => handleRemove(e, entry.media.id, entry.media.title, entry.media.cover_url)}
                  className="absolute top-2 right-2 z-[60] p-1.5 rounded-full glass hover:!bg-red-600/80 text-white opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-auto"
                  title="Remove from Continue Reading"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Manga Detail Modal */}
      {selectedManga && (
        <MangaDetailModal
          manga={selectedManga.manga}
          extensionId={selectedManga.extensionId}
          onClose={() => setSelectedManga(null)}
        />
      )}
    </div>
  )
}
