/**
 * MediaDetailModal Component
 *
 * Full-screen modal displaying detailed anime/manga information
 * - Large banner with blur background
 * - Metadata (rating, year, status, episodes)
 * - Episode list
 * - Action buttons (Watch, Add to List)
 */

import { useEffect, useState } from 'react'
import { X, Play, Plus, Loader2 } from 'lucide-react'
import type { SearchResult, MediaDetails } from '@/types/extension'
import { getMediaDetails } from '@/utils/tauri-commands'

interface MediaDetailModalProps {
  media: SearchResult
  extensionId: string
  isOpen: boolean
  onClose: () => void
  onWatch?: (episodeId: string) => void
}

export function MediaDetailModal({
  media,
  extensionId,
  isOpen,
  onClose,
  onWatch
}: MediaDetailModalProps) {
  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const loadDetails = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await getMediaDetails(extensionId, media.id)
        setDetails(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load details')
      } finally {
        setLoading(false)
      }
    }

    loadDetails()
  }, [isOpen, extensionId, media.id])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto animate-in fade-in duration-300">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/90 backdrop-blur-md animate-in fade-in duration-300"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative min-h-screen flex items-start justify-center p-4 sm:p-6 lg:p-8">
        <div className="relative bg-[var(--color-bg-primary)] rounded-xl max-w-6xl w-full my-8 shadow-2xl animate-in slide-in-from-bottom-4 duration-500 border border-white/5">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-6 right-6 z-10 w-12 h-12 rounded-full bg-black/80 backdrop-blur-sm hover:bg-[var(--color-accent-primary)] flex items-center justify-center transition-all hover:scale-110 border border-white/20"
            aria-label="Close"
          >
            <X size={24} strokeWidth={2.5} />
          </button>

          {loading ? (
            <div className="flex items-center justify-center py-32">
              <Loader2 className="w-12 h-12 animate-spin text-[var(--color-accent-primary)]" />
            </div>
          ) : error ? (
            <div className="py-32 text-center">
              <p className="text-[var(--color-text-secondary)]">{error}</p>
            </div>
          ) : details ? (
            <>
              {/* Hero Banner */}
              <div className="relative h-[28rem] rounded-t-xl overflow-hidden">
                {/* Background Image (blurred) */}
                {details.cover_url && (
                  <>
                    <img
                      src={details.cover_url}
                      alt={details.title}
                      className="absolute inset-0 w-full h-full object-cover blur-3xl scale-110 opacity-40"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-primary)] via-black/80 to-black/40" />
                    <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
                  </>
                )}

                {/* Content */}
                <div className="relative h-full flex items-end p-10">
                  <div className="flex gap-8 w-full">
                    {/* Poster */}
                    {details.cover_url && (
                      <div className="relative flex-shrink-0 group">
                        <img
                          src={details.cover_url}
                          alt={details.title}
                          className="w-56 h-80 object-cover rounded-xl shadow-2xl ring-1 ring-white/10 transform group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 rounded-xl bg-gradient-to-t from-black/20 to-transparent" />
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <h1 className="text-5xl font-black mb-3 drop-shadow-2xl leading-tight tracking-tight">
                        {details.title}
                      </h1>

                      {/* Metadata Row 1 - Key Info */}
                      <div className="flex items-center gap-3 text-base mb-4 flex-wrap">
                        {details.rating && (
                          <span className="flex items-center gap-1 text-yellow-400 font-bold text-lg">
                            ★ {details.rating.toFixed(2)}
                          </span>
                        )}
                        {details.year && (
                          <>
                            <span className="text-[var(--color-text-muted)]">•</span>
                            <span className="text-white font-medium">{details.year}</span>
                          </>
                        )}
                        {details.status && (
                          <>
                            <span className="text-[var(--color-text-muted)]">•</span>
                            <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm font-medium capitalize">
                              {details.status.toLowerCase()}
                            </span>
                          </>
                        )}
                        {details.episodes.length > 0 && (
                          <>
                            <span className="text-[var(--color-text-muted)]">•</span>
                            <span className="text-white font-medium">
                              {details.episodes.length} Episodes
                            </span>
                          </>
                        )}
                      </div>

                      {/* Metadata Row 2 - Additional Details */}
                      <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)] mb-6 flex-wrap">
                        <span className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                          </svg>
                          <span>TV Series</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>24 min/ep</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span>Spring 2024</span>
                        </span>
                      </div>

                      {/* Genres */}
                      {details.genres.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-6">
                          {details.genres.map((genre) => (
                            <span
                              key={genre}
                              className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded-full text-sm font-medium transition-colors cursor-pointer"
                            >
                              {genre}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex items-center gap-3">
                        {details.episodes.length > 0 && (
                          <button
                            onClick={() => onWatch?.(details.episodes[0].id)}
                            className="flex items-center gap-2 px-8 py-3.5 bg-[var(--color-accent-primary)] text-white font-bold rounded-lg hover:bg-[var(--color-accent-primary)]/90 transition-all transform hover:scale-105 shadow-lg shadow-[var(--color-accent-primary)]/50"
                          >
                            <Play size={22} fill="currentColor" />
                            <span>Watch Now</span>
                          </button>
                        )}
                        <button
                          className="flex items-center gap-2 px-6 py-3.5 bg-white/10 backdrop-blur-sm text-white font-bold rounded-lg hover:bg-white/20 transition-all border border-white/20"
                        >
                          <Plus size={22} />
                          <span>My List</span>
                        </button>
                        <button
                          className="flex items-center justify-center w-12 h-12 bg-white/10 backdrop-blur-sm text-white rounded-lg hover:bg-white/20 transition-all border border-white/20"
                          aria-label="More info"
                        >
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Description & Episodes */}
              <div className="p-8">
                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                  <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg">
                    <div className="text-[var(--color-text-muted)] text-sm mb-1">Score</div>
                    <div className="text-2xl font-bold text-yellow-400">
                      {details.rating ? details.rating.toFixed(2) : 'N/A'}
                    </div>
                  </div>
                  <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg">
                    <div className="text-[var(--color-text-muted)] text-sm mb-1">Episodes</div>
                    <div className="text-2xl font-bold">{details.episodes.length}</div>
                  </div>
                  <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg">
                    <div className="text-[var(--color-text-muted)] text-sm mb-1">Status</div>
                    <div className="text-2xl font-bold capitalize">{details.status || 'Unknown'}</div>
                  </div>
                  <div className="bg-[var(--color-bg-secondary)] p-4 rounded-lg">
                    <div className="text-[var(--color-text-muted)] text-sm mb-1">Year</div>
                    <div className="text-2xl font-bold">{details.year || 'N/A'}</div>
                  </div>
                </div>

                {/* Description */}
                {details.description && (
                  <div className="mb-8">
                    <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
                      <svg className="w-6 h-6 text-[var(--color-accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Synopsis
                    </h2>
                    <p className="text-[var(--color-text-secondary)] leading-relaxed text-lg">
                      {details.description.replace(/<[^>]*>/g, '')}
                    </p>
                  </div>
                )}

                {/* Episodes */}
                {details.episodes.length > 0 && (
                  <div>
                    <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
                      <svg className="w-6 h-6 text-[var(--color-accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Episodes ({details.episodes.length})
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {details.episodes.map((episode) => (
                        <button
                          key={episode.id}
                          onClick={() => onWatch?.(episode.id)}
                          className="group relative aspect-video rounded-lg overflow-hidden bg-[var(--color-bg-secondary)] hover:ring-2 hover:ring-[var(--color-accent-primary)] transition-all hover:scale-105 transform"
                        >
                          {episode.thumbnail ? (
                            <img
                              src={episode.thumbnail}
                              alt={episode.title || `Episode ${episode.number}`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[var(--color-bg-secondary)] to-[var(--color-bg-hover)]">
                              <svg className="w-8 h-8 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-xs text-[var(--color-text-muted)]">Episode {episode.number}</span>
                            </div>
                          )}
                          {/* Play icon overlay on hover */}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-12 h-12 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center transform group-hover:scale-110 transition-transform">
                              <svg className="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </div>
                          </div>
                          {/* Episode number badge */}
                          <div className="absolute top-2 left-2 px-2.5 py-1 bg-black/80 backdrop-blur-sm rounded-md text-xs font-bold">
                            EP {episode.number}
                          </div>
                          {/* Episode title on hover */}
                          {episode.title && (
                            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black via-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                              <p className="text-xs font-medium line-clamp-2">
                                {episode.title}
                              </p>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
