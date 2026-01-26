/**
 * HeroSectionSkeleton - Loading state for hero section
 */

export function HeroSectionSkeleton() {
  return (
    <div className="relative w-full aspect-[16/9] mb-8 rounded-lg overflow-hidden bg-[var(--color-bg-secondary)]">
      {/* Background shimmer */}
      <div className="absolute inset-0 shimmer-bg" />

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent" />

      {/* Content skeleton */}
      <div className="absolute inset-0 flex items-center px-8 md:px-12 lg:px-16">
        <div className="max-w-2xl space-y-4">
          {/* Title skeleton */}
          <div className="space-y-3">
            <div className="h-12 bg-white/10 rounded shimmer-bg w-3/4" />
            <div className="h-12 bg-white/10 rounded shimmer-bg w-1/2" />
          </div>

          {/* Metadata skeleton */}
          <div className="flex items-center gap-4">
            <div className="h-6 w-20 bg-white/10 rounded shimmer-bg" />
            <div className="h-6 w-16 bg-white/10 rounded shimmer-bg" />
            <div className="h-6 w-24 bg-white/10 rounded shimmer-bg" />
          </div>

          {/* Description skeleton */}
          <div className="space-y-2">
            <div className="h-4 bg-white/10 rounded shimmer-bg w-full" />
            <div className="h-4 bg-white/10 rounded shimmer-bg w-full" />
            <div className="h-4 bg-white/10 rounded shimmer-bg w-2/3" />
          </div>

          {/* Buttons skeleton */}
          <div className="flex items-center gap-4 pt-4">
            <div className="h-12 w-40 bg-white/20 rounded shimmer-bg" />
            <div className="h-12 w-40 bg-white/10 rounded shimmer-bg" />
          </div>
        </div>
      </div>

      {/* Carousel indicators skeleton */}
      <div className="absolute left-8 md:left-12 lg:left-16 bottom-8 flex items-center gap-2">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className={`h-1 rounded-full bg-white/40 ${i === 0 ? 'w-12' : 'w-8'}`}
          />
        ))}
      </div>
    </div>
  )
}
