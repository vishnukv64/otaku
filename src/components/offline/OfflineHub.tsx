import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { WifiOff, Tv, BookOpen, Download, Library, Settings, Play, BookMarked } from 'lucide-react'
import { getDownloadsWithMedia, getDownloadedMangaWithMedia } from '@/utils/tauri-commands'
import type { DownloadWithMedia, DownloadedMangaWithMedia } from '@/utils/tauri-commands'
import { isMobile } from '@/utils/platform'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function CoverImage({ src, title }: { src?: string; title: string }) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-[var(--color-bg-hover)] to-[var(--color-bg-secondary)] flex items-center justify-center">
        <span className="text-2xl font-bold text-[var(--color-text-muted)] opacity-50">
          {title.charAt(0).toUpperCase()}
        </span>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={title}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  )
}

export function OfflineHub() {
  const navigate = useNavigate()
  const mobile = isMobile()
  const [animeDownloads, setAnimeDownloads] = useState<DownloadWithMedia[]>([])
  const [mangaDownloads, setMangaDownloads] = useState<DownloadedMangaWithMedia[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadDownloads() {
      try {
        const [anime, manga] = await Promise.all([
          getDownloadsWithMedia().catch(() => []),
          getDownloadedMangaWithMedia().catch(() => []),
        ])
        setAnimeDownloads(anime)
        setMangaDownloads(manga)
      } finally {
        setLoading(false)
      }
    }
    loadDownloads()
  }, [])

  const hasContent = animeDownloads.length > 0 || mangaDownloads.length > 0

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col">
      {/* Hero Section */}
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="relative mb-6">
          <div className="w-20 h-20 rounded-full bg-[var(--color-accent-primary)]/10 flex items-center justify-center">
            <WifiOff className="w-10 h-10 text-[var(--color-accent-primary)]" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
          You're Offline
        </h1>
        <p className="text-[var(--color-text-secondary)] text-center max-w-md">
          {hasContent
            ? "No worries — your downloads are ready to enjoy"
            : "Download episodes and chapters when you're online to enjoy them offline"}
        </p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[var(--color-accent-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : hasContent ? (
        <div className="flex-1 px-4 pb-8 space-y-8">
          {/* Downloaded Anime Section */}
          {animeDownloads.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Tv size={18} className="text-[var(--color-accent-primary)]" />
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  Downloaded Anime
                </h2>
                <span className="text-sm text-[var(--color-text-muted)]">
                  ({animeDownloads.length})
                </span>
              </div>
              <div className={`grid gap-3 ${mobile ? 'grid-cols-2' : 'grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}`}>
                {animeDownloads.map((anime) => (
                  <button
                    key={anime.media_id}
                    onClick={() => navigate({ to: '/watch', search: { malId: anime.media_id } })}
                    className="group text-left rounded-lg overflow-hidden bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-all hover:scale-[1.02] hover:shadow-lg"
                  >
                    <div className="aspect-[2/3] relative overflow-hidden">
                      <CoverImage src={anime.cover_url} title={anime.title} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        <div className="flex items-center gap-1 text-xs text-white/80 mb-1">
                          <Play size={10} className="fill-current" />
                          <span>{anime.episode_count} episode{anime.episode_count !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                      {/* Play overlay on hover */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                        <div className="w-12 h-12 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center">
                          <Play size={20} className="fill-white text-white ml-0.5" />
                        </div>
                      </div>
                    </div>
                    <div className="p-2.5">
                      <h3 className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-2 leading-tight">
                        {anime.title}
                      </h3>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        {formatBytes(anime.total_size)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Downloaded Manga Section */}
          {mangaDownloads.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <BookOpen size={18} className="text-[var(--color-accent-primary)]" />
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  Downloaded Manga
                </h2>
                <span className="text-sm text-[var(--color-text-muted)]">
                  ({mangaDownloads.length})
                </span>
              </div>
              <div className={`grid gap-3 ${mobile ? 'grid-cols-2' : 'grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}`}>
                {mangaDownloads.map((manga) => (
                  <button
                    key={manga.media_id}
                    onClick={() => navigate({ to: '/downloads' })}
                    className="group text-left rounded-lg overflow-hidden bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-all hover:scale-[1.02] hover:shadow-lg"
                  >
                    <div className="aspect-[2/3] relative overflow-hidden">
                      <CoverImage src={manga.cover_url} title={manga.title} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        <div className="flex items-center gap-1 text-xs text-white/80 mb-1">
                          <BookMarked size={10} />
                          <span>{manga.chapter_count} chapter{manga.chapter_count !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                      {/* Read overlay on hover */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                        <div className="w-12 h-12 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center">
                          <BookOpen size={20} className="text-white" />
                        </div>
                      </div>
                    </div>
                    <div className="p-2.5">
                      <h3 className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-2 leading-tight">
                        {manga.title}
                      </h3>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        {formatBytes(manga.total_size)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        /* Empty state - no downloads at all */
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
          <div className="w-16 h-16 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center mb-4">
            <Download size={24} className="text-[var(--color-text-muted)]" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
            Nothing Downloaded Yet
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] text-center max-w-sm mb-6">
            When you're online, tap the download button on any episode or chapter to save it for offline viewing.
          </p>
          <div className="flex items-center gap-3">
            <Link
              to="/library"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] text-sm transition-colors"
            >
              <Library size={16} />
              Library
            </Link>
            <Link
              to="/settings"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] text-sm transition-colors"
            >
              <Settings size={16} />
              Settings
            </Link>
          </div>
        </div>
      )}

      {/* Quick access footer when content exists */}
      {hasContent && !loading && (
        <div className="px-4 pb-6">
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/downloads"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-sm transition-colors"
            >
              <Download size={14} />
              Manage Downloads
            </Link>
            <Link
              to="/library"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-sm transition-colors"
            >
              <Library size={14} />
              Library
            </Link>
            <Link
              to="/settings"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] text-sm transition-colors"
            >
              <Settings size={14} />
              Settings
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
