/**
 * MediaCarousel Component
 *
 * Horizontal scrolling carousel for media cards.
 * Uses Embla Carousel for smooth scrolling with touch support.
 * Respects grid density setting from settings store.
 * Shows status badges for library, favorites, and watch/read progress.
 */

import { useCallback } from 'react'
import { isMobile } from '@/utils/platform'
import { Link } from '@tanstack/react-router'
import useEmblaCarousel from 'embla-carousel-react'
import { WheelGesturesPlugin } from 'embla-carousel-wheel-gestures'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MediaCard, MediaCardSkeleton } from './MediaCard'
import { useSettingsStore } from '@/store/settingsStore'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import type { SearchResult } from '@/types/extension'

interface MediaCarouselProps {
  title: string
  items: SearchResult[]
  loading?: boolean
  onItemClick?: (item: SearchResult) => void
  /** Phone: inline row error with Retry (mock: home.html) */
  error?: string | null
  onRetry?: () => void
  /** Phone offline: row is greyed and not tappable */
  disabled?: boolean
  /** When true, displays rank numbers (1, 2, 3...) on each card */
  showRank?: boolean
  /** Optional "See all" link href */
  seeAllHref?: string
  /** Optional "See all" link text (default: "See all") */
  seeAllText?: string
}

// Flex-basis classes for carousel items based on grid density
// These calculate the width of each item minus the gap
const carouselItemClasses = {
  // Compact: More items visible (matches grid: 3 -> 4 -> 6 -> 8 columns)
  compact: 'flex-[0_0_calc(33.333%-0.5rem)] sm:flex-[0_0_calc(25%-0.5625rem)] md:flex-[0_0_calc(16.666%-0.625rem)] lg:flex-[0_0_calc(12.5%-0.656rem)] 3xl:flex-[0_0_calc(10%-0.675rem)] 4xl:flex-[0_0_calc(8.333%-0.69rem)] 5xl:flex-[0_0_calc(7.143%-0.7rem)]',
  // Comfortable: Medium density (matches grid: 2 -> 3 -> 4 -> 5 -> 6 columns)
  comfortable: 'flex-[0_0_calc(50%-0.375rem)] sm:flex-[0_0_calc(33.333%-0.5rem)] md:flex-[0_0_calc(25%-0.5625rem)] lg:flex-[0_0_calc(20%-0.6rem)] xl:flex-[0_0_calc(16.666%-0.625rem)] 3xl:flex-[0_0_calc(12.5%-0.656rem)] 4xl:flex-[0_0_calc(10%-0.675rem)] 5xl:flex-[0_0_calc(8.333%-0.69rem)]',
  // Spacious: Fewer, larger items (matches grid: 2 -> 3 -> 4 -> 5 columns with larger gap)
  spacious: 'flex-[0_0_calc(50%-0.5rem)] sm:flex-[0_0_calc(33.333%-0.667rem)] md:flex-[0_0_calc(25%-0.75rem)] lg:flex-[0_0_calc(20%-0.8rem)] 3xl:flex-[0_0_calc(16.666%-0.833rem)] 4xl:flex-[0_0_calc(12.5%-0.875rem)] 5xl:flex-[0_0_calc(10%-0.9rem)]',
}

// Gap classes based on density
const carouselGapClasses = {
  compact: 'gap-2',
  comfortable: 'gap-3',
  spacious: 'gap-4',
}

// Skeleton grid classes based on density
const skeletonGridClasses = {
  compact: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12 5xl:grid-cols-14 gap-2',
  comfortable: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 3xl:grid-cols-8 4xl:grid-cols-10 5xl:grid-cols-12 gap-4',
  spacious: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-8 5xl:grid-cols-10 gap-6',
}

export function MediaCarousel({ title, items, loading = false, onItemClick, error, onRetry, disabled, showRank, seeAllHref, seeAllText = 'See all' }: MediaCarouselProps) {
  const gridDensity = useSettingsStore((state) => state.gridDensity)
  const { getStatus } = useMediaStatusContext()
  const mobile = isMobile()

  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      align: 'start',
      slidesToScroll: 'auto',
      containScroll: 'trimSnaps',
    },
    [WheelGesturesPlugin({ forceWheelAxis: 'x' })]
  )

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev()
  }, [emblaApi])

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext()
  }, [emblaApi])

  if (loading) {
    return (
      <div className="mb-9">
        <h2 className="text-xl font-bold font-display mb-4 border-l-[3px] border-[var(--color-accent-primary)] pl-3 max-sm:border-l-0 max-sm:pl-0 max-sm:text-[19px]">{title}</h2>
        <div className={`grid ${skeletonGridClasses[gridDensity]}`}>
          {Array.from({ length: 6 }).map((_, i) => (
            <MediaCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0 && error && isMobile()) {
    return (
      <div className="mb-9">
        <h2 className="text-xl font-bold font-display mb-4 border-l-[3px] border-[var(--color-accent-primary)] pl-3 max-sm:border-l-0 max-sm:pl-0 max-sm:text-[19px]">{title}</h2>
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)] px-4 py-3">
          <span className="text-sm text-[var(--color-text-secondary)]">Couldn’t load {title}</span>
          {onRetry && (
            <button onClick={onRetry} className="min-h-[44px] px-3 text-sm font-semibold text-[var(--color-accent-light)]">
              Retry
            </button>
          )}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return null
  }

  return (
    <div className="mb-9 group/carousel overflow-visible">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold font-display border-l-[3px] border-[var(--color-accent-primary)] pl-3 max-sm:border-l-0 max-sm:pl-0 max-sm:text-[19px]">{title}</h2>
        {seeAllHref && (
          <Link
            to={seeAllHref}
            className="flex items-center gap-1 text-sm max-sm:min-h-[44px] max-sm:text-[13px] max-sm:text-[var(--color-text-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-accent-light)] transition-colors"
          >
            {seeAllText}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
          </Link>
        )}
      </div>

      {/* Carousel Container */}
      <div className="relative" style={{ overflow: 'visible' }}>
        {/* Previous Button */}
        <button
          onClick={scrollPrev}
          className="absolute left-0 top-0 bottom-0 z-10 w-14 bg-gradient-to-r from-[var(--color-void)] to-transparent opacity-0 group-hover/carousel:opacity-100 transition-all flex items-center justify-start pl-1"
          aria-label="Previous"
        >
          <div className="w-10 h-10 rounded-full glass flex items-center justify-center hover:scale-110 transition-all">
            <ChevronLeft size={22} />
          </div>
        </button>

        {/* Next Button */}
        <button
          onClick={scrollNext}
          className="absolute right-0 top-0 bottom-0 z-10 w-14 bg-gradient-to-l from-[var(--color-void)] to-transparent opacity-0 group-hover/carousel:opacity-100 transition-all flex items-center justify-end pr-1"
          aria-label="Next"
        >
          <div className="w-10 h-10 rounded-full glass flex items-center justify-center hover:scale-110 transition-all">
            <ChevronRight size={22} />
          </div>
        </button>

        {/* Desktop: Embla viewport. Phone: native horizontal scroll with snap, which iOS
            axis-locks and flings natively (Embla's JS drag let rows drift vertically). */}
        <div
          className={mobile ? 'scrollbar-hide -mx-4 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-px-4 snap-x snap-mandatory' : 'overflow-x-hidden'}
          style={
            mobile
              ? { WebkitOverflowScrolling: 'touch' }
              : { overflowY: 'clip', touchAction: 'pan-y pinch-zoom', contain: 'layout style' }
          }
          ref={mobile ? undefined : emblaRef}
        >
          <div className={`flex ${carouselGapClasses[gridDensity]} ${mobile ? 'w-max px-4' : 'px-4 -mx-4'} py-4 ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
            {items.map((item, index) => (
              <div
                key={item.id}
                className={mobile ? `w-[112px] shrink-0 snap-start` : carouselItemClasses[gridDensity]}
              >
                <MediaCard
                  media={item}
                  onClick={() => onItemClick?.(item)}
                  status={getStatus(item.id)}
                  rank={showRank ? index + 1 : undefined}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
