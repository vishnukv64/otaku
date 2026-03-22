/**
 * TopContent — ranked lists of top 5 anime (by time) and manga (by chapters)
 */

import { Tv, BookOpen } from 'lucide-react'
import { useProxiedImage } from '@/hooks/useProxiedImage'
import type { TopWatchedEntry, TopReadEntry } from '@/utils/tauri-commands'

interface TopContentProps {
  topAnime: TopWatchedEntry[] | null
  topManga: TopReadEntry[] | null
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function AnimeThumbnail({ url, title }: { url?: string; title: string }) {
  const { src, loading } = useProxiedImage(url || '')
  if (!url || loading || !src) {
    return (
      <div className="w-10 h-14 rounded bg-[var(--color-surface-hover)] shrink-0 flex items-center justify-center text-[var(--color-text-tertiary)]">
        <Tv size={16} />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={title}
      className="w-10 h-14 rounded object-cover shrink-0"
    />
  )
}

function MangaThumbnail({ url, title }: { url?: string; title: string }) {
  const { src, loading } = useProxiedImage(url || '')
  if (!url || loading || !src) {
    return (
      <div className="w-10 h-14 rounded bg-[var(--color-surface-hover)] shrink-0 flex items-center justify-center text-[var(--color-text-tertiary)]">
        <BookOpen size={16} />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={title}
      className="w-10 h-14 rounded object-cover shrink-0"
    />
  )
}

export function TopContent({ topAnime, topManga }: TopContentProps) {
  const animeEmpty = !topAnime || topAnime.length === 0
  const mangaEmpty = !topManga || topManga.length === 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Top Anime */}
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <div className="flex items-center gap-2 mb-5">
          <Tv size={18} className="text-[var(--color-text-tertiary)]" />
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Top Anime
          </h2>
        </div>
        {animeEmpty ? (
          <p className="text-sm text-[var(--color-text-tertiary)] py-8 text-center">
            Watch more to see your favorites here
          </p>
        ) : (
          <div className="space-y-3">
            {topAnime!.map((entry, i) => (
              <div key={entry.media.id} className="flex items-center gap-3">
                <span className="text-sm font-bold text-[var(--color-text-tertiary)] w-5 text-right shrink-0">
                  {i + 1}
                </span>
                <AnimeThumbnail url={entry.media.cover_url} title={entry.media.title} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {entry.media.title}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {formatTime(entry.total_time_seconds)} &middot; {entry.episodes_watched} episodes
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top Manga */}
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <div className="flex items-center gap-2 mb-5">
          <BookOpen size={18} className="text-[var(--color-text-tertiary)]" />
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Top Manga
          </h2>
        </div>
        {mangaEmpty ? (
          <p className="text-sm text-[var(--color-text-tertiary)] py-8 text-center">
            Read more to see your favorites here
          </p>
        ) : (
          <div className="space-y-3">
            {topManga!.map((entry, i) => (
              <div key={entry.media.id} className="flex items-center gap-3">
                <span className="text-sm font-bold text-[var(--color-text-tertiary)] w-5 text-right shrink-0">
                  {i + 1}
                </span>
                <MangaThumbnail url={entry.media.cover_url} title={entry.media.title} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {entry.media.title}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {entry.chapters_read} chapters read
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
