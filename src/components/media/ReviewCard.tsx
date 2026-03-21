import { useState } from 'react'
import type { JikanReview } from '@/utils/tauri-commands'

interface ReviewCardProps {
  review: JikanReview
}

function getUserAvatar(review: JikanReview): string | undefined {
  const imgs = review.user?.images
  if (!imgs) return undefined
  return imgs.webp?.image_url || imgs.jpg?.image_url || undefined
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export function ReviewCard({ review }: ReviewCardProps) {
  const [expanded, setExpanded] = useState(false)
  const avatarUrl = getUserAvatar(review)
  const reviewText = review.review || ''
  const isLong = reviewText.length > 300

  return (
    <div className="bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-[var(--radius-md)] p-4">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-full shrink-0 bg-[var(--color-accent-gradient)] flex items-center justify-center text-white text-sm font-bold">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={review.user?.username || 'User'}
              className="w-full h-full object-cover rounded-full"
              loading="lazy"
            />
          ) : (
            (review.user?.username || '?')[0].toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
            {review.user?.username || 'Anonymous'}
          </p>
          <p className="text-[0.7rem] text-[var(--color-text-muted)]">
            {formatDate(review.date)}
          </p>
        </div>
        {review.score != null && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-400 text-xs font-bold shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b" stroke="none">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {review.score}/10
          </span>
        )}
      </div>

      {/* Tags */}
      {review.tags && review.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {review.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Review text */}
      <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
        {isLong && !expanded ? (
          <>
            <p className="line-clamp-3 sm:line-clamp-4 lg:line-clamp-5">
              {reviewText}
            </p>
            <button
              onClick={() => setExpanded(true)}
              className="mt-2 text-[var(--color-accent-primary)] text-sm font-medium hover:underline min-h-[44px] sm:min-h-0 flex items-center"
            >
              Read More
            </button>
          </>
        ) : (
          <>
            <p className="whitespace-pre-line">{reviewText}</p>
            {isLong && (
              <button
                onClick={() => setExpanded(false)}
                className="mt-2 text-[var(--color-accent-primary)] text-sm font-medium hover:underline"
              >
                Show Less
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface ReviewListProps {
  reviews: JikanReview[]
  loading?: boolean
  onLoadMore?: () => void
  hasMore?: boolean
  loadingMore?: boolean
}

export function ReviewList({ reviews, loading, onLoadMore, hasMore, loadingMore }: ReviewListProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-[var(--radius-md)] p-4 animate-pulse">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-[var(--color-bg-hover)]" />
              <div className="flex-1">
                <div className="h-3 bg-[var(--color-bg-hover)] rounded w-24" />
                <div className="h-2.5 bg-[var(--color-bg-hover)] rounded w-16 mt-1" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-3 bg-[var(--color-bg-hover)] rounded" />
              <div className="h-3 bg-[var(--color-bg-hover)] rounded w-5/6" />
              <div className="h-3 bg-[var(--color-bg-hover)] rounded w-4/6" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (reviews.length === 0) {
    return (
      <p className="text-center py-8 text-[var(--color-text-secondary)]">
        No reviews available
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {reviews.map((review) => (
        <ReviewCard key={review.mal_id} review={review} />
      ))}
      {hasMore && onLoadMore && (
        <div className="flex justify-center pt-2">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="px-5 py-2 rounded-full text-sm font-medium bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] hover:text-white hover:border-[var(--color-accent-primary)] transition-all disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load More Reviews'}
          </button>
        </div>
      )}
    </div>
  )
}
