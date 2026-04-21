/**
 * Manga Route - Manga Browser Page
 *
 * Browse manga with Jikan-powered carousels for discovery,
 * Mangakakalot for search, details, chapters, and reading.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Loader2, X, Tag as TagIcon } from 'lucide-react'
import {
  discoverManga,
  jikanTopManga,
  searchManga,
} from '@/utils/tauri-commands'
import type { Tag } from '@/utils/tauri-commands'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaCarousel } from '@/components/media/MediaCarousel'
import { MangaDetailModal } from '@/components/media/MangaDetailModal'
import { ContinueReadingSection } from '@/components/media/ContinueReadingSection'
import { GenreFilterBar } from '@/components/media/GenreFilterBar'
import { BrowseSidebar, type BrowseFilters, type NavItem } from '@/components/browse/BrowseSidebar'
import { BrowseHeader } from '@/components/browse/BrowseHeader'
import { ActiveFilterChips, type FilterChip } from '@/components/browse/ActiveFilterChips'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import { useJikanQuery, CACHE_TTL } from '@/hooks/useJikanQuery'
import type { SearchResult } from '@/types/extension'
import { useSettingsStore } from '@/store/settingsStore'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import { consumePendingReturn } from '@/utils/return-media'
import { loadBundledMangaExtensions, resolveJikanToMangakakalot, MANGAKAKALOT_GENRES, type MangaExtensionIds } from '@/utils/manga-extensions'

// Debounce delay for instant search (ms)
const SEARCH_DEBOUNCE_MS = 300

export const Route = createFileRoute('/manga')({
  component: MangaScreen,
})

interface SelectedManga {
  manga: SearchResult
  extensionId: string
}

function MangaScreen() {
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const { getStatus, refresh: refreshStatus } = useMediaStatusContext()
  const searchInputRef = useRef<HTMLInputElement>(null)

  const genreLoadMoreRef = useRef<HTMLDivElement>(null)
  const [mangaExtensionIds, setMangaExtensionIds] = useState<Partial<MangaExtensionIds>>({})
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedManga, setSelectedManga] = useState<SelectedManga | null>(null)

  // Restore modal state when returning from read page
  useEffect(() => {
    const manga = consumePendingReturn('manga')
    if (manga) {
      setSelectedManga({
        manga,
        extensionId: manga._returnExtensionId || '',
      })
    }
  }, [])

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeNav, setActiveNav] = useState<NavItem>('browse')
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: currentYear - 1999 }, (_, i) => currentYear - i)
  const [browseFilters, setBrowseFilters] = useState<BrowseFilters>({
    types: [],
    statuses: [],
    minScore: 0,
    genres: new Set(),
    orderBy: 'popularity',
    sort: 'desc',
  })
  const [sortBy, setSortBy] = useState('popularity')

  // When 18+ toggle is active in sidebar, override SFW filter to show adult content
  const effectiveSfw = browseFilters.nsfw ? false : nsfwFilter

  // Detect when sidebar filters are active
  const hasActiveFilters =
    browseFilters.types.length > 0 ||
    browseFilters.statuses.length > 0 ||
    browseFilters.genres.size > 0 ||
    browseFilters.minScore > 0 ||
    browseFilters.nsfw

  // Filtered browse state (used when hasActiveFilters on browse tab)
  const filteredBrowseLoadMoreRef = useRef<HTMLDivElement>(null)
  const [filteredBrowseItems, setFilteredBrowseItems] = useState<SearchResult[]>([])
  const [filteredBrowseLoading, setFilteredBrowseLoading] = useState(false)
  const [filteredBrowsePage, setFilteredBrowsePage] = useState(1)
  const [filteredBrowseHasNext, setFilteredBrowseHasNext] = useState(true)
  const [filteredBrowseLoadingMore, setFilteredBrowseLoadingMore] = useState(false)
  const filteredBrowseSeenRef = useRef<Set<string>>(new Set())

  // Genre state
  const [mangaGenres, setMangaGenres] = useState<Tag[]>([])
  const [genresLoading] = useState(false)
  const [selectedGenreIds, setSelectedGenreIds] = useState<Set<number>>(new Set())
  const [genreFilters, setGenreFilters] = useState({
    orderBy: '',
    sort: 'desc',
    status: '',
    type: '',
  })
  const [genreResults, setGenreResults] = useState<SearchResult[]>([])
  const [genreResultsLoading, setGenreResultsLoading] = useState(false)
  const [genrePage, setGenrePage] = useState(1)
  const [genreHasNextPage, setGenreHasNextPage] = useState(true)
  const [genreLoadingMore, setGenreLoadingMore] = useState(false)
  const genreSeenIdsRef = useRef<Set<string>>(new Set())

  const genreSlugById = useCallback(
    (id: number) => mangaGenres.find((genre) => genre.id === id)?.slug,
    [mangaGenres]
  )

  // Top-rated full grid state
  const topRatedLoadMoreRef = useRef<HTMLDivElement>(null)
  const [topRatedItems, setTopRatedItems] = useState<SearchResult[]>([])
  const [topRatedLoading, setTopRatedLoading] = useState(false)
  const [topRatedPage, setTopRatedPage] = useState(1)
  const [topRatedHasNext, setTopRatedHasNext] = useState(true)
  const [topRatedLoadingMore, setTopRatedLoadingMore] = useState(false)
  const topRatedSeenRef = useRef<Set<string>>(new Set())

  // Publishing full grid state
  const publishingLoadMoreRef = useRef<HTMLDivElement>(null)
  const [publishingItems, setPublishingItems] = useState<SearchResult[]>([])
  const [publishingLoading, setPublishingLoading] = useState(false)
  const [publishingPage, setPublishingPage] = useState(1)
  const [publishingHasNext, setPublishingHasNext] = useState(true)
  const [publishingLoadingMore, setPublishingLoadingMore] = useState(false)
  const publishingSeenRef = useRef<Set<string>>(new Set())

  // Load bundled manga extensions lazily
  useEffect(() => {
    loadBundledMangaExtensions()
      .then(setMangaExtensionIds)
      .catch(() => {})
  }, [])

  // Jikan-powered browse carousels (good curation, covers, scores)
  const trending = useJikanQuery({
    cacheKey: `manga:trending:sfw=${effectiveSfw}`,
    fetcher: () => jikanTopManga(1, undefined, undefined, effectiveSfw),
    ttlSeconds: CACHE_TTL.TOP_RATED,
    mediaType: 'manga',
  })

  const popular = useJikanQuery({
    cacheKey: `manga:popular:sfw=${effectiveSfw}`,
    fetcher: () => jikanTopManga(1, undefined, 'bypopularity', effectiveSfw),
    ttlSeconds: CACHE_TTL.POPULAR,
    mediaType: 'manga',
  })

  const favorite = useJikanQuery({
    cacheKey: `manga:favorite:sfw=${effectiveSfw}`,
    fetcher: () => jikanTopManga(1, undefined, 'favorite', effectiveSfw),
    ttlSeconds: CACHE_TTL.POPULAR,
    mediaType: 'manga',
  })

  const publishing = useJikanQuery({
    cacheKey: `manga:publishing:sfw=${effectiveSfw}`,
    fetcher: () => jikanTopManga(1, undefined, 'publishing', effectiveSfw),
    ttlSeconds: CACHE_TTL.AIRING,
    mediaType: 'manga',
  })

  // Debounced instant search - Mangakakalot only
  useEffect(() => {
    if (!searchInput.trim()) {
      setSearchResults([])
      return
    }

    setSearchLoading(true)
    const timer = setTimeout(async () => {
      try {
        if (mangaExtensionIds.mangakakalot) {
          const results = await searchManga(mangaExtensionIds.mangakakalot, searchInput, 1, !effectiveSfw)
          const filtered = filterNsfwContent(
            results.results,
            (item) => item.genres,
            effectiveSfw,
            (item) => `${item.title || ''} ${item.description || ''}`
          )
          setSearchResults(filtered)
        }
      } catch (err) {
        console.error('Manga search failed:', err)
      } finally {
        setSearchLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [searchInput, effectiveSfw, mangaExtensionIds])

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchInput('')
    setSearchResults([])
    searchInputRef.current?.focus()
  }, [])

  const handleMediaClick = async (item: SearchResult, extensionId?: string) => {
    const extId = extensionId || mangaExtensionIds.mangakakalot || ''
    if (!extId) return

    const isJikanItem = /^\d+$/.test(item.id)
    if (!isJikanItem) {
      setSelectedManga({ manga: item, extensionId: extId })
      return
    }

    const resolved = await resolveJikanToMangakakalot(extId, item.title)
    if (resolved) {
      setSelectedManga({
        manga: { ...resolved, cover_url: resolved.cover_url || item.cover_url },
        extensionId: extId,
      })
    } else {
      setSelectedManga({ manga: item, extensionId: extId })
    }
  }

  // === FILTERED BROWSE: Fetch when sidebar filters are active on browse tab ===
  useEffect(() => {
    if (activeNav !== 'browse' || !hasActiveFilters) {
      setFilteredBrowseItems([])
      return
    }
    if (!mangaExtensionIds.mangakakalot) return
    setFilteredBrowseLoading(true)
    setFilteredBrowsePage(1)
    filteredBrowseSeenRef.current.clear()

    const genreSlugs = Array.from(browseFilters.genres)
      .map((id) => genreSlugById(id))
      .filter((slug): slug is string => Boolean(slug))
    discoverManga(
      mangaExtensionIds.mangakakalot,
      1,
      browseFilters.orderBy === 'score' ? 'score' : 'update',
      genreSlugs,
      !effectiveSfw
    )
      .then((result) => {
        const filtered = filterNsfwContent(
          result.results,
          (item) => item.genres,
          effectiveSfw,
          (item) => item.title
        )
        filtered.forEach((item) => filteredBrowseSeenRef.current.add(item.id))
        setFilteredBrowseItems(filtered)
        setFilteredBrowseHasNext(result.has_next_page)
      })
      .catch((err) => console.error('Filtered manga browse failed:', err))
      .finally(() => setFilteredBrowseLoading(false))
  }, [activeNav, hasActiveFilters, browseFilters, effectiveSfw, genreSlugById, mangaExtensionIds])

  // Filtered browse: load more
  const loadMoreFilteredBrowse = useCallback(async () => {
    if (filteredBrowseLoadingMore || !filteredBrowseHasNext) return
    setFilteredBrowseLoadingMore(true)
    try {
      if (!mangaExtensionIds.mangakakalot) return
      const nextPage = filteredBrowsePage + 1
      const genreSlugs = Array.from(browseFilters.genres)
        .map((id) => genreSlugById(id))
        .filter((slug): slug is string => Boolean(slug))
      const result = await discoverManga(
        mangaExtensionIds.mangakakalot,
        nextPage,
        browseFilters.orderBy === 'score' ? 'score' : 'update',
        genreSlugs,
        !effectiveSfw
      )
      const filtered = filterNsfwContent(
        result.results,
        (item) => item.genres,
        effectiveSfw,
        (item) => `${item.title || ''} ${item.description || ''}`
      )
      const newItems = filtered.filter((item) => {
        if (filteredBrowseSeenRef.current.has(item.id)) return false
        filteredBrowseSeenRef.current.add(item.id)
        return true
      })
      setFilteredBrowseItems((prev) => [...prev, ...newItems])
      setFilteredBrowsePage(nextPage)
      setFilteredBrowseHasNext(result.has_next_page)
    } catch (err) {
      console.error('Failed to load more filtered manga:', err)
    } finally {
      setFilteredBrowseLoadingMore(false)
    }
  }, [
    filteredBrowsePage,
    filteredBrowseHasNext,
    filteredBrowseLoadingMore,
    browseFilters,
    effectiveSfw,
    genreSlugById,
    mangaExtensionIds,
  ])

  // Filtered browse intersection observer
  useEffect(() => {
    if (activeNav !== 'browse' || !hasActiveFilters) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          filteredBrowseHasNext &&
          !filteredBrowseLoadingMore &&
          !filteredBrowseLoading
        ) {
          loadMoreFilteredBrowse()
        }
      },
      { threshold: 0.1 }
    )
    if (filteredBrowseLoadMoreRef.current) observer.observe(filteredBrowseLoadMoreRef.current)
    return () => observer.disconnect()
  }, [
    activeNav,
    hasActiveFilters,
    filteredBrowseHasNext,
    filteredBrowseLoadingMore,
    filteredBrowseLoading,
    loadMoreFilteredBrowse,
  ])

  // === GENRE: Fetch genres list ===
  useEffect(() => {
    if (mangaGenres.length > 0) return
    setMangaGenres(MANGAKAKALOT_GENRES.map(g => ({ ...g, count: 0 })))
  }, [mangaGenres.length])

  // Genre: fetch results when genres/filters change
  useEffect(() => {
    if (activeNav !== 'genres') return
    if (
      selectedGenreIds.size === 0 &&
      !genreFilters.orderBy &&
      !genreFilters.status &&
      !genreFilters.type
    ) {
      setGenreResults([])
      setGenreHasNextPage(false)
      return
    }

    const fetchGenreResults = async () => {
      setGenreResultsLoading(true)
      setGenrePage(1)
      genreSeenIdsRef.current.clear()
      try {
        if (!mangaExtensionIds.mangakakalot) return
        const genreSlugs = Array.from(selectedGenreIds)
          .map((id) => genreSlugById(id))
          .filter((slug): slug is string => Boolean(slug))
        const result = await discoverManga(
          mangaExtensionIds.mangakakalot,
          1,
          genreFilters.orderBy === 'score' ? 'score' : 'update',
          genreSlugs,
          !effectiveSfw
        )
        const filtered = filterNsfwContent(
          result.results,
          (item) => item.genres,
          effectiveSfw,
          (item) => item.title
        )
        filtered.forEach((item) => genreSeenIdsRef.current.add(item.id))
        setGenreResults(filtered)
        setGenreHasNextPage(result.has_next_page)
      } catch (err) {
        console.error('Manga genre search failed:', err)
      } finally {
        setGenreResultsLoading(false)
      }
    }

    fetchGenreResults()
  }, [activeNav, selectedGenreIds, genreFilters, effectiveSfw, genreSlugById, mangaExtensionIds])

  // Load more genre results
  const loadMoreGenreResults = useCallback(async () => {
    if (genreLoadingMore || !genreHasNextPage) return

    setGenreLoadingMore(true)
    try {
      if (!mangaExtensionIds.mangakakalot) return
      const nextPage = genrePage + 1
      const genreSlugs = Array.from(selectedGenreIds)
        .map((id) => genreSlugById(id))
        .filter((slug): slug is string => Boolean(slug))
      const result = await discoverManga(
        mangaExtensionIds.mangakakalot,
        nextPage,
        genreFilters.orderBy === 'score' ? 'score' : 'update',
        genreSlugs,
        !effectiveSfw
      )

      const filtered = filterNsfwContent(
        result.results,
        (item) => item.genres,
        effectiveSfw,
        (item) => `${item.title || ''} ${item.description || ''}`
      )

      const newResults = filtered.filter((item) => {
        if (genreSeenIdsRef.current.has(item.id)) return false
        genreSeenIdsRef.current.add(item.id)
        return true
      })

      setGenreResults((prev) => [...prev, ...newResults])
      setGenrePage(nextPage)
      setGenreHasNextPage(result.has_next_page)
    } catch (err) {
      console.error('Failed to load more manga genre results:', err)
    } finally {
      setGenreLoadingMore(false)
    }
  }, [genrePage, genreHasNextPage, genreLoadingMore, selectedGenreIds, genreFilters, effectiveSfw, genreSlugById, mangaExtensionIds])

  // Intersection observer for genre tab infinite scroll
  useEffect(() => {
    if (activeNav !== 'genres') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          genreHasNextPage &&
          !genreLoadingMore &&
          !genreResultsLoading
        ) {
          loadMoreGenreResults()
        }
      },
      { threshold: 0.1 }
    )

    if (genreLoadMoreRef.current) {
      observer.observe(genreLoadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [activeNav, genreHasNextPage, genreLoadingMore, genreResultsLoading, loadMoreGenreResults])

  // === TOP-RATED: Fetch page 1 when nav switches ===
  useEffect(() => {
    if (activeNav !== 'top-rated') return
    if (topRatedItems.length > 0) return
    setTopRatedLoading(true)
    topRatedSeenRef.current.clear()
    jikanTopManga(1, undefined, undefined, effectiveSfw)
      .then((result) => {
        const filtered = filterNsfwContent(
          result.results,
          (item) => item.genres,
          effectiveSfw,
          (item) => item.title
        )
        filtered.forEach((item) => topRatedSeenRef.current.add(item.id))
        setTopRatedItems(filtered)
        setTopRatedHasNext(result.has_next_page)
      })
      .catch((err) => console.error('Failed to load top-rated manga:', err))
      .finally(() => setTopRatedLoading(false))
  }, [activeNav, effectiveSfw, topRatedItems.length])

  const loadMoreTopRated = useCallback(async () => {
    if (topRatedLoadingMore || !topRatedHasNext) return
    setTopRatedLoadingMore(true)
    try {
      const nextPage = topRatedPage + 1
      const result = await jikanTopManga(nextPage, undefined, undefined, effectiveSfw)
      const filtered = filterNsfwContent(
        result.results,
        (item) => item.genres,
        effectiveSfw,
        (item) => `${item.title || ''} ${item.description || ''}`
      )
      const newItems = filtered.filter((item) => {
        if (topRatedSeenRef.current.has(item.id)) return false
        topRatedSeenRef.current.add(item.id)
        return true
      })
      setTopRatedItems((prev) => [...prev, ...newItems])
      setTopRatedPage(nextPage)
      setTopRatedHasNext(result.has_next_page)
    } catch (err) {
      console.error('Failed to load more top-rated manga:', err)
    } finally {
      setTopRatedLoadingMore(false)
    }
  }, [topRatedPage, topRatedHasNext, topRatedLoadingMore, effectiveSfw])

  // Top-rated intersection observer
  useEffect(() => {
    if (activeNav !== 'top-rated') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          topRatedHasNext &&
          !topRatedLoadingMore &&
          !topRatedLoading
        ) {
          loadMoreTopRated()
        }
      },
      { threshold: 0.1 }
    )
    if (topRatedLoadMoreRef.current) observer.observe(topRatedLoadMoreRef.current)
    return () => observer.disconnect()
  }, [activeNav, topRatedHasNext, topRatedLoadingMore, topRatedLoading, loadMoreTopRated])

  // === PUBLISHING: Fetch page 1 when nav switches ===
  useEffect(() => {
    if (activeNav !== 'season') return
    if (publishingItems.length > 0) return
    setPublishingLoading(true)
    publishingSeenRef.current.clear()
    jikanTopManga(1, undefined, 'publishing', effectiveSfw)
      .then((result) => {
        const filtered = filterNsfwContent(
          result.results,
          (item) => item.genres,
          effectiveSfw,
          (item) => item.title
        )
        filtered.forEach((item) => publishingSeenRef.current.add(item.id))
        setPublishingItems(filtered)
        setPublishingHasNext(result.has_next_page)
      })
      .catch((err) => console.error('Failed to load publishing manga:', err))
      .finally(() => setPublishingLoading(false))
  }, [activeNav, effectiveSfw, publishingItems.length])

  const loadMorePublishing = useCallback(async () => {
    if (publishingLoadingMore || !publishingHasNext) return
    setPublishingLoadingMore(true)
    try {
      const nextPage = publishingPage + 1
      const result = await jikanTopManga(nextPage, undefined, 'publishing', effectiveSfw)
      const filtered = filterNsfwContent(
        result.results,
        (item) => item.genres,
        effectiveSfw,
        (item) => `${item.title || ''} ${item.description || ''}`
      )
      const newItems = filtered.filter((item) => {
        if (publishingSeenRef.current.has(item.id)) return false
        publishingSeenRef.current.add(item.id)
        return true
      })
      setPublishingItems((prev) => [...prev, ...newItems])
      setPublishingPage(nextPage)
      setPublishingHasNext(result.has_next_page)
    } catch (err) {
      console.error('Failed to load more publishing manga:', err)
    } finally {
      setPublishingLoadingMore(false)
    }
  }, [publishingPage, publishingHasNext, publishingLoadingMore, effectiveSfw])

  // Publishing intersection observer
  useEffect(() => {
    if (activeNav !== 'season') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          publishingHasNext &&
          !publishingLoadingMore &&
          !publishingLoading
        ) {
          loadMorePublishing()
        }
      },
      { threshold: 0.1 }
    )
    if (publishingLoadMoreRef.current) observer.observe(publishingLoadMoreRef.current)
    return () => observer.disconnect()
  }, [activeNav, publishingHasNext, publishingLoadingMore, publishingLoading, loadMorePublishing])

  // Build active filter chips from sidebar filters
  const activeFilterChips: FilterChip[] = [
    ...browseFilters.types.map((t) => ({ key: t, label: t, group: 'type' })),
    ...browseFilters.statuses.map((s) => ({ key: s, label: s, group: 'status' })),
    ...(browseFilters.nsfw ? [{ key: 'nsfw', label: '18+', group: 'nsfw' }] : []),
    ...(browseFilters.minScore > 0
      ? [{ key: 'score', label: `Score >= ${browseFilters.minScore}`, group: 'score' }]
      : []),
    ...Array.from(browseFilters.genres).map((id) => {
      const genre = mangaGenres.find((g) => g.id === id)
      return { key: String(id), label: genre?.name || String(id), group: 'genre' }
    }),
  ]

  const handleRemoveFilterChip = (key: string, group: string) => {
    if (group === 'type') {
      setBrowseFilters((f) => ({ ...f, types: f.types.filter((t) => t !== key) }))
    } else if (group === 'status') {
      setBrowseFilters((f) => ({ ...f, statuses: f.statuses.filter((s) => s !== key) }))
    } else if (group === 'score') {
      setBrowseFilters((f) => ({ ...f, minScore: 0 }))
    } else if (group === 'nsfw') {
      setBrowseFilters((f) => ({ ...f, nsfw: false }))
    } else if (group === 'genre') {
      setBrowseFilters((f) => {
        const next = new Set(f.genres)
        next.delete(Number(key))
        return { ...f, genres: next }
      })
    }
  }

  const handleClearAllFilters = () => {
    setBrowseFilters({
      types: [],
      statuses: [],
      minScore: 0,
      genres: new Set(),
      orderBy: 'popularity',
      sort: 'desc',
      nsfw: false,
    })
  }

  // Keyboard shortcuts
  useKeyboardShortcut(
    {
      '/': (e) => {
        e.preventDefault()
        searchInputRef.current?.focus()
      },
    },
    []
  )

  const carousels = [
    { title: 'Most Popular', hook: popular },
    { title: 'Recommended', hook: favorite },
    { title: 'Publishing Now', hook: publishing },
  ]

  // Determine result count for header
  const resultCount = searchInput
    ? searchResults.length
    : activeNav === 'genres'
      ? genreResults.length
      : activeNav === 'top-rated'
        ? topRatedItems.length
        : activeNav === 'season'
          ? publishingItems.length
          : activeNav === 'browse' && hasActiveFilters
            ? filteredBrowseItems.length
            : undefined

  // Determine header title based on nav
  const headerTitle = searchInput
    ? 'Search Results'
    : activeNav === 'top-rated'
      ? 'Top Rated'
      : activeNav === 'season'
        ? 'Publishing'
        : activeNav === 'genres'
          ? 'By Genre'
          : 'Browse'

  return (
    <div className="flex min-h-[calc(100vh-4rem)] overflow-visible">
      {/* Sidebar */}
      <BrowseSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeNav={activeNav}
        onNavChange={setActiveNav}
        filters={browseFilters}
        onFiltersChange={setBrowseFilters}
        mediaType="manga"
        genres={mangaGenres}
        genresLoading={genresLoading}
        yearOptions={yearOptions}
      />

      {/* Main Content */}
      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 3xl:px-12 py-8 overflow-visible">
        {/* Browse Header with sort */}
        <BrowseHeader
          title={headerTitle}
          resultCount={resultCount}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />

        {/* Active Filter Chips */}
        <ActiveFilterChips
          filters={activeFilterChips}
          onRemove={handleRemoveFilterChip}
          onClearAll={handleClearAllFilters}
        />

        {/* Search Bar */}
        <div className="max-w-2xl mt-4 mb-4">
          <div className="relative">
            {searchLoading ? (
              <Loader2
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-accent-primary)] animate-spin"
                size={16}
              />
            ) : (
              <Search
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                size={16}
              />
            )}
            <input
              ref={searchInputRef}
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search for manga..."
              className="w-full pl-10 pr-10 py-2.5 bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-[var(--radius-md)] text-sm text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
            />
            {searchInput && (
              <button
                onClick={handleClearSearch}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-white transition-colors"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>

        </div>

        {/* Search Results / Genre Browse / Carousels */}
        {searchInput ? (
          <div>
            {searchResults.length > 0 && (
              <div className="overflow-visible">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 overflow-visible">
                  {searchResults.map((item) => (
                    <MediaCard
                      key={item.id}
                      media={item}
                        onClick={() => handleMediaClick(item, mangaExtensionIds.mangakakalot)}
                        status={getStatus(item.id)}
                      />
                  ))}
                </div>
              </div>
            )}

            {!searchLoading && searchInput && searchResults.length === 0 && (
              <div className="text-center py-12">
                <p className="text-[var(--color-text-secondary)]">
                  No manga found for "{searchInput}"
                </p>
              </div>
            )}
          </div>
        ) : activeNav === 'genres' ? (
          // ========== GENRE BROWSE MODE ==========
          <div>
            <GenreFilterBar
              genres={mangaGenres}
              selectedGenreIds={selectedGenreIds}
              onToggleGenre={(id) => {
                setSelectedGenreIds((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) {
                    next.delete(id)
                  } else {
                    next.add(id)
                  }
                  return next
                })
              }}
              filters={genreFilters}
              onFilterChange={setGenreFilters}
              mediaType="manga"
              loading={genresLoading}
            />

            <div className="mt-6">
              {genreResultsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
                </div>
              ) : genreResults.length > 0 ? (
                <div className="overflow-visible">
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 overflow-visible">
                    {genreResults.map((item) => (
                      <MediaCard
                        key={item.id}
                        media={item}
                        onClick={() => handleMediaClick(item)}
                        status={getStatus(item.id)}
                      />
                    ))}
                  </div>

                  <div ref={genreLoadMoreRef} className="py-8 flex items-center justify-center">
                    {genreLoadingMore && (
                      <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
                    )}
                    {!genreHasNextPage && genreResults.length > 0 && (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        You've reached the end
                      </p>
                    )}
                  </div>
                </div>
              ) : selectedGenreIds.size > 0 ||
                genreFilters.orderBy ||
                genreFilters.status ||
                genreFilters.type ? (
                <div className="text-center py-12">
                  <p className="text-[var(--color-text-secondary)]">
                    No manga found matching the selected filters
                  </p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <TagIcon className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-3" />
                  <p className="text-[var(--color-text-secondary)]">
                    Select one or more genres to browse manga
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : activeNav === 'top-rated' ? (
          // ========== TOP RATED GRID ==========
          <div>
            {topRatedLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
              </div>
            ) : topRatedItems.length > 0 ? (
              <div className="overflow-visible">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 overflow-visible">
                  {topRatedItems.map((item) => (
                    <MediaCard
                      key={item.id}
                      media={item}
                      onClick={() => handleMediaClick(item)}
                      status={getStatus(item.id)}
                    />
                  ))}
                </div>

                <div ref={topRatedLoadMoreRef} className="py-8 flex items-center justify-center">
                  {topRatedLoadingMore && (
                    <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
                  )}
                  {!topRatedHasNext && topRatedItems.length > 0 && (
                    <p className="text-sm text-[var(--color-text-muted)]">You've reached the end</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-[var(--color-text-secondary)]">No manga found</p>
              </div>
            )}
          </div>
        ) : activeNav === 'season' ? (
          // ========== PUBLISHING GRID ==========
          <div>
            {publishingLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
              </div>
            ) : publishingItems.length > 0 ? (
              <div className="overflow-visible">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 overflow-visible">
                  {publishingItems.map((item) => (
                    <MediaCard
                      key={item.id}
                      media={item}
                      onClick={() => handleMediaClick(item)}
                      status={getStatus(item.id)}
                    />
                  ))}
                </div>

                <div ref={publishingLoadMoreRef} className="py-8 flex items-center justify-center">
                  {publishingLoadingMore && (
                    <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
                  )}
                  {!publishingHasNext && publishingItems.length > 0 && (
                    <p className="text-sm text-[var(--color-text-muted)]">You've reached the end</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-[var(--color-text-secondary)]">No publishing manga found</p>
              </div>
            )}
          </div>
        ) : hasActiveFilters ? (
          // ========== FILTERED BROWSE ==========
          <div>
            {filteredBrowseLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
              </div>
            ) : filteredBrowseItems.length > 0 ? (
              <div className="overflow-visible">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 overflow-visible">
                  {filteredBrowseItems.map((item) => (
                    <MediaCard
                      key={item.id}
                      media={item}
                      onClick={() => handleMediaClick(item)}
                      status={getStatus(item.id)}
                    />
                  ))}
                </div>

                <div
                  ref={filteredBrowseLoadMoreRef}
                  className="py-8 flex items-center justify-center"
                >
                  {filteredBrowseLoadingMore && (
                    <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
                  )}
                  {!filteredBrowseHasNext && filteredBrowseItems.length > 0 && (
                    <p className="text-sm text-[var(--color-text-muted)]">You've reached the end</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-[var(--color-text-secondary)]">
                  No manga found matching the selected filters
                </p>
              </div>
            )}
          </div>
        ) : (
          // ========== BROWSE (default) ==========
          <>
            {/* Continue Reading Section */}
            <ContinueReadingSection />

            {/* Top 10 Manga */}
            {trending.data.length >= 10 && (
              <MediaCarousel
                title="Top 10 Manga"
                items={trending.data.slice(0, 10)}
                loading={false}
                onItemClick={handleMediaClick}
                showRank
              />
            )}
            {trending.loading && (
              <MediaCarousel
                title="Top 10 Manga"
                items={[]}
                loading={true}
                onItemClick={handleMediaClick}
                showRank
              />
            )}

            {/* Content Carousels */}
            <div className="space-y-8 overflow-visible">
              {carousels.map(({ title, hook }) => (
                <MediaCarousel
                  key={title}
                  title={title}
                  items={hook.data}
                  loading={hook.loading}
                  onItemClick={handleMediaClick}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Manga Detail Modal */}
      {selectedManga && (
        <MangaDetailModal
          manga={selectedManga.manga}
          extensionId={selectedManga.extensionId || mangaExtensionIds.mangakakalot || ''}
          onClose={() => {
            setSelectedManga(null)
            refreshStatus()
          }}
        />
      )}
    </div>
  )
}
