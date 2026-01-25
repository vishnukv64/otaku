/**
 * MediaCarousel Component
 *
 * Horizontal scrolling carousel for media cards.
 * Uses Embla Carousel for smooth scrolling with touch support.
 */

import { useCallback } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MediaCard, MediaCardSkeleton } from './MediaCard'
import type { SearchResult } from '@/types/extension'

interface MediaCarouselProps {
  title: string
  items: SearchResult[]
  loading?: boolean
  onItemClick?: (item: SearchResult) => void
}

export function MediaCarousel({ title, items, loading = false, onItemClick }: MediaCarouselProps) {
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
    <div className="mb-12 group/carousel">
      {/* Title */}
      <h2 className="text-xl font-semibold mb-4">{title}</h2>

      {/* Carousel Container */}
      <div className="relative">
        {/* Previous Button */}
        <button
          onClick={scrollPrev}
          className="absolute left-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-r from-black/80 to-transparent opacity-0 group-hover/carousel:opacity-100 transition-opacity flex items-center justify-center hover:from-black/90"
          aria-label="Previous"
        >
          <ChevronLeft size={32} />
        </button>

        {/* Next Button */}
        <button
          onClick={scrollNext}
          className="absolute right-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-l from-black/80 to-transparent opacity-0 group-hover/carousel:opacity-100 transition-opacity flex items-center justify-center hover:from-black/90"
          aria-label="Next"
        >
          <ChevronRight size={32} />
        </button>

        {/* Embla Viewport */}
        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex gap-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex-[0_0_calc(50%-0.375rem)] sm:flex-[0_0_calc(33.333%-0.5rem)] md:flex-[0_0_calc(25%-0.5625rem)] lg:flex-[0_0_calc(20%-0.6rem)] xl:flex-[0_0_calc(16.666%-0.625rem)]"
              >
                <MediaCard media={item} onClick={() => onItemClick?.(item)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
