/**
 * ContinueWatchingSection Component
 *
 * Displays recently watched anime in a horizontal scrolling carousel
 * with progress indicators
 */

import { displayTitle } from '@/utils/mediaHelpers'
import { useEffect, useState, useRef } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { Play, Loader2, ChevronLeft, ChevronRight, X, Info, MoreHorizontal, SkipForward, Check, List } from 'lucide-react'
import { getContinueWatchingWithDetails, removeFromContinueWatching, saveWatchProgress, loadExtension, type ContinueWatchingEntry } from '@/utils/tauri-commands'
import { useSettingsStore } from '@/store/settingsStore'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import { MediaDetailModal } from './MediaDetailModal'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import type { SearchResult } from '@/types/extension'
import { notifySuccess, notifyError } from '@/utils/notify'
import { isMobile } from '@/utils/platform'
import { BottomSheet, SheetOption } from '@/components/ui/BottomSheet'

interface ContinueWatchingSectionProps {
  extensionId?: string
}

export function ContinueWatchingSection({ extensionId }: ContinueWatchingSectionProps) {
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const [continueWatching, setContinueWatching] = useState<ContinueWatchingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null)
  const [menuEntry, setMenuEntry] = useState<ContinueWatchingEntry | null>(null)
  const [allanimeExtId, setAllanimeExtId] = useState<string | null>(extensionId || null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!allanimeExtId) {
      loadExtension(ALLANIME_EXTENSION).then(meta => setAllanimeExtId(meta.id)).catch(() => {})
    }
  }, [allanimeExtId])

  useEffect(() => {
    const loadContinueWatching = async () => {
      try {
        const results = await getContinueWatchingWithDetails(20)
        // Filter out NSFW content using genres and title keywords
        const filtered = filterNsfwContent(
          results,
          entry => entry.media.genres,
          nsfwFilter,
          entry => entry.media.title
        )
        setContinueWatching(filtered)
      } catch (error) {
        console.error('Failed to load continue watching:', error)
      } finally {
        setLoading(false)
      }
    }

    loadContinueWatching()
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
  }, [continueWatching])

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

  const handleContinueWatching = (entry: ContinueWatchingEntry) => {
    // If episode is completed, don't pass episodeId - let watch route find next unwatched
    // Otherwise, resume the specific episode
    navigate({
      to: '/watch',
      search: entry.completed
        ? {
            malId: entry.media.id,
          }
        : {
            malId: entry.media.id,
            episodeId: entry.episode_id,
          },
    })
  }

  const handleRemove = async (e: React.MouseEvent, mediaId: string, title: string) => {
    e.stopPropagation() // Prevent card click
    const entry = continueWatching.find(cw => cw.media.id === mediaId)
    const cover = entry?.media.cover_url
    const meta = {
      metadata: {
        media_id: mediaId,
        ...(cover ? { thumbnail: cover, image: cover } : {}),
      },
    }
    try {
      await removeFromContinueWatching(mediaId)
      setContinueWatching(prev => prev.filter(entry => entry.media.id !== mediaId))
      notifySuccess('Removed', `Removed "${title}" from Continue Watching`, meta)
    } catch (error) {
      console.error('Failed to remove from continue watching:', error)
      notifyError('Remove Failed', 'Failed to remove from Continue Watching', meta)
    }
  }

  const toSearchResult = (entry: ContinueWatchingEntry): SearchResult => ({
    id: entry.media.id,
    title: entry.media.title,
    cover_url: entry.media.cover_url,
    description: entry.media.description,
    rating: entry.media.rating,
    year: entry.media.year,
    status: entry.media.status,
  })

  const playNext = (entry: ContinueWatchingEntry) =>
    navigate({ to: '/watch', search: { malId: entry.media.id } })

  const markWatched = async (entry: ContinueWatchingEntry) => {
    try {
      await saveWatchProgress(entry.media.id, entry.episode_id, entry.episode_number, entry.duration ?? 0, entry.duration ?? undefined, true)
      setContinueWatching(prev => prev.map(e => (e.media.id === entry.media.id ? { ...e, completed: true } : e)))
      notifySuccess('Marked watched', `EP ${entry.episode_number} of "${entry.media.title}"`)
    } catch (error) {
      console.error('Failed to mark watched:', error)
      notifyError('Failed', 'Could not mark as watched')
    }
  }

  if (loading) {
    return (
      <div className="mb-10">
        <h2 className="text-xl font-bold font-display mb-4 flex items-center gap-2 border-l-[3px] border-[var(--color-accent-primary)] pl-3 max-sm:border-l-0 max-sm:pl-0 max-sm:text-[19px]">
          Continue Watching
        </h2>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
        </div>
      </div>
    )
  }

  if (continueWatching.length === 0) {
    return null // Don't show section if no continue watching items
  }

  return (
    <div className="mb-10 overflow-visible">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold font-display border-l-[3px] border-[var(--color-accent-primary)] pl-3 max-sm:border-l-0 max-sm:pl-0 max-sm:text-[19px]">
          Continue Watching
        </h2>
        <Link
          to={isMobile() ? '/history' : '/library'}
          className="flex items-center gap-1 text-sm max-sm:min-h-[44px] max-sm:text-[13px] max-sm:text-[var(--color-text-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-light)] transition-colors"
        >
          {isMobile() ? 'History' : 'See all'}
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
          {continueWatching.map((entry) => {
            // Convert MediaEntry to SearchResult format
            const media: SearchResult = {
              id: entry.media.id,
              title: entry.media.title,
              cover_url: entry.media.cover_url,
              description: entry.media.description,
              rating: entry.media.rating,
              year: entry.media.year,
              status: entry.media.status,
            }

            const totalEpisodes = entry.media.episode_count
            const progressPercent = entry.duration ? (entry.progress_seconds / entry.duration) * 100 : 0

            return (
              <div key={entry.media.id} className="flex-shrink-0 w-[240px] group/card relative">
                <button
                  onClick={() => handleContinueWatching(entry)}
                  className="w-full cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)] rounded-[var(--radius-md)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_20px_var(--color-accent-glow)]"
                >
                  {/* Card container */}
                  <div className="rounded-[var(--radius-md)] overflow-hidden bg-[var(--color-card)] shadow-[var(--shadow-card)]">
                    {/* 16:9 Thumbnail */}
                    <div className="relative w-full h-[135px] bg-[var(--color-panel)]">
                      {media.cover_url ? (
                        <img
                          src={media.cover_url}
                          alt={displayTitle(media)}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Play size={24} className="text-[var(--color-text-dim)]" />
                        </div>
                      )}

                      {/* Hover play overlay */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 bg-[rgba(20,20,20,0.5)]">
                        <div className="w-[42px] h-[42px] rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center shadow-[0_0_30px_rgba(229,9,20,0.45)]">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                        </div>
                      </div>
                    </div>

                    {/* Card info panel */}
                    <div className="px-3 py-2.5 pb-3">
                      <h3 className="text-[0.875rem] font-semibold font-display text-white truncate mb-1">
                        {displayTitle(media)}
                      </h3>
                      <p className="text-xs text-[var(--color-text-muted)] mb-2">
                        {entry.completed
                          ? `Next: EP ${entry.episode_number + 1}`
                          : `EP ${entry.episode_number}${totalEpisodes ? ` of ${totalEpisodes}` : ''}`
                        }
                      </p>
                      {/* Progress bar inside info panel */}
                      {!entry.completed && entry.duration != null && entry.duration > 0 && (
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

                {isMobile() && (
                  <button
                    onClick={() => setMenuEntry(entry)}
                    aria-label={`More actions for ${displayTitle(media)}`}
                    className="absolute right-0 top-0 z-[60] flex h-11 w-11 items-center justify-center text-white"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60">
                      <MoreHorizontal size={18} />
                    </span>
                  </button>
                )}
                {/* Info button: hover on desktop, always shown on phones (no hover there) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedMedia(media)
                  }}
                  aria-label={`Details for ${displayTitle(media)}`}
                  className={
                    isMobile()
                      ? 'absolute left-0 top-0 z-[60] flex h-11 w-11 items-center justify-center text-white'
                      : 'absolute top-2 left-2 z-[60] p-1.5 rounded-full glass text-white opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-auto'
                  }
                  title="View Details"
                >
                  {isMobile() ? (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60">
                      <Info size={18} />
                    </span>
                  ) : (
                    <Info className="w-4 h-4" />
                  )}
                </button>
                {/* Remove button */}
                <button
                  onClick={(e) => handleRemove(e, entry.media.id, entry.media.title)}
                  className={`${isMobile() ? 'hidden ' : ''}absolute top-2 right-2 z-[60] p-1.5 rounded-full glass hover:!bg-red-600/80 text-white opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-auto`}
                  title="Remove from Continue Watching"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {menuEntry && (
        <BottomSheet isOpen onClose={() => setMenuEntry(null)} title={displayTitle(menuEntry.media)}>
          <SheetOption
            icon={<Play size={20} />}
            onClick={() => {
              handleContinueWatching(menuEntry)
              setMenuEntry(null)
            }}
          >
            {menuEntry.completed ? 'Resume' : `Resume EP ${menuEntry.episode_number}`}
          </SheetOption>
          <SheetOption
            icon={<SkipForward size={20} />}
            onClick={() => {
              playNext(menuEntry)
              setMenuEntry(null)
            }}
          >
            Play next
          </SheetOption>
          <SheetOption
            icon={<List size={20} />}
            onClick={() => {
              setSelectedMedia(toSearchResult(menuEntry))
              setMenuEntry(null)
            }}
          >
            Episodes &amp; details
          </SheetOption>
          <SheetOption
            icon={<Check size={20} />}
            disabled={menuEntry.completed}
            onClick={() => {
              void markWatched(menuEntry)
              setMenuEntry(null)
            }}
          >
            Mark watched
          </SheetOption>
          <SheetOption
            destructive
            icon={<X size={20} />}
            onClick={() => {
              void handleRemove({ stopPropagation: () => {} } as React.MouseEvent, menuEntry.media.id, menuEntry.media.title)
              setMenuEntry(null)
            }}
          >
            Remove from Continue Watching
          </SheetOption>
        </BottomSheet>
      )}

      {/* Media Detail Modal */}
      {selectedMedia && (
        <MediaDetailModal
          media={selectedMedia}
          extensionId={allanimeExtId || undefined}
          isOpen={true}
          onClose={() => setSelectedMedia(null)}
          onMediaChange={setSelectedMedia}
        />
      )}
    </div>
  )
}
