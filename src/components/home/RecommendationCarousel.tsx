/**
 * Recommendation Carousel Components
 *
 * Wraps the existing MediaCarousel to display recommendation engine results.
 * Converts RecommendationEntry (MediaEntry-based) to SearchResult for MediaCarousel.
 */

import { MediaCarousel } from '@/components/media/MediaCarousel'
import type { SearchResult } from '@/types/extension'
import type { RecommendationEntry, SimilarToGroup } from '@/utils/tauri-commands'

/**
 * Converts a RecommendationEntry (which contains a MediaEntry) into a SearchResult
 * so it can be rendered by MediaCarousel / MediaCard.
 */
function toSearchResult(entry: RecommendationEntry): SearchResult {
  const { media } = entry
  return {
    id: media.id,
    title: media.title,
    cover_url: media.cover_url ?? undefined,
    description: media.description ?? undefined,
    year: media.year ?? undefined,
    status: media.status ?? undefined,
    rating: media.rating ?? undefined,
    media_type: media.content_type ?? undefined,
    available_episodes: media.episode_count ?? undefined,
    genres: media.genres ? media.genres.split(',').map((g) => g.trim()) : undefined,
  }
}

interface RecommendationCarouselProps {
  title: string
  items: RecommendationEntry[]
  loading?: boolean
  onItemClick?: (item: SearchResult) => void
}

export function RecommendationCarousel({ title, items, loading, onItemClick }: RecommendationCarouselProps) {
  if (!loading && items.length === 0) return null

  const searchResults = items.map(toSearchResult)

  return (
    <MediaCarousel
      title={title}
      items={searchResults}
      loading={loading}
      onItemClick={onItemClick}
    />
  )
}

interface SimilarToCarouselProps {
  group: SimilarToGroup
  onItemClick?: (item: SearchResult) => void
}

export function SimilarToCarousel({ group, onItemClick }: SimilarToCarouselProps) {
  if (group.recommendations.length === 0) return null

  const searchResults = group.recommendations.map(toSearchResult)

  return (
    <MediaCarousel
      title={`Because you watched ${group.source_title}`}
      items={searchResults}
      onItemClick={onItemClick}
    />
  )
}
