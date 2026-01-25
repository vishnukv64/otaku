/**
 * EpisodeList Component
 *
 * Displays a list of episodes with thumbnails and selection
 */

import { useState } from 'react'
import { Play, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Episode } from '@/types/extension'

interface EpisodeListProps {
  episodes: Episode[]
  currentEpisodeId?: string
  onEpisodeSelect: (episodeId: string) => void
  animeTitle?: string
  collapsible?: boolean
}

export function EpisodeList({
  episodes,
  currentEpisodeId,
  onEpisodeSelect,
  animeTitle,
  collapsible = true,
}: EpisodeListProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [page, setPage] = useState(0)
  const episodesPerPage = 50

  const totalPages = Math.ceil(episodes.length / episodesPerPage)
  const paginatedEpisodes = episodes.slice(
    page * episodesPerPage,
    (page + 1) * episodesPerPage
  )

  const currentEpisodeNumber = episodes.find((ep) => ep.id === currentEpisodeId)?.number

  return (
    <div
      className={`h-full bg-[var(--color-bg-secondary)] border-l border-white/10 transition-all duration-300 ${
        isCollapsed ? 'w-12' : 'w-80'
      }`}
    >
      {/* Header */}
      <div className="h-16 border-b border-white/10 flex items-center justify-between px-4">
        {!isCollapsed && (
          <div className="flex-1 min-w-0">
            {animeTitle && (
              <h3 className="text-sm font-semibold truncate mb-0.5">{animeTitle}</h3>
            )}
            <p className="text-xs text-[var(--color-text-muted)]">
              {episodes.length} Episodes
            </p>
          </div>
        )}

        {collapsible && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded transition-colors"
            aria-label={isCollapsed ? 'Expand episode list' : 'Collapse episode list'}
          >
            {isCollapsed ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
          </button>
        )}
      </div>

      {!isCollapsed && (
        <>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="h-12 border-b border-white/10 flex items-center justify-between px-4">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-sm hover:bg-white/10 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>

              <span className="text-sm text-[var(--color-text-muted)]">
                {page * episodesPerPage + 1}-
                {Math.min((page + 1) * episodesPerPage, episodes.length)} of {episodes.length}
              </span>

              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page === totalPages - 1}
                className="px-3 py-1.5 text-sm hover:bg-white/10 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}

          {/* Episode List */}
          <div className="overflow-y-auto" style={{ height: 'calc(100% - 4rem)' }}>
            <div className="p-2 space-y-2">
              {paginatedEpisodes.map((episode) => {
                const isCurrentEpisode = episode.id === currentEpisodeId
                const isWatched = currentEpisodeNumber && episode.number < currentEpisodeNumber

                return (
                  <button
                    key={episode.id}
                    onClick={() => onEpisodeSelect(episode.id)}
                    className={`w-full group relative rounded-lg overflow-hidden transition-all hover:scale-[1.02] ${
                      isCurrentEpisode
                        ? 'ring-2 ring-[var(--color-accent-primary)]'
                        : 'hover:ring-1 hover:ring-white/20'
                    }`}
                  >
                    <div className="flex gap-3 p-2 bg-[var(--color-bg-primary)] hover:bg-[var(--color-bg-hover)] transition-colors">
                      {/* Thumbnail */}
                      <div className="relative flex-shrink-0 w-24 aspect-video rounded overflow-hidden bg-[var(--color-bg-secondary)]">
                        {episode.thumbnail ? (
                          <img
                            src={episode.thumbnail}
                            alt={episode.title || `Episode ${episode.number}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Play size={20} className="text-[var(--color-text-muted)]" />
                          </div>
                        )}

                        {/* Play overlay on hover */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="w-8 h-8 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center">
                            <Play size={16} fill="white" />
                          </div>
                        </div>

                        {/* Watched indicator */}
                        {isWatched && !isCurrentEpisode && (
                          <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full" />
                        )}

                        {/* Currently playing indicator */}
                        {isCurrentEpisode && (
                          <div className="absolute inset-0 bg-[var(--color-accent-primary)]/20" />
                        )}
                      </div>

                      {/* Episode Info */}
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-sm font-bold ${
                              isCurrentEpisode ? 'text-[var(--color-accent-primary)]' : ''
                            }`}
                          >
                            EP {episode.number}
                          </span>
                          {isCurrentEpisode && (
                            <span className="px-2 py-0.5 bg-[var(--color-accent-primary)] text-xs font-bold rounded-full">
                              NOW
                            </span>
                          )}
                        </div>

                        {episode.title && (
                          <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">
                            {episode.title}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
