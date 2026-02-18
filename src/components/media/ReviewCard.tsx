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

function getScoreColor(score: number): string {
  if (score >= 9) return 'bg-green-500'
  if (score >= 7) return 'bg-lime-500'
  if (score >= 5) return 'bg-yellow-500'
  if (score >= 3) return 'bg-orange-500'
  return 'bg-red-500'
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
    <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-full overflow-hidden bg-[var(--color-bg-hover)] shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={review.user?.username || 'User'}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs">
              ?
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
            {review.user?.username || 'Anonymous'}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {formatDate(review.date)}
          </p>
        </div>
        {review.score != null && (
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${getScoreColor(review.score)}`}>
            {review.score}
          </div>
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
}

export function ReviewList({ reviews, loading }: ReviewListProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-bg-secondary)] rounded-lg p-4 animate-pulse">
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
    </div>
  )
}
