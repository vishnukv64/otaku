/**
 * SpotlightSearch Component
 *
 * A macOS Spotlight-style search modal that can be triggered with Cmd+K
 * from anywhere in the app. Features:
 * - Global search for both anime AND manga
 * - Instant search with debouncing
 * - Keyboard navigation
 * - Click or Enter to select results
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Loader2, X, Star, ChevronRight, Tv, BookOpen } from 'lucide-react'
import { loadExtension, searchAnime, searchManga } from '@/utils/tauri-commands'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { ALLANIME_MANGA_EXTENSION } from '@/extensions/allanime-manga-extension'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { MangaDetailModal } from '@/components/media/MangaDetailModal'
import { useSettingsStore } from '@/store/settingsStore'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import type { SearchResult } from '@/types/extension'

// Extended result with media type
interface GlobalSearchResult extends SearchResult {
  mediaType: 'anime' | 'manga'
}

interface SpotlightSearchProps {
  isOpen: boolean
  onClose: () => void
}

export function SpotlightSearch({ isOpen, onClose }: SpotlightSearchProps) {
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GlobalSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [animeExtensionId, setAnimeExtensionId] = useState<string | null>(null)
  const [mangaExtensionId, setMangaExtensionId] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [selectedMedia, setSelectedMedia] = useState<GlobalSearchResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Load both extensions on mount
  useEffect(() => {
    const initExtensions = async () => {
      try {
        const [animeMetadata, mangaMetadata] = await Promise.all([
          loadExtension(ALLANIME_EXTENSION),
          loadExtension(ALLANIME_MANGA_EXTENSION)
        ])
        setAnimeExtensionId(animeMetadata.id)
        setMangaExtensionId(mangaMetadata.id)
      } catch (err) {
        console.error('Failed to load extensions:', err)
      }
    }
    initExtensions()
  }, [])

  // Focus input when modal opens and handle global Escape key
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure modal is rendered
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)

      // Global Escape key handler to prevent fullscreen exit
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }

      // Use capture phase to intercept before browser handles it
      document.addEventListener('keydown', handleGlobalKeyDown, true)

      return () => {
        document.removeEventListener('keydown', handleGlobalKeyDown, true)
      }
    } else {
      // Reset state when closing
      setQuery('')
      setResults([])
      setSelectedIndex(0)
    }
  }, [isOpen, onClose])

  // Debounced global search (anime + manga)
  useEffect(() => {
    if (!query.trim() || !animeExtensionId || !mangaExtensionId) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        // Search both anime and manga in parallel
        // nsfwFilter=true means "hide adult", so allowAdult should be !nsfwFilter
        const [animeResults, mangaResults] = await Promise.all([
          searchAnime(animeExtensionId, query, 1, !nsfwFilter),
          searchManga(mangaExtensionId, query, 1, !nsfwFilter)
        ])

        // Filter NSFW content on frontend as well
        // Filter NSFW using both genres and title keywords
        const filteredAnime = filterNsfwContent(animeResults.results, (item) => item.genres, nsfwFilter, (item) => item.title)
        const filteredManga = filterNsfwContent(mangaResults.results, (item) => item.genres, nsfwFilter, (item) => item.title)

        // Tag results with their media type
        const taggedAnime: GlobalSearchResult[] = filteredAnime.slice(0, 5).map(r => ({
          ...r,
          mediaType: 'anime' as const
        }))
        const taggedManga: GlobalSearchResult[] = filteredManga.slice(0, 5).map(r => ({
          ...r,
          mediaType: 'manga' as const
        }))

        // Interleave results (anime, manga, anime, manga...) for variety
        const combined: GlobalSearchResult[] = []
        const maxLen = Math.max(taggedAnime.length, taggedManga.length)
        for (let i = 0; i < maxLen; i++) {
          if (i < taggedAnime.length) combined.push(taggedAnime[i])
          if (i < taggedManga.length) combined.push(taggedManga[i])
        }

        // Limit to 10 results total
        setResults(combined.slice(0, 10))
        setSelectedIndex(0)
      } catch (err) {
        console.error('Search failed:', err)
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, animeExtensionId, mangaExtensionId, nsfwFilter])

  const handleSelectResult = (result: GlobalSearchResult) => {
    setSelectedMedia(result)
    // Close spotlight immediately when selecting a result
    onClose()
  }

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            setSelectedMedia(results[selectedIndex])
            onClose()
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [results, selectedIndex, onClose]
  )

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = resultsRef.current?.children[selectedIndex] as HTMLElement
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleCloseMediaModal = () => {
    setSelectedMedia(null)
  }

  return (
    <>
      {/* Spotlight Search UI - only shown when isOpen */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={onClose}
          />

          {/* Spotlight Modal */}
          <div className="fixed inset-0 z-[101] flex items-start justify-center pt-[15vh] px-4">
            <div
              className="w-full max-w-2xl bg-[var(--color-bg-secondary)] rounded-xl shadow-2xl border border-[var(--color-bg-hover)] overflow-hidden animate-in zoom-in-95 fade-in duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Search Input */}
              <div className="relative flex items-center border-b border-[var(--color-bg-hover)]">
                <Search className="absolute left-4 text-[var(--color-text-secondary)]" size={20} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search anime & manga..."
                  className="w-full pl-12 pr-12 py-4 bg-transparent text-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                {loading ? (
                  <Loader2
                    className="absolute right-4 text-[var(--color-accent-primary)] animate-spin"
                    size={20}
                  />
                ) : query ? (
                  <button
                    onClick={() => setQuery('')}
                    className="absolute right-4 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                  >
                    <X size={20} />
                  </button>
                ) : (
                  <kbd className="absolute right-4 px-2 py-1 text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-hover)] rounded">
                    ESC
                  </kbd>
                )}
              </div>

              {/* Results */}
              {query && (
                <div ref={resultsRef} className="max-h-[50vh] overflow-y-auto">
                  {results.length > 0 ? (
                    <div className="py-2">
                      {results.map((result, index) => (
                        <button
                          key={`${result.mediaType}-${result.id}`}
                          onClick={() => handleSelectResult(result)}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={`w-full flex items-center gap-4 px-4 py-3 text-left transition-colors ${
                            index === selectedIndex
                              ? 'bg-[var(--color-accent-primary)]/20'
                              : 'hover:bg-[var(--color-bg-hover)]'
                          }`}
                        >
                          {/* Thumbnail */}
                          <div className="relative flex-shrink-0">
                            {result.cover_url ? (
                              <img
                                src={result.cover_url}
                                alt={result.title}
                                className="w-12 h-16 object-cover rounded-md"
                              />
                            ) : (
                              <div className="w-12 h-16 bg-[var(--color-bg-hover)] rounded-md flex items-center justify-center">
                                {result.mediaType === 'anime' ? (
                                  <Tv size={20} className="text-[var(--color-text-muted)]" />
                                ) : (
                                  <BookOpen size={20} className="text-[var(--color-text-muted)]" />
                                )}
                              </div>
                            )}
                            {/* Media type badge */}
                            <span className={`absolute -top-1 -right-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                              result.mediaType === 'anime'
                                ? 'bg-blue-500 text-white'
                                : 'bg-purple-500 text-white'
                            }`}>
                              {result.mediaType === 'anime' ? 'A' : 'M'}
                            </span>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-[var(--color-text-primary)] truncate">
                              {result.title}
                            </h3>
                            <div className="flex items-center gap-3 mt-1 text-sm text-[var(--color-text-secondary)]">
                              <span className={`flex items-center gap-1 ${
                                result.mediaType === 'anime' ? 'text-blue-400' : 'text-purple-400'
                              }`}>
                                {result.mediaType === 'anime' ? <Tv size={12} /> : <BookOpen size={12} />}
                                {result.mediaType === 'anime' ? 'Anime' : 'Manga'}
                              </span>
                              {result.year && <span>{result.year}</span>}
                              {result.rating && (
                                <span className="flex items-center gap-1">
                                  <Star size={12} className="text-yellow-500 fill-yellow-500" />
                                  {result.rating.toFixed(1)}
                                </span>
                              )}
                              {result.status && (
                                <span
                                  className={`${
                                    result.status.toLowerCase() === 'ongoing'
                                      ? 'text-green-400'
                                      : 'text-[var(--color-text-muted)]'
                                  }`}
                                >
                                  {result.status}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Arrow indicator */}
                          <ChevronRight
                            size={20}
                            className={`flex-shrink-0 ${
                              index === selectedIndex
                                ? 'text-[var(--color-accent-primary)]'
                                : 'text-[var(--color-text-muted)]'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  ) : !loading ? (
                    <div className="py-12 text-center text-[var(--color-text-secondary)]">
                      <Search size={40} className="mx-auto mb-3 opacity-50" />
                      <p>No results found for "{query}"</p>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Empty State / Hint */}
              {!query && (
                <div className="py-8 text-center text-[var(--color-text-secondary)]">
                  <p className="text-sm">Start typing to search anime & manga</p>
                  <div className="mt-3 flex items-center justify-center gap-4 text-xs text-[var(--color-text-muted)]">
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 bg-[var(--color-bg-hover)] rounded">↑↓</kbd>
                      Navigate
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 bg-[var(--color-bg-hover)] rounded">Enter</kbd>
                      Select
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 bg-[var(--color-bg-hover)] rounded">Esc</kbd>
                      Close
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Media Detail Modal - rendered outside spotlight so it persists after spotlight closes */}
      {selectedMedia && selectedMedia.mediaType === 'anime' && animeExtensionId && (
        <MediaDetailModal
          media={selectedMedia}
          extensionId={animeExtensionId}
          isOpen={true}
          onClose={handleCloseMediaModal}
          onMediaChange={(media) => setSelectedMedia(media ? { ...media, mediaType: 'anime' } : null)}
        />
      )}

      {/* Manga Detail Modal */}
      {selectedMedia && selectedMedia.mediaType === 'manga' && mangaExtensionId && (
        <MangaDetailModal
          manga={selectedMedia}
          extensionId={mangaExtensionId}
          onClose={handleCloseMediaModal}
        />
      )}
    </>
  )
}
