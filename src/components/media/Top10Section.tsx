/**
 * Top10Section Component
 *
 * Horizontal carousel of rank cards with large outlined rank numbers.
 * Netflix-inspired design with accent glow on top 3 positions.
 */

import { useCallback } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { WheelGesturesPlugin } from 'embla-carousel-wheel-gestures'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { SearchResult } from '@/types/extension'

interface Top10SectionProps {
  items: SearchResult[]
  onItemClick?: (item: SearchResult) => void
}

export function Top10Section({ items, onItemClick }: Top10SectionProps) {
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

  if (items.length < 10) return null

  const top10 = items.slice(0, 10)

  return (
    <div className="mb-10 group/carousel overflow-visible">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold font-display border-l-[3px] border-[var(--color-accent-primary)] pl-3">Top 10 Anime</h2>
        <Link
          to="/anime"
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors flex items-center gap-1"
        >
          Browse all
          <ChevronRight size={14} />
        </Link>
      </div>

      {/* Carousel */}
      <div className="relative" style={{ overflow: 'visible' }}>
        {/* Prev Button */}
        <button
          onClick={scrollPrev}
          className="absolute left-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-r from-[var(--color-void)] to-transparent opacity-0 group-hover/carousel:opacity-100 transition-all flex items-center justify-start pl-1"
          aria-label="Previous"
        >
          <div className="w-9 h-9 rounded-full glass flex items-center justify-center">
            <ChevronLeft size={20} />
          </div>
        </button>

        {/* Next Button */}
        <button
          onClick={scrollNext}
          className="absolute right-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-l from-[var(--color-void)] to-transparent opacity-0 group-hover/carousel:opacity-100 transition-all flex items-center justify-end pr-1"
          aria-label="Next"
        >
          <div className="w-9 h-9 rounded-full glass flex items-center justify-center">
            <ChevronRight size={20} />
          </div>
        </button>

        {/* Embla Viewport */}
        <div
          className="overflow-x-hidden"
          style={{ overflowY: 'clip', touchAction: 'pan-x' }}
          ref={emblaRef}
        >
          <div className="flex gap-3 py-2">
            {top10.map((item, index) => {
              const rank = index + 1
              const isTop3 = rank <= 3

              return (
                <button
                  key={item.id}
                  className="flex-[0_0_130px] cursor-pointer relative overflow-visible rounded-[var(--radius-md)] group/rank transition-transform duration-300 hover:-translate-y-1"
                  onClick={() => onItemClick?.(item)}
                >
                  {/* Poster */}
                  <div className="relative w-full aspect-[2/3] rounded-[var(--radius-md)] overflow-hidden bg-[var(--color-card)]">
                    {item.cover_url ? (
                      <img
                        src={item.cover_url}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full bg-[var(--color-panel)]" />
                    )}

                    {/* Bottom gradient with title + score */}
                    <div className="absolute bottom-0 left-0 right-0 p-2 pt-8 bg-gradient-to-t from-[rgba(20,20,20,0.98)] to-transparent">
                      <h3 className="text-xs font-semibold font-display text-white line-clamp-1 leading-tight">
                        {item.title}
                      </h3>
                      {item.rating != null && item.rating > 0 && (
                        <span className="inline-flex items-center gap-0.5 mt-1 text-[0.6rem] font-semibold font-mono text-[var(--color-gold)]">
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="var(--color-gold)" stroke="none">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                          {item.rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Large Rank Number Overlay */}
                  <span
                    className={`absolute -bottom-1 -left-2 z-[2] text-[3.5rem] font-display font-extrabold leading-none select-none pointer-events-none transition-transform duration-300 group-hover/rank:-translate-x-1 group-hover/rank:-translate-y-1 ${
                      isTop3 ? 'drop-shadow-[0_0_10px_rgba(229,9,20,0.25)]' : ''
                    }`}
                    style={{
                      color: 'transparent',
                      WebkitTextStroke: isTop3
                        ? '2px var(--color-accent-mid)'
                        : '2px rgba(255,255,255,0.15)',
                    }}
                  >
                    {rank}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
