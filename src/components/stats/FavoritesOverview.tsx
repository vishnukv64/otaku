/**
 * FavoritesOverview — Overview of user's favorited content with counts,
 * genre tags, and most recent favorite.
 */

import { Heart, Tv, BookOpen } from 'lucide-react'
import type { FavoritesStats } from '@/utils/tauri-commands'

interface FavoritesOverviewProps {
  data: FavoritesStats | null
}

export function FavoritesOverview({ data }: FavoritesOverviewProps) {
  const isEmpty = !data || data.total_favorites === 0

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-6">Favorites</h2>

      {isEmpty ? (
        <p className="text-center text-sm text-[var(--color-text-tertiary)]">
          Add favorites from your library to see them here
        </p>
      ) : (
        <div className="space-y-5">
          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-4">
            {/* Total favorites */}
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[rgba(245,197,24,0.06)]">
              <div className="text-[rgba(245,197,24,0.9)]">
                <Heart size={22} fill="currentColor" />
              </div>
              <span className="text-2xl font-bold text-[var(--color-text-primary)]">
                {data!.total_favorites}
              </span>
              <span className="text-xs text-[var(--color-text-tertiary)]">Total</span>
            </div>

            {/* Anime favorites */}
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[rgba(229,9,20,0.06)]">
              <div className="text-[var(--color-accent-primary)]">
                <Tv size={22} />
              </div>
              <span className="text-2xl font-bold text-[var(--color-text-primary)]">
                {data!.anime_favorites}
              </span>
              <span className="text-xs text-[var(--color-text-tertiary)]">Anime</span>
            </div>

            {/* Manga favorites */}
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-[rgba(59,130,246,0.06)]">
              <div className="text-[var(--color-info)]">
                <BookOpen size={22} />
              </div>
              <span className="text-2xl font-bold text-[var(--color-text-primary)]">
                {data!.manga_favorites}
              </span>
              <span className="text-xs text-[var(--color-text-tertiary)]">Manga</span>
            </div>
          </div>

          {/* Top genres */}
          {data!.top_genres.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                Top Genres
              </h3>
              <div className="flex flex-wrap gap-2">
                {data!.top_genres.map((genre) => (
                  <span
                    key={genre}
                    className="px-2.5 py-1 rounded-full text-xs font-medium bg-[rgba(245,197,24,0.1)] text-[rgba(245,197,24,0.9)]"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Most recent favorite */}
          {data!.recent_favorite_title && (
            <div>
              <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                Most Recent
              </h3>
              <p className="text-sm text-[var(--color-text-primary)] truncate">
                {data!.recent_favorite_title}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
