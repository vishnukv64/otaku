import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Loader2, AlertCircle, Star, Tag as TagIcon, Search, X } from 'lucide-react'
import { useMediaStore } from '@/store/mediaStore'
import {
  loadExtension,
  jikanTopAnime,
  jikanSeasonNow,
  jikanSeason,
  getContinueWatchingWithDetails,
  jikanGenresAnime,
  jikanSearchAnimeFiltered,
} from '@/utils/tauri-commands'
import type { Tag } from '@/utils/tauri-commands'
import { MediaCard } from '@/components/media/MediaCard'
import { MediaDetailModal } from '@/components/media/MediaDetailModal'
import { GenreFilterBar } from '@/components/media/GenreFilterBar'
import { BrowseSidebar } from '@/components/browse/BrowseSidebar'
import { BrowseHeader } from '@/components/browse/BrowseHeader'
import { ActiveFilterChips } from '@/components/browse/ActiveFilterChips'
import type { BrowseFilters, NavItem } from '@/components/browse/BrowseSidebar'
import type { FilterChip } from '@/components/browse/ActiveFilterChips'
import { ALLANIME_EXTENSION } from '@/extensions/allanime-extension'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import { useJikanQuery, CACHE_TTL } from '@/hooks/useJikanQuery'
import type { SearchResult } from '@/types/extension'
import { useSettingsStore } from '@/store/settingsStore'
import { filterNsfwContent } from '@/utils/nsfw-filter'
import { consumePendingReturn } from '@/utils/return-media'

// Debounce delay for instant search (ms)
const SEARCH_DEBOUNCE_MS = 300

/**
 * Calculate the current anime season based on date.
 * Anime seasons: Winter (Jan-Mar), Spring (Apr-Jun), Summer (Jul-Sep), Fall (Oct-Dec)
 */
function getCurrentAnimeSeason(): { season: string; year: number } {
  const now = new Date()
  const month = now.getMonth() // 0-indexed
  const year = now.getFullYear()

  // Determine season based on month
  if (month >= 0 && month <= 2) {
    return { season: 'Winter', year }
  } else if (month >= 3 && month <= 5) {
    return { season: 'Spring', year }
  } else if (month >= 6 && month <= 8) {
    return { season: 'Summer', year }
  } else {
    return { season: 'Fall', year }
  }
}

export const Route = createFileRoute('/anime')({
  component: AnimeScreen,
})

type TabType = 'browse' | 'season' | 'genres'

const defaultFilters: BrowseFilters = {
  year: undefined,
  types: [],
  statuses: [],
  minScore: 0,
  genres: new Set(),
  orderBy: 'popularity',
  sort: 'desc',
}

function AnimeScreen() {
  const nsfwFilter = useSettingsStore((state) => state.nsfwFilter)
  const { getStatus, refresh: refreshStatus } = useMediaStatusContext()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const seasonLoadMoreRef = useRef<HTMLDivElement>(null)
  const genreLoadMoreRef = useRef<HTMLDivElement>(null)
  const [allanimeExtId, setAllanimeExtId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null)

  // Restore modal state when returning from watch page
  useEffect(() => {
    const media = consumePendingReturn('anime')
    if (media) setSelectedMedia(media)
  }, [])

  // Browse tab infinite scroll state (pages 2+)
  const [browseExtraItems, setBrowseExtraItems] = useState<SearchResult[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [browseHasNextPage, setBrowseHasNextPage] = useState(true)
  const browseSeenIdsRef = useRef<Set<string>>(new Set())

  // Personalized recommendations state (used by browse fetcher logic)
  const [_userWatchingGenres, setUserWatchingGenres] = useState<string[]>([])
  const [_hasWatchHistory, setHasWatchHistory] = useState(false)

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarFilters, setSidebarFilters] = useState<BrowseFilters>(defaultFilters)
  const [sidebarNav, setSidebarNav] = useState<NavItem>('browse')

  // Tab state (driven by sidebar nav)
  const [activeTab, setActiveTab] = useState<TabType>('browse')

  // Current season info (for tab label)
  const [currentSeasonInfo] = useState<{ season: string; year: number }>(getCurrentAnimeSeason)

  // Season browser selection state
  const seasonOptions = ['winter', 'spring', 'summer', 'fall']
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: currentYear - 1999 }, (_, i) => currentYear - i)
  const [selectedYear, setSelectedYear] = useState(currentSeasonInfo.year)
  const [selectedSeason, setSelectedSeason] = useState(currentSeasonInfo.season.toLowerCase())

  // Season tab infinite scroll state (pages 2+)
  const [seasonExtraItems, setSeasonExtraItems] = useState<SearchResult[]>([])
  const [fullSeasonLoadingMore, setFullSeasonLoadingMore] = useState(false)
  const [fullSeasonPage, setFullSeasonPage] = useState(1)
  const [fullSeasonHasNextPage, setFullSeasonHasNextPage] = useState(true)
  const fullSeasonSeenIdsRef = useRef<Set<string>>(new Set())

  // Genre tab state
  const [animeGenres, setAnimeGenres] = useState<Tag[]>([])
  const [genresLoading, setGenresLoading] = useState(false)
  const [selectedGenreIds, setSelectedGenreIds] = useState<Set<number>>(new Set())
  const [genreFilters, setGenreFilters] = useState({ orderBy: '', sort: 'desc', status: '', type: '' })
  const [genreResults, setGenreResults] = useState<SearchResult[]>([])
  const [genreResultsLoading, setGenreResultsLoading] = useState(false)
  const [genrePage, setGenrePage] = useState(1)
  const [genreHasNextPage, setGenreHasNextPage] = useState(true)
  const [genreLoadingMore, setGenreLoadingMore] = useState(false)
  const genreSeenIdsRef = useRef<Set<string>>(new Set())

  // Sidebar nav → tab mapping
  const handleSidebarNav = useCallback((nav: NavItem) => {
    setSidebarNav(nav)
    if (nav === 'browse' || nav === 'top-rated') setActiveTab('browse')
    else if (nav === 'season') setActiveTab('season')
    else if (nav === 'genres') setActiveTab('genres')
  }, [])

  // Year options for sidebar
  const sidebarYearOptions = Array.from({ length: currentYear - 1999 }, (_, i) => currentYear - i)

  // Build active filter chips from sidebar filters
  const activeFilterChips: FilterChip[] = []
  for (const t of sidebarFilters.types) {
    activeFilterChips.push({ key: `type:${t}`, label: t, group: 'type' })
  }
  for (const s of sidebarFilters.statuses) {
    activeFilterChips.push({ key: `status:${s}`, label: s, group: 'status' })
  }
  if (sidebarFilters.minScore > 0) {
    activeFilterChips.push({ key: 'score', label: `Score >= ${sidebarFilters.minScore}`, group: 'score' })
  }
  for (const gId of sidebarFilters.genres) {
    const genre = animeGenres.find((g) => g.id === gId)
    if (genre) {
      activeFilterChips.push({ key: `genre:${gId}`, label: genre.name, group: 'genre' })
    }
  }

  const handleRemoveChip = useCallback((key: string, group: string) => {
    setSidebarFilters((prev) => {
      if (group === 'type') {
        const typeName = key.replace('type:', '')
        return { ...prev, types: prev.types.filter((t) => t !== typeName) }
      }
      if (group === 'status') {
        const statusName = key.replace('status:', '')
        return { ...prev, statuses: prev.statuses.filter((s) => s !== statusName) }
      }
      if (group === 'score') {
        return { ...prev, minScore: 0 }
      }
      if (group === 'genre') {
        const genreId = Number(key.replace('genre:', ''))
        const next = new Set(prev.genres)
        next.delete(genreId)
        return { ...prev, genres: next }
      }
      return prev
    })
  }, [])

  const handleClearAllChips = useCallback(() => {
    setSidebarFilters(defaultFilters)
  }, [])

  // Detect when sidebar filters are active (beyond defaults)
  const hasActiveFilters = sidebarFilters.types.length > 0
    || sidebarFilters.statuses.length > 0
    || sidebarFilters.genres.size > 0
    || sidebarFilters.minScore > 0

  // Filtered browse state (used when hasActiveFilters on browse/season tabs)
  const [filteredBrowseItems, setFilteredBrowseItems] = useState<SearchResult[]>([])
  const [filteredBrowseLoading, setFilteredBrowseLoading] = useState(false)
  const [filteredBrowsePage, setFilteredBrowsePage] = useState(1)
  const [filteredBrowseHasNext, setFilteredBrowseHasNext] = useState(true)
  const [filteredBrowseLoadingMore, setFilteredBrowseLoadingMore] = useState(false)
  const filteredBrowseSeenRef = useRef<Set<string>>(new Set())
  const filteredBrowseLoadMoreRef = useRef<HTMLDivElement>(null)

  // Grid: auto-fill with 160px min (matches mock)
  const gridClasses = 'grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 p-4 -m-4'

  const {
    searchQuery,
    searchResults: rawSearchResults,
    searchLoading,
    searchError,
    search,
    clearSearch,
  } = useMediaStore()

  // Filter NSFW content from search results
  const searchResults = filterNsfwContent(rawSearchResults, (item) => item.genres, nsfwFilter, (item) => item.title)

  // Load AllAnime extension lazily in background (for modal downloads)
  useEffect(() => {
    loadExtension(ALLANIME_EXTENSION)
      .then(metadata => setAllanimeExtId(metadata.id))
      .catch(() => {})
  }, [])

  // Load user's watching genres for personalized recommendations
  useEffect(() => {
    const loadUserGenres = async () => {
      try {
        const continueWatching = await getContinueWatchingWithDetails(20)
        console.log('[Anime] Continue watching entries:', continueWatching.length)

        if (continueWatching.length > 0) {
          setHasWatchHistory(true)

          const genreCounts = new Map<string, number>()
          continueWatching.forEach(entry => {
            console.log('[Anime] Entry genres for', entry.media.title, ':', entry.media.genres)
            if (entry.media.genres) {
              try {
                const genres = JSON.parse(entry.media.genres)
                if (Array.isArray(genres)) {
                  genres.forEach((g: string) => {
                    genreCounts.set(g, (genreCounts.get(g) || 0) + 1)
                  })
                }
              } catch {
                entry.media.genres.split(',').forEach(g => {
                  const genre = g.trim()
                  genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1)
                })
              }
            }
          })

          const sortedGenres = Array.from(genreCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([genre]) => genre)

          console.log('[Anime] Top genres from watch history:', sortedGenres, 'counts:', Object.fromEntries(genreCounts))
          setUserWatchingGenres(sortedGenres)
        }
      } catch (err) {
        console.error('Failed to load user watching genres:', err)
      }
    }

    loadUserGenres()
  }, [])

  // === BROWSE TAB: SWR hook for page 1 ===
  const browseAnime = useJikanQuery({
    cacheKey: `anime:browse:top:sfw=${nsfwFilter}`,
    fetcher: () => jikanTopAnime(1, undefined, 'favorite', nsfwFilter),
    ttlSeconds: CACHE_TTL.POPULAR,
    mediaType: 'anime',
    enabled: activeTab === 'browse' && !searchQuery,
  })

  // Sync browse hook's hasNextPage and reset extra items when hook data changes
  useEffect(() => {
    setBrowseHasNextPage(browseAnime.hasNextPage)
    // Reset pagination when hook data reloads (e.g., filter change)
    setBrowseExtraItems([])
    setCurrentPage(1)
    browseSeenIdsRef.current.clear()
    // Populate seen IDs from hook data
    browseAnime.data.forEach(item => browseSeenIdsRef.current.add(item.id))
  }, [browseAnime.data, browseAnime.hasNextPage])

  // Combined browse items: hook page 1 + extra pages
  const recommendations = [...browseAnime.data, ...browseExtraItems]
  const recommendationsLoading = browseAnime.loading
  const hasNextPage = browseHasNextPage

  // === SEASON TAB: SWR hook for page 1 ===
  const isCurrentSeason = selectedYear === currentSeasonInfo.year &&
    selectedSeason === currentSeasonInfo.season.toLowerCase()

  const seasonAnime = useJikanQuery({
    cacheKey: `anime:season:${selectedYear}:${selectedSeason}:sfw=${nsfwFilter}`,
    fetcher: () => isCurrentSeason
      ? jikanSeasonNow(1, nsfwFilter)
      : jikanSeason(selectedYear, selectedSeason, 1, nsfwFilter),
    ttlSeconds: isCurrentSeason ? CACHE_TTL.AIRING : CACHE_TTL.SEASON_ARCHIVE,
    mediaType: 'anime',
    enabled: activeTab === 'season',
  })

  // Sync season hook's hasNextPage and reset extra items when hook data changes
  useEffect(() => {
    setFullSeasonHasNextPage(seasonAnime.hasNextPage)
    setSeasonExtraItems([])
    setFullSeasonPage(1)
    fullSeasonSeenIdsRef.current.clear()
    seasonAnime.data.forEach(item => fullSeasonSeenIdsRef.current.add(item.id))
  }, [seasonAnime.data, seasonAnime.hasNextPage])

  // Combined season items: hook page 1 + extra pages, sorted by rating
  const fullSeasonAnimeRaw = [...seasonAnime.data, ...seasonExtraItems]
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
  // Apply client-side filtering when sidebar filters are active on season tab
  const fullSeasonAnime = hasActiveFilters
    ? fullSeasonAnimeRaw.filter(item => {
        if (sidebarFilters.types.length > 0 && item.media_type && !sidebarFilters.types.some(t => t.toLowerCase() === item.media_type!.toLowerCase())) return false
        if (sidebarFilters.statuses.length > 0 && item.status && !sidebarFilters.statuses.some(s => s.toLowerCase() === item.status!.toLowerCase())) return false
        if (sidebarFilters.genres.size > 0 && item.genres) {
          const itemGenres = item.genres.map(g => g.toLowerCase())
          const filterGenreNames = Array.from(sidebarFilters.genres).map(id => {
            const genre = animeGenres.find(ag => ag.id === id)
            return genre?.name.toLowerCase() || ''
          }).filter(Boolean)
          if (!filterGenreNames.some(fg => itemGenres.includes(fg))) return false
        }
        if (sidebarFilters.minScore > 0 && (item.rating || 0) < sidebarFilters.minScore) return false
        return true
      })
    : fullSeasonAnimeRaw
  const fullSeasonLoading = seasonAnime.loading

  // Load more browse anime (pages 2+)
  const loadMoreRecommendations = useCallback(async () => {
    if (loadingMore || !browseHasNextPage || searchInput) return

    setLoadingMore(true)
    try {
      const nextPage = currentPage + 1
      const results = await jikanTopAnime(nextPage, undefined, 'favorite', nsfwFilter)

      const newResults = results.results.filter(item => {
        if (browseSeenIdsRef.current.has(item.id)) return false
        browseSeenIdsRef.current.add(item.id)
        return true
      })

      setBrowseExtraItems(prev => [...prev, ...newResults])
      setCurrentPage(nextPage)
      setBrowseHasNextPage(results.has_next_page)
    } catch (err) {
      console.error('Failed to load more anime:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [currentPage, browseHasNextPage, loadingMore, searchInput, nsfwFilter])

  // Load more season anime (pages 2+)
  const loadMoreSeasonAnime = useCallback(async () => {
    if (fullSeasonLoadingMore || !fullSeasonHasNextPage) return

    setFullSeasonLoadingMore(true)
    try {
      const nextPage = fullSeasonPage + 1
      const result = isCurrentSeason
        ? await jikanSeasonNow(nextPage, nsfwFilter)
        : await jikanSeason(selectedYear, selectedSeason, nextPage, nsfwFilter)

      const newResults = result.results.filter(item => {
        if (fullSeasonSeenIdsRef.current.has(item.id)) return false
        fullSeasonSeenIdsRef.current.add(item.id)
        return true
      })

      setSeasonExtraItems(prev => [...prev, ...newResults])
      setFullSeasonPage(nextPage)
      setFullSeasonHasNextPage(result.has_next_page)
    } catch (err) {
      console.error('Failed to load more season anime:', err)
    } finally {
      setFullSeasonLoadingMore(false)
    }
  }, [fullSeasonPage, fullSeasonHasNextPage, fullSeasonLoadingMore, nsfwFilter, selectedYear, selectedSeason, isCurrentSeason])

  // === FILTERED BROWSE: Fetch when sidebar filters are active on browse tab ===
  useEffect(() => {
    if (activeTab !== 'browse' || !hasActiveFilters) {
      setFilteredBrowseItems([])
      return
    }
    setFilteredBrowseLoading(true)
    setFilteredBrowsePage(1)
    filteredBrowseSeenRef.current.clear()

    const genreStr = Array.from(sidebarFilters.genres).join(',')
    jikanSearchAnimeFiltered({
      page: 1,
      sfw: nsfwFilter,
      genres: genreStr || undefined,
      orderBy: sidebarFilters.orderBy || 'popularity',
      sort: sidebarFilters.sort || 'desc',
      status: sidebarFilters.statuses[0] || undefined,
      animeType: sidebarFilters.types[0] || undefined,
      minScore: sidebarFilters.minScore > 0 ? String(sidebarFilters.minScore) : undefined,
    })
      .then(result => {
        const filtered = filterNsfwContent(result.results, (item) => item.genres, nsfwFilter, (item) => item.title)
        filtered.forEach(item => filteredBrowseSeenRef.current.add(item.id))
        setFilteredBrowseItems(filtered)
        setFilteredBrowseHasNext(result.has_next_page)
      })
      .catch(err => console.error('Filtered browse failed:', err))
      .finally(() => setFilteredBrowseLoading(false))
  }, [activeTab, hasActiveFilters, sidebarFilters, nsfwFilter])

  // Filtered browse: load more
  const loadMoreFilteredBrowse = useCallback(async () => {
    if (filteredBrowseLoadingMore || !filteredBrowseHasNext) return
    setFilteredBrowseLoadingMore(true)
    try {
      const nextPage = filteredBrowsePage + 1
      const genreStr = Array.from(sidebarFilters.genres).join(',')
      const result = await jikanSearchAnimeFiltered({
        page: nextPage,
        sfw: nsfwFilter,
        genres: genreStr || undefined,
        orderBy: sidebarFilters.orderBy || 'popularity',
        sort: sidebarFilters.sort || 'desc',
        status: sidebarFilters.statuses[0] || undefined,
        animeType: sidebarFilters.types[0] || undefined,
        minScore: sidebarFilters.minScore > 0 ? String(sidebarFilters.minScore) : undefined,
      })
      const newItems = result.results.filter(item => {
        if (filteredBrowseSeenRef.current.has(item.id)) return false
        filteredBrowseSeenRef.current.add(item.id)
        return true
      })
      setFilteredBrowseItems(prev => [...prev, ...newItems])
      setFilteredBrowsePage(nextPage)
      setFilteredBrowseHasNext(result.has_next_page)
    } catch (err) {
      console.error('Failed to load more filtered browse:', err)
    } finally {
      setFilteredBrowseLoadingMore(false)
    }
  }, [filteredBrowsePage, filteredBrowseHasNext, filteredBrowseLoadingMore, sidebarFilters, nsfwFilter])

  // Filtered browse intersection observer
  useEffect(() => {
    if (activeTab !== 'browse' || !hasActiveFilters) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && filteredBrowseHasNext && !filteredBrowseLoadingMore && !filteredBrowseLoading) {
          loadMoreFilteredBrowse()
        }
      },
      { threshold: 0.1 }
    )
    if (filteredBrowseLoadMoreRef.current) observer.observe(filteredBrowseLoadMoreRef.current)
    return () => observer.disconnect()
  }, [activeTab, hasActiveFilters, filteredBrowseHasNext, filteredBrowseLoadingMore, filteredBrowseLoading, loadMoreFilteredBrowse])

  // === Fetch genres list (eagerly, for sidebar) ===
  useEffect(() => {
    if (animeGenres.length > 0) return
    setGenresLoading(true)
    jikanGenresAnime()
      .then(result => setAnimeGenres(result.genres))
      .catch(err => console.error('Failed to load anime genres:', err))
      .finally(() => setGenresLoading(false))
  }, [animeGenres.length])

  // Genre tab: fetch results when genres/filters change
  useEffect(() => {
    if (activeTab !== 'genres') return
    if (selectedGenreIds.size === 0 && !genreFilters.orderBy && !genreFilters.status && !genreFilters.type) {
      setGenreResults([])
      setGenreHasNextPage(false)
      return
    }

    const fetchGenreResults = async () => {
      setGenreResultsLoading(true)
      setGenrePage(1)
      genreSeenIdsRef.current.clear()
      try {
        const genreStr = Array.from(selectedGenreIds).join(',')
        const result = await jikanSearchAnimeFiltered({
          page: 1,
          sfw: nsfwFilter,
          genres: genreStr || undefined,
          orderBy: genreFilters.orderBy || undefined,
          sort: genreFilters.sort || undefined,
          status: genreFilters.status || undefined,
          animeType: genreFilters.type || undefined,
        })
        const filtered = filterNsfwContent(result.results, (item) => item.genres, nsfwFilter, (item) => item.title)
        filtered.forEach(item => genreSeenIdsRef.current.add(item.id))
        setGenreResults(filtered)
        setGenreHasNextPage(result.has_next_page)
      } catch (err) {
        console.error('Genre search failed:', err)
      } finally {
        setGenreResultsLoading(false)
      }
    }

    fetchGenreResults()
  }, [activeTab, selectedGenreIds, genreFilters, nsfwFilter])

  // Load more genre results (pages 2+)
  const loadMoreGenreResults = useCallback(async () => {
    if (genreLoadingMore || !genreHasNextPage) return

    setGenreLoadingMore(true)
    try {
      const nextPage = genrePage + 1
      const genreStr = Array.from(selectedGenreIds).join(',')
      const result = await jikanSearchAnimeFiltered({
        page: nextPage,
        sfw: nsfwFilter,
        genres: genreStr || undefined,
        orderBy: genreFilters.orderBy || undefined,
        sort: genreFilters.sort || undefined,
        status: genreFilters.status || undefined,
        animeType: genreFilters.type || undefined,
      })

      const newResults = result.results.filter(item => {
        if (genreSeenIdsRef.current.has(item.id)) return false
        genreSeenIdsRef.current.add(item.id)
        return true
      })

      setGenreResults(prev => [...prev, ...newResults])
      setGenrePage(nextPage)
      setGenreHasNextPage(result.has_next_page)
    } catch (err) {
      console.error('Failed to load more genre results:', err)
    } finally {
      setGenreLoadingMore(false)
    }
  }, [genrePage, genreHasNextPage, genreLoadingMore, selectedGenreIds, genreFilters, nsfwFilter])

  // Intersection observer for infinite scroll (Browse tab)
  useEffect(() => {
    if (activeTab !== 'browse') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && browseHasNextPage && !loadingMore && !recommendationsLoading) {
          loadMoreRecommendations()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [activeTab, browseHasNextPage, loadingMore, recommendationsLoading, loadMoreRecommendations])

  // Intersection observer for season tab infinite scroll
  useEffect(() => {
    if (activeTab !== 'season') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && fullSeasonHasNextPage && !fullSeasonLoadingMore && !fullSeasonLoading) {
          loadMoreSeasonAnime()
        }
      },
      { threshold: 0.1 }
    )

    if (seasonLoadMoreRef.current) {
      observer.observe(seasonLoadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [activeTab, fullSeasonHasNextPage, fullSeasonLoadingMore, fullSeasonLoading, loadMoreSeasonAnime])

  // Intersection observer for genre tab infinite scroll
  useEffect(() => {
    if (activeTab !== 'genres') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && genreHasNextPage && !genreLoadingMore && !genreResultsLoading) {
          loadMoreGenreResults()
        }
      },
      { threshold: 0.1 }
    )

    if (genreLoadMoreRef.current) {
      observer.observe(genreLoadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [activeTab, genreHasNextPage, genreLoadingMore, genreResultsLoading, loadMoreGenreResults])

  // Debounced instant search
  useEffect(() => {
    if (!searchInput.trim()) {
      if (searchQuery) {
        clearSearch()
      }
      return
    }

    const timer = setTimeout(() => {
      search(searchInput, 1, nsfwFilter)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, nsfwFilter])

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

  // Determine header title based on active nav/tab
  const headerTitle = (() => {
    if (searchInput) return 'Search'
    if (sidebarNav === 'browse') return 'Browse'
    if (sidebarNav === 'season') return 'This Season'
    if (sidebarNav === 'top-rated') return 'Top Rated'
    if (sidebarNav === 'genres') return 'By Genre'
    return 'Browse'
  })()

  // Count items for header
  const currentResultCount = (() => {
    if (searchInput) return searchResults.length
    if (activeTab === 'browse') return hasActiveFilters ? filteredBrowseItems.length : recommendations.length
    if (activeTab === 'season') return fullSeasonAnime.length
    if (activeTab === 'genres') return genreResults.length
    return 0
  })()

  return (
    <div className="min-h-[calc(100vh-4rem)] flex">
      {/* Sidebar */}
      <BrowseSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((p) => !p)}
        activeNav={sidebarNav}
        onNavChange={handleSidebarNav}
        filters={sidebarFilters}
        onFiltersChange={setSidebarFilters}
        onReset={handleClearAllChips}
        mediaType="anime"
        genres={animeGenres}
        genresLoading={genresLoading}
        yearOptions={sidebarYearOptions}
      />

      {/* Main Content */}
      <main className="flex-1 min-w-0 px-7 pb-3">
        {/* Browse Header */}
        <BrowseHeader
          title={headerTitle}
          resultCount={currentResultCount}
          sortBy={sidebarFilters.orderBy || 'popularity'}
          onSortChange={(sort) => setSidebarFilters((prev) => ({ ...prev, orderBy: sort }))}
        />

        {/* Search Bar */}
        <div className="relative mt-3 mb-3">
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
            placeholder="Search for anime..."
            className="w-full pl-10 pr-10 py-2.5 bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-[var(--radius-md)] text-sm text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); clearSearch() }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-white transition-colors"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Active Filter Chips */}
        <ActiveFilterChips
          filters={activeFilterChips}
          onRemove={handleRemoveChip}
          onClearAll={handleClearAllChips}
        />

        {/* Search Results (shown when searching, hides tabs) */}
        {searchInput ? (
          <div className="mt-4">
            {/* Results */}
            {searchResults.length > 0 && (
              <div className="overflow-visible">
                <div className={`grid ${gridClasses} overflow-visible`}>
                  {searchResults.map((item) => (
                    <MediaCard
                      key={item.id}
                      media={item}
                      onClick={() => setSelectedMedia(item)}
                      status={getStatus(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Error State */}
            {searchError && (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-[var(--color-accent-primary)] mx-auto mb-3" />
                <p className="text-[var(--color-text-secondary)]">{searchError}</p>
              </div>
            )}

            {/* No Results */}
            {!searchLoading && searchResults.length === 0 && !searchError && searchQuery && (
              <div className="text-center py-12">
                <p className="text-lg text-[var(--color-text-secondary)]">
                  No results found for "{searchQuery}"
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4">
            {/* Tab Content */}
            {activeTab === 'browse' && (
              // ========== BROWSE TAB ==========
              hasActiveFilters ? (
                // Filtered browse mode
                <div>
                  {filteredBrowseLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
                    </div>
                  ) : filteredBrowseItems.length > 0 ? (
                    <div className="overflow-visible">
                      <div className={`grid ${gridClasses} overflow-visible`}>
                        {filteredBrowseItems.map((item) => (
                          <MediaCard
                            key={item.id}
                            media={item}
                            onClick={() => setSelectedMedia(item)}
                            status={getStatus(item.id)}
                          />
                        ))}
                      </div>

                      <div ref={filteredBrowseLoadMoreRef} className="py-8 flex items-center justify-center">
                        {filteredBrowseLoadingMore && (
                          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
                        )}
                        {!filteredBrowseHasNext && filteredBrowseItems.length > 0 && (
                          <p className="text-sm text-[var(--color-text-muted)]">
                            You've reached the end
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-[var(--color-text-secondary)]">
                        No anime found matching the selected filters
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                // Default browse mode
                <div>
                  {recommendationsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
                    </div>
                  ) : recommendations.length > 0 ? (
                    <div className="overflow-visible">
                      <div className={`grid ${gridClasses} overflow-visible`}>
                        {recommendations.map((item) => (
                          <MediaCard
                            key={item.id}
                            media={item}
                            onClick={() => setSelectedMedia(item)}
                            status={getStatus(item.id)}
                          />
                        ))}
                      </div>

                      {/* Infinite scroll sentinel */}
                      <div ref={loadMoreRef} className="py-8 flex items-center justify-center">
                        {loadingMore && (
                          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
                        )}
                        {!hasNextPage && recommendations.length > 0 && (
                          <p className="text-sm text-[var(--color-text-muted)]">
                            You've reached the end
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-[var(--color-text-secondary)]">
                        No anime found
                      </p>
                    </div>
                  )}
                </div>
              )
            )}

            {activeTab === 'season' && (
              // ========== SEASON TAB ==========
              <div>
                <div className="flex flex-wrap items-center gap-3 mb-6">
                  {/* Season Chips */}
                  <div className="flex gap-1.5">
                    {seasonOptions.map(s => (
                      <button
                        key={s}
                        onClick={() => setSelectedSeason(s)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                          selectedSeason === s
                            ? 'bg-[var(--color-accent-primary)] text-white shadow-[0_0_12px_rgba(229,9,20,0.3)]'
                            : 'text-[var(--color-text-secondary)] border border-[var(--color-glass-border)] hover:text-white hover:border-[var(--color-glass-border-hover)]'
                        }`}
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>

                  {/* Year Dropdown */}
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-[var(--radius-md)] px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                  >
                    {yearOptions.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>

                  {/* Sort indicator */}
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] ml-auto">
                    <Star className="w-3.5 h-3.5 text-[var(--color-gold)]" />
                    Sorted by Rating
                  </div>
                </div>

                {fullSeasonLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
                  </div>
                ) : fullSeasonAnime.length > 0 ? (
                  <div className="overflow-visible">
                    <div className={`grid ${gridClasses} overflow-visible`}>
                      {fullSeasonAnime.map((item) => (
                        <MediaCard
                          key={item.id}
                          media={item}
                          onClick={() => setSelectedMedia(item)}
                          status={getStatus(item.id)}
                        />
                      ))}
                    </div>

                    {/* Infinite scroll sentinel */}
                    <div ref={seasonLoadMoreRef} className="py-8 flex items-center justify-center">
                      {fullSeasonLoadingMore && (
                        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
                      )}
                      {!fullSeasonHasNextPage && fullSeasonAnime.length > 0 && (
                        <p className="text-sm text-[var(--color-text-muted)]">
                          All {fullSeasonAnime.length} anime from {selectedSeason.charAt(0).toUpperCase() + selectedSeason.slice(1)} {selectedYear} loaded
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-[var(--color-text-secondary)]">
                      No anime found for {selectedSeason.charAt(0).toUpperCase() + selectedSeason.slice(1)} {selectedYear}
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'genres' && (
              // ========== GENRES TAB ==========
              <div>
                <GenreFilterBar
                  genres={animeGenres}
                  selectedGenreIds={selectedGenreIds}
                  onToggleGenre={(id) => {
                    setSelectedGenreIds(prev => {
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
                  mediaType="anime"
                  loading={genresLoading}
                />

                {/* Genre Results */}
                <div className="mt-6">
                  {genreResultsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
                    </div>
                  ) : genreResults.length > 0 ? (
                    <div className="overflow-visible">
                      <p className="text-sm text-[var(--color-text-muted)] mb-4">
                        {genreResults.length} results
                      </p>
                      <div className={`grid ${gridClasses} overflow-visible`}>
                        {genreResults.map((item) => (
                          <MediaCard
                            key={item.id}
                            media={item}
                            onClick={() => setSelectedMedia(item)}
                            status={getStatus(item.id)}
                          />
                        ))}
                      </div>

                      {/* Infinite scroll sentinel */}
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
                  ) : selectedGenreIds.size > 0 || genreFilters.orderBy || genreFilters.status || genreFilters.type ? (
                    <div className="text-center py-12">
                      <p className="text-[var(--color-text-secondary)]">
                        No anime found matching the selected filters
                      </p>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <TagIcon className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-3" />
                      <p className="text-[var(--color-text-secondary)]">
                        Select one or more genres to browse anime
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Media Detail Modal */}
      {selectedMedia && (
        <MediaDetailModal
          media={selectedMedia}
          extensionId={allanimeExtId || undefined}
          isOpen={true}
          onClose={() => {
            setSelectedMedia(null)
            refreshStatus()
          }}
          onMediaChange={setSelectedMedia}
        />
      )}
    </div>
  )
}
