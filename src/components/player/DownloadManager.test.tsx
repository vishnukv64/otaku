import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DownloadPageContent } from './DownloadManager'

const mockAsk = vi.hoisted(() => vi.fn())
const mockListen = vi.hoisted(() => vi.fn())
const mockListDownloads = vi.hoisted(() => vi.fn())
const mockListAllChapterDownloads = vi.hoisted(() => vi.fn())
const mockGetTotalStorageUsed = vi.hoisted(() => vi.fn())
const mockDeleteDownload = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  ask: mockAsk,
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: { downloadLocation: string }) => unknown) => selector({ downloadLocation: '' }),
}))

vi.mock('@/utils/platform', () => ({
  isMobile: () => false,
}))

vi.mock('@/utils/notify', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}))

vi.mock('@/utils/tauri-commands', () => ({
  listDownloads: mockListDownloads,
  cancelDownload: vi.fn(),
  pauseDownload: vi.fn(),
  resumeDownload: vi.fn(),
  deleteDownload: mockDeleteDownload,
  getTotalStorageUsed: mockGetTotalStorageUsed,
  clearCompletedDownloads: vi.fn(),
  clearFailedDownloads: vi.fn(),
  openDownloadsFolder: vi.fn(),
  listAllChapterDownloads: mockListAllChapterDownloads,
  cancelChapterDownload: vi.fn(),
  deleteChapterDownload: vi.fn(),
  clearCompletedChapterDownloads: vi.fn(),
  clearFailedChapterDownloads: vi.fn(),
  getCachedMediaDetails: vi.fn().mockResolvedValue(null),
}))

describe('DownloadPageContent group delete controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListen.mockResolvedValue(() => {})
    mockGetTotalStorageUsed.mockResolvedValue(1_337_000)
    mockListAllChapterDownloads.mockResolvedValue([])
    mockListDownloads.mockResolvedValue([
      {
        id: 'anime-episode-3',
        media_id: 'fujimoto',
        episode_id: 'episode-3',
        episode_number: 3,
        filename: 'Fujimoto_Tatsuki_17_26_EP3.otaku',
        url: 'https://example.test/episode-3',
        file_path: '/tmp/Fujimoto_Tatsuki_17_26_EP3.otaku',
        total_bytes: 171_780_000,
        downloaded_bytes: 171_780_000,
        percentage: 100,
        speed: 0,
        status: 'completed',
      },
    ])
  })

  it('does not render group delete actions inside another button', async () => {
    render(<DownloadPageContent />)

    const deleteButton = await screen.findByTitle('Delete all episodes')
    expect(deleteButton.parentElement?.closest('button')).toBeNull()
  })

  it('asks for confirmation before deleting a whole anime group', async () => {
    mockAsk.mockResolvedValue(false)

    render(<DownloadPageContent />)

    fireEvent.click(await screen.findByTitle('Delete all episodes'))

    await waitFor(() => {
      expect(mockAsk).toHaveBeenCalledWith(
        expect.stringContaining('Are you sure you want to delete all episodes for "Fujimoto Tatsuki 17 26"?'),
        { kind: 'warning' }
      )
    })
    expect(mockDeleteDownload).not.toHaveBeenCalled()
  })
})
