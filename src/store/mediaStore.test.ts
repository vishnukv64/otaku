import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMediaStore } from './mediaStore'

const mockJikanSearchAnime = vi.hoisted(() => vi.fn())

vi.mock('@/utils/tauri-commands', () => ({
  jikanSearchAnime: mockJikanSearchAnime,
}))

const initialState = useMediaStore.getState()

describe('media store search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMediaStore.setState({
      searchQuery: '',
      searchResults: [],
      searchLoading: false,
      searchError: null,
      hasNextPage: false,
      currentPage: 1,
      selectedMedia: null,
      selectedMediaLoading: false,
      setSearchQuery: initialState.setSearchQuery,
      search: initialState.search,
      loadMoreResults: initialState.loadMoreResults,
      selectMedia: initialState.selectMedia,
      clearSearch: initialState.clearSearch,
    })
  })

  it('ignores stale failures after a newer search succeeds', async () => {
    let rejectOldSearch!: (error: Error) => void

    mockJikanSearchAnime
      .mockReturnValueOnce(new Promise((_, reject) => { rejectOldSearch = reject }))
      .mockResolvedValueOnce({
        results: [{ id: '2', title: 'Shinsei Entaku' }],
        has_next_page: false,
      })

    const oldSearch = useMediaStore.getState().search('shin', 1, true)
    const newSearch = useMediaStore.getState().search('shinsei entaku', 1, true)

    await newSearch
    rejectOldSearch(new Error('Search failed'))
    await oldSearch

    expect(useMediaStore.getState()).toMatchObject({
      searchQuery: 'shinsei entaku',
      searchResults: [{ id: '2', title: 'Shinsei Entaku' }],
      searchLoading: false,
      searchError: null,
    })
  })

  it('does not call Jikan for short live-search queries', async () => {
    await useMediaStore.getState().search('fa', 1, true)

    expect(mockJikanSearchAnime).not.toHaveBeenCalled()
    expect(useMediaStore.getState()).toMatchObject({
      searchQuery: '',
      searchResults: [],
      searchLoading: false,
      searchError: null,
    })
  })

  it('trims the query before searching Jikan', async () => {
    mockJikanSearchAnime.mockResolvedValueOnce({
      results: [{ id: '3', title: 'Shinsei' }],
      has_next_page: false,
    })

    await useMediaStore.getState().search('  shinsei  ', 1, true)

    expect(mockJikanSearchAnime).toHaveBeenCalledWith('shinsei', 1, true)
    expect(useMediaStore.getState().searchQuery).toBe('shinsei')
  })

  it('keeps string errors from the Jikan command', async () => {
    mockJikanSearchAnime.mockRejectedValueOnce('Jikan request failed')

    await useMediaStore.getState().search('fate', 1, true)

    expect(useMediaStore.getState().searchError).toBe('Jikan request failed')
  })

  it('explains Jikan 504 and 429 responses clearly', async () => {
    mockJikanSearchAnime.mockRejectedValueOnce(
      'Jikan API error 504: {"message":"Jikan failed to connect to MyAnimeList"}'
    )

    await useMediaStore.getState().search('fate', 1, true)
    expect(useMediaStore.getState().searchError).toContain('Jikan is temporarily unavailable')

    mockJikanSearchAnime.mockRejectedValueOnce('Rate limited by Jikan API')

    await useMediaStore.getState().search('fate', 1, true)
    expect(useMediaStore.getState().searchError).toContain('Jikan is rate limiting')
  })
})
