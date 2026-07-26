import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiStatusIndicator } from './ApiStatusIndicator'

const mockLoadExtension = vi.hoisted(() => vi.fn())
const mockSearchAnime = vi.hoisted(() => vi.fn())
const mockSearchManga = vi.hoisted(() => vi.fn())
const mockJikanTopAnime = vi.hoisted(() => vi.fn())
const mockJikanTopManga = vi.hoisted(() => vi.fn())
const mockSubscribeToApiStatus = vi.hoisted(() => vi.fn())

vi.mock('@/utils/tauri-commands', () => ({
  loadExtension: mockLoadExtension,
  searchAnime: mockSearchAnime,
  searchManga: mockSearchManga,
  jikanTopAnime: mockJikanTopAnime,
  jikanTopManga: mockJikanTopManga,
  subscribeToApiStatus: mockSubscribeToApiStatus,
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: {
    anikotoApiBaseUrl: string
    anikotoSiteBaseUrl: string
    anikotoYotochanBaseUrl: string
  }) => unknown) => selector({
    anikotoApiBaseUrl: 'https://anikoto-api.test/api',
    anikotoSiteBaseUrl: 'https://anikoto.test',
    anikotoYotochanBaseUrl: 'https://yotochan.test',
  }),
}))

describe('ApiStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribeToApiStatus.mockReturnValue(() => {})
    mockLoadExtension.mockImplementation(async (code: string) => ({
      id: code.includes('com.anikoto.source')
        ? 'com.anikoto.source'
        : 'com.mangakakalot.source',
    }))
    mockSearchAnime.mockResolvedValue({
      results: [{ id: 'naruto', title: 'Naruto' }],
      has_next_page: false,
    })
    mockSearchManga.mockResolvedValue({
      results: [{ id: 'one-piece', title: 'One Piece' }],
      has_next_page: false,
    })
    mockJikanTopAnime.mockResolvedValue({ results: [{ id: '1', title: 'Jikan Anime' }] })
    mockJikanTopManga.mockResolvedValue({ results: [{ id: '2', title: 'Jikan Manga' }] })
  })

  it('checks Anikoto and Mangakakalot instead of Jikan', async () => {
    render(<ApiStatusIndicator inline />)

    await waitFor(() => {
      expect(mockSearchAnime).toHaveBeenCalledWith('com.anikoto.source', 'naruto', 1, false)
      expect(mockSearchManga).toHaveBeenCalledWith('com.mangakakalot.source', 'one piece', 1, false)
    })

    expect(mockLoadExtension).toHaveBeenCalledWith(expect.stringContaining('com.anikoto.source'))
    expect(mockLoadExtension).toHaveBeenCalledWith(expect.stringContaining('com.mangakakalot.source'))
    expect(mockJikanTopAnime).not.toHaveBeenCalled()
    expect(mockJikanTopManga).not.toHaveBeenCalled()
    expect(screen.getByText('Anikoto API')).toBeInTheDocument()
    expect(screen.getByText('Mangakakalot API')).toBeInTheDocument()
  })
})
