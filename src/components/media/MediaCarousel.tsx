/**
 * MediaCarousel Component
 *
 * Horizontal scrolling carousel for media cards.
 * Uses Embla Carousel for smooth scrolling with touch support.
 * Respects grid density setting from settings store.
 * Shows status badges for library, favorites, and watch/read progress.
 */

import { useCallback } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
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

export function MediaCarousel({ title, items, loading = false, onItemClick }: MediaCarouselProps) {
  const gridDensity = useSettingsStore((state) => state.gridDensity)
  const { getStatus } = useMediaStatusContext()

  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    slidesToScroll: 'auto',
    containScroll: 'trimSnaps',
  })

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev()
  }, [emblaApi])

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext()
  }, [emblaApi])

  if (loading) {
    return (
      <div className="mb-12">
        <h2 className="text-xl font-semibold mb-4">{title}</h2>
        <div className={`grid ${skeletonGridClasses[gridDensity]}`}>
          {Array.from({ length: 6 }).map((_, i) => (
            <MediaCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return null
  }

  return (
    <div className="mb-12 group/carousel overflow-visible">
      {/* Title */}
      <h2 className="text-xl font-semibold mb-4">{title}</h2>

      {/* Carousel Container */}
      <div className="relative overflow-visible">
        {/* Previous Button - Always visible on hover */}
        <button
          onClick={scrollPrev}
          className="absolute left-0 top-0 bottom-0 z-10 w-16 bg-gradient-to-r from-black via-black/80 to-transparent opacity-0 group-hover/carousel:opacity-100 transition-all flex items-center justify-start pl-2 hover:w-20"
          aria-label="Previous"
        >
          <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 hover:scale-110 transition-all">
            <ChevronLeft size={28} />
          </div>
        </button>

        {/* Next Button - Always visible on hover */}
        <button
          onClick={scrollNext}
          className="absolute right-0 top-0 bottom-0 z-10 w-16 bg-gradient-to-l from-black via-black/80 to-transparent opacity-0 group-hover/carousel:opacity-100 transition-all flex items-center justify-end pr-2 hover:w-20"
          aria-label="Next"
        >
          <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 hover:scale-110 transition-all">
            <ChevronRight size={28} />
          </div>
        </button>

        {/* Embla Viewport - overflow-x-hidden for carousel, overflow-y-visible for hover scale */}
        <div className="overflow-x-hidden overflow-y-visible py-4 -my-4" ref={emblaRef}>
          <div className={`flex ${carouselGapClasses[gridDensity]} px-4 -mx-4`}>
            {items.map((item) => (
              <div
                key={item.id}
                className={carouselItemClasses[gridDensity]}
              >
                <MediaCard
                  media={item}
                  onClick={() => onItemClick?.(item)}
                  status={getStatus(item.id)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
