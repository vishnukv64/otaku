/**
 * DownloadManager Component
 *
 * Modal displaying all active and completed downloads with progress tracking.
 *
 * Exports:
 * - DownloadPageContent: Standalone content (used by /downloads route on mobile)
 * - DownloadManager: Modal shell wrapping DownloadPageContent (used by TopNav on desktop)
 */

import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { X, Download, Trash2, CheckCircle, Loader2, Folder, BookOpen, Tv, Pause, Play, ChevronDown } from 'lucide-react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { ask } from '@tauri-apps/plugin-dialog'
import { listDownloads, cancelDownload, pauseDownload, resumeDownload, deleteDownload, getTotalStorageUsed, clearCompletedDownloads, clearFailedDownloads, openDownloadsFolder, listAllChapterDownloads, cancelChapterDownload, deleteChapterDownload, getCachedMediaDetails, type DownloadProgress, type ChapterDownloadWithTitle, type ChapterDownloadProgressEvent } from '@/utils/tauri-commands'
import { notifySuccess, notifyError } from '@/utils/notify'
import { useSettingsStore } from '@/store/settingsStore'
import { isMobile } from '@/utils/platform'

// Extension ID for AllAnime - used for navigation to watch page

const DOWNLOAD_PROGRESS_EVENT = 'download-progress'
const CHAPTER_DOWNLOAD_PROGRESS_EVENT = 'chapter-download-progress'

interface DownloadManagerProps {
  isOpen: boolean
  onClose: () => void
}

interface DownloadPageContentProps {
  onNavigateAway?: () => void
}

interface GroupedDownloads {
  mediaId: string
  mediaTitle: string
  downloads: DownloadProgress[]
}

interface GroupedChapterDownloads {
  mediaId: string
  mediaTitle: string
  downloads: ChapterDownloadWithTitle[]
}

/**
 * Standalone download content — no modal wrapper, no backdrop, no fixed positioning.
 * Used directly by the /downloads route and mounted inside DownloadManager's modal shell.
 */
export function DownloadPageContent({ onNavigateAway }: DownloadPageContentProps) {
  const [downloads, setDownloads] = useState<DownloadProgress[]>([])
  const [chapterDownloads, setChapterDownloads] = useState<ChapterDownloadWithTitle[]>([])
  const [loading, setLoading] = useState(false)
  const [totalStorage, setTotalStorage] = useState(0)
  const [activeTab, setActiveTab] = useState<string>('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({})
  const navigate = useNavigate()

  // Get custom download location from settings
  const customDownloadLocation = useSettingsStore((state) => state.downloadLocation)

  // Load static data once on mount
  useEffect(() => {
    const loadStaticData = async () => {
      try {
        const storage = await getTotalStorageUsed()
        setTotalStorage(storage)
      } catch (error) {
        console.error('Failed to load static data:', error)
      }
    }

    loadStaticData()
  }, [customDownloadLocation])

  // Load downloads and listen for real-time events
  useEffect(() => {
    let isMounted = true
    let unlisten: UnlistenFn | null = null
    const downloadsMap = new Map<string, DownloadProgress>()
    const chapterDownloadsMap = new Map<string, ChapterDownloadWithTitle>()

    const fetchInitialDownloads = async () => {
      try {
        // Fetch both anime and manga downloads in parallel
        const [downloadsList, chaptersList] = await Promise.all([
          listDownloads(),
          listAllChapterDownloads()
        ])

        if (isMounted) {
          downloadsList.forEach(d => downloadsMap.set(d.id, d))
          chaptersList.forEach(d => chapterDownloadsMap.set(d.id, d))
          setDownloads(downloadsList)
          setChapterDownloads(chaptersList)

          if (downloadsList.length > 0 || chaptersList.length > 0) {
            const storage = await getTotalStorageUsed()
            if (isMounted) setTotalStorage(storage)
          }

          // Fetch cover URLs for all unique media IDs
          const allMediaIds = new Set([
            ...downloadsList.map(d => d.media_id),
            ...chaptersList.map(d => d.media_id),
          ])
          const covers: Record<string, string> = {}
          await Promise.all(
            Array.from(allMediaIds).map(async (id) => {
              try {
                const details = await getCachedMediaDetails(id)
                if (details?.media?.cover_url) covers[id] = details.media.cover_url
              } catch { /* ignore */ }
            })
          )
          if (isMounted && Object.keys(covers).length > 0) setCoverUrls(covers)
        }
      } catch (error) {
        console.error('Failed to load downloads:', error)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    const setupEventListener = async () => {
      unlisten = await listen<DownloadProgress>(DOWNLOAD_PROGRESS_EVENT, (event) => {
        if (!isMounted) return

        const progress = event.payload
        downloadsMap.set(progress.id, progress)
        setDownloads(Array.from(downloadsMap.values()))

        // Update storage when a download completes
        if (progress.status === 'completed') {
          getTotalStorageUsed().then(storage => {
            if (isMounted) setTotalStorage(storage)
          })
        }
      })
    }

    // SSE listener for chapter download progress
    let unlistenChapters: UnlistenFn | null = null
    const setupChapterEventListener = async () => {
      unlistenChapters = await listen<ChapterDownloadProgressEvent>(CHAPTER_DOWNLOAD_PROGRESS_EVENT, (event) => {
        if (!isMounted) return

        const progress = event.payload

        // Get existing entry to preserve media_title, or use a fallback
        const existing = chapterDownloadsMap.get(progress.id)
        const updatedEntry: ChapterDownloadWithTitle = {
          ...progress,
          media_title: existing?.media_title || progress.media_id.replace(/_/g, ' '),
        }

        chapterDownloadsMap.set(progress.id, updatedEntry)
        setChapterDownloads(Array.from(chapterDownloadsMap.values()))

        // Update storage when a download completes
        if (progress.status === 'completed') {
          getTotalStorageUsed().then(storage => {
            if (isMounted) setTotalStorage(storage)
          })
        }
      })
    }

    // Initial load
    setLoading(true)
    fetchInitialDownloads()
    setupEventListener()
    setupChapterEventListener()

    // Cleanup
    return () => {
      isMounted = false
      if (unlisten) {
        unlisten()
      }
      if (unlistenChapters) {
        unlistenChapters()
      }
    }
  }, [])

  const handleCancel = async (downloadId: string) => {
    const download = downloads.find(d => d.id === downloadId)
    const displayName = download ? `Episode ${download.episode_number}` : 'Download'
    try {
      await cancelDownload(downloadId)
      // Refresh downloads
      const result = await listDownloads()
      setDownloads(result)
      notifySuccess('Download Cancelled', `Cancelled ${displayName}`)
    } catch (error) {
      console.error('Failed to cancel download:', error)
      notifyError('Cancel Failed', `Failed to cancel ${displayName}`)
    }
  }

  const handlePause = async (downloadId: string) => {
    const download = downloads.find(d => d.id === downloadId)
    const displayName = download ? `Episode ${download.episode_number}` : 'Download'
    try {
      await pauseDownload(downloadId)
      notifySuccess('Download Paused', `Paused ${displayName}`)
    } catch (error) {
      console.error('Failed to pause download:', error)
      notifyError('Pause Failed', `Failed to pause ${displayName}`)
    }
  }

  const handleResume = async (downloadId: string) => {
    const download = downloads.find(d => d.id === downloadId)
    const displayName = download ? `Episode ${download.episode_number}` : 'Download'
    try {
      await resumeDownload(downloadId)
      notifySuccess('Download Resumed', `Resumed ${displayName}`)
    } catch (error) {
      console.error('Failed to resume download:', error)
      notifyError('Resume Failed', `Failed to resume ${displayName}`)
    }
  }

  const handleDelete = async (downloadId: string, filename: string) => {
    const download = downloads.find(d => d.id === downloadId)
    // Extract a cleaner display name from filename (e.g., "Anime_Name_EP1.mp4" -> "Anime Name EP1")
    const cleanFilename = filename.replace(/_/g, ' ').replace(/\.[^/.]+$/, '')
    const displayName = download ? `Episode ${download.episode_number}` : cleanFilename

    const confirmed = await ask(`Delete "${cleanFilename}"? This will permanently remove the file.`, { kind: 'warning' })
    if (!confirmed) return

    try {
      await deleteDownload(downloadId)
      // Refresh downloads
      const [downloadsList, storage] = await Promise.all([
        listDownloads(),
        getTotalStorageUsed()
      ])
      setDownloads(downloadsList)
      setTotalStorage(storage)
      notifySuccess('Download Deleted', `Deleted "${cleanFilename}"`)
    } catch (error) {
      console.error('Failed to delete download:', error)
      notifyError('Delete Failed', `Failed to delete ${displayName}`)
    }
  }

  const handleClearCompleted = async () => {
    const completedCount = downloads.filter(d => d.status === 'completed').length
    if (completedCount === 0) {
      notifyError('No Downloads', 'No completed downloads to clear')
      return
    }

    const confirmed = await ask(`Clear ${completedCount} completed download(s) from the list? Files will not be deleted.`)
    if (!confirmed) return

    try {
      await clearCompletedDownloads()
      const result = await listDownloads()
      setDownloads(result)
      notifySuccess('Downloads Cleared', `Cleared ${completedCount} completed download(s)`)
    } catch (error) {
      console.error('Failed to clear completed downloads:', error)
      notifyError('Clear Failed', 'Failed to clear completed downloads')
    }
  }

  const handleClearFailed = async () => {
    const failedCount = downloads.filter(d => d.status === 'failed').length
    if (failedCount === 0) {
      notifyError('No Downloads', 'No failed downloads to clear')
      return
    }

    const confirmed = await ask(`Clear ${failedCount} failed download(s) from the list?`)
    if (!confirmed) return

    try {
      await clearFailedDownloads()
      const result = await listDownloads()
      setDownloads(result)
      notifySuccess('Downloads Cleared', `Cleared ${failedCount} failed download(s)`)
    } catch (error) {
      console.error('Failed to clear failed downloads:', error)
      notifyError('Clear Failed', 'Failed to clear failed downloads')
    }
  }

  const handleOpenFolder = async () => {
    try {
      // Pass custom location if set, otherwise backend will use default
      await openDownloadsFolder(customDownloadLocation || undefined)
      notifySuccess('Folder Opened', 'Downloads folder opened')
    } catch (error) {
      console.error('Failed to open folder:', error)
      notifyError('Open Failed', 'Failed to open folder: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  const handleDeleteAnime = async (mediaId: string, mediaTitle: string) => {
    const animeDownloads = downloads.filter(d => d.media_id === mediaId && d.status === 'completed')

    if (animeDownloads.length === 0) {
      notifyError('No Downloads', 'No completed downloads to delete')
      return
    }

    const confirmed = await ask(`Delete all episodes for "${mediaTitle}"? This will permanently remove ${animeDownloads.length} file(s).`, { kind: 'warning' })
    if (!confirmed) return

    try {
      // Delete all downloads for this anime
      await Promise.all(animeDownloads.map(d => deleteDownload(d.id)))

      // Refresh downloads
      const [downloadsList, storage] = await Promise.all([
        listDownloads(),
        getTotalStorageUsed()
      ])
      setDownloads(downloadsList)
      setTotalStorage(storage)

      notifySuccess(mediaTitle, `Deleted ${animeDownloads.length} episode${animeDownloads.length > 1 ? 's' : ''}`)
    } catch (error) {
      console.error('Failed to delete anime downloads:', error)
      notifyError(mediaTitle, 'Failed to delete some episodes')
    }
  }

  const handleCancelChapter = async (mediaId: string, chapterId: string) => {
    const chapter = chapterDownloads.find(d => d.media_id === mediaId && d.chapter_id === chapterId)
    const displayName = chapter ? `${chapter.media_title} Ch.${chapter.chapter_number}` : 'Chapter'
    try {
      await cancelChapterDownload(mediaId, chapterId)
      // Refresh chapter downloads
      const result = await listAllChapterDownloads()
      setChapterDownloads(result)
      notifySuccess('Download Cancelled', `Cancelled "${displayName}"`)
    } catch (error) {
      console.error('Failed to cancel chapter download:', error)
      notifyError('Cancel Failed', `Failed to cancel "${displayName}"`)
    }
  }

  const handleDeleteChapter = async (mediaId: string, chapterId: string) => {
    const chapter = chapterDownloads.find(d => d.media_id === mediaId && d.chapter_id === chapterId)
    const displayName = chapter ? `${chapter.media_title} Ch.${chapter.chapter_number}` : 'Chapter'

    const confirmed = await ask(`Delete "${displayName}"? This will permanently remove the downloaded images.`, { kind: 'warning' })
    if (!confirmed) return

    try {
      await deleteChapterDownload(mediaId, chapterId)

      // Refresh chapter downloads
      const [chaptersList, storage] = await Promise.all([
        listAllChapterDownloads(),
        getTotalStorageUsed()
      ])
      setChapterDownloads(chaptersList)
      setTotalStorage(storage)

      notifySuccess('Chapter Deleted', `Deleted "${displayName}"`)
    } catch (error) {
      console.error('Failed to delete chapter:', error)
      notifyError('Delete Failed', `Failed to delete "${displayName}"`)
    }
  }

  const handleDeleteManga = async (mediaId: string, mediaTitle: string) => {
    const mangaChapters = chapterDownloads.filter(d => d.media_id === mediaId && d.status === 'completed')

    if (mangaChapters.length === 0) {
      notifyError('No Downloads', `No completed downloads for "${mediaTitle}"`)
      return
    }

    const confirmed = await ask(`Delete all chapters for "${mediaTitle}"? This will permanently remove ${mangaChapters.length} chapter(s).`, { kind: 'warning' })
    if (!confirmed) return

    try {
      // Delete all chapters for this manga
      await Promise.all(mangaChapters.map(d => deleteChapterDownload(d.media_id, d.chapter_id)))

      // Refresh downloads
      const [chaptersList, storage] = await Promise.all([
        listAllChapterDownloads(),
        getTotalStorageUsed()
      ])
      setChapterDownloads(chaptersList)
      setTotalStorage(storage)

      notifySuccess(mediaTitle, `Deleted ${mangaChapters.length} chapter${mangaChapters.length > 1 ? 's' : ''}`)
    } catch (error) {
      console.error('Failed to delete manga chapters:', error)
      notifyError(mediaTitle, 'Failed to delete some chapters')
    }
  }

  const handlePlayEpisode = (mediaId: string, episodeId: string) => {
    navigate({
      to: '/watch',
      search: {
        malId: mediaId,
        episodeId: episodeId,
      },
    })
    onNavigateAway?.()
  }

  const handlePauseAll = async () => {
    const activeDownloads = downloads.filter(d => d.status === 'downloading')
    if (activeDownloads.length === 0) return
    try {
      await Promise.all(activeDownloads.map(d => pauseDownload(d.id)))
      const downloadsList = await listDownloads()
      setDownloads(downloadsList)
      notifySuccess('Downloads Paused', `Paused ${activeDownloads.length} download(s)`)
    } catch (error) {
      notifyError('Pause Failed', 'Failed to pause some downloads')
    }
  }

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  // Group downloads by anime
  const groupedDownloads: GroupedDownloads[] = downloads.reduce((groups, download) => {
    const existing = groups.find(g => g.mediaId === download.media_id)

    if (existing) {
      existing.downloads.push(download)
    } else {
      // Extract anime title from filename (before _EP)
      const titleMatch = download.filename.match(/^(.+?)_EP\d+/)
      const mediaTitle = titleMatch ? titleMatch[1].replace(/_/g, ' ') : 'Unknown Anime'

      groups.push({
        mediaId: download.media_id,
        mediaTitle,
        downloads: [download]
      })
    }

    return groups
  }, [] as GroupedDownloads[])

  // Sort by most recent download
  groupedDownloads.sort((a, b) => {
    const aLatest = Math.max(...a.downloads.map(d => d.downloaded_bytes))
    const bLatest = Math.max(...b.downloads.map(d => d.downloaded_bytes))
    return bLatest - aLatest
  })

  // Group chapter downloads by manga
  const groupedChapterDownloads: GroupedChapterDownloads[] = chapterDownloads.reduce((groups, download) => {
    const existing = groups.find(g => g.mediaId === download.media_id)

    if (existing) {
      existing.downloads.push(download)
    } else {
      groups.push({
        mediaId: download.media_id,
        mediaTitle: download.media_title,
        downloads: [download]
      })
    }

    return groups
  }, [] as GroupedChapterDownloads[])

  // Sort manga groups by chapter count (most chapters first)
  groupedChapterDownloads.sort((a, b) => b.downloads.length - a.downloads.length)

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  // Stats computation
  const completedCount = downloads.filter(d => d.status === 'completed').length + chapterDownloads.filter(d => d.status === 'completed').length
  const inProgressCount = downloads.filter(d => ['downloading', 'paused', 'queued'].includes(d.status)).length + chapterDownloads.filter(d => ['downloading', 'queued'].includes(d.status)).length
  const failedCount = downloads.filter(d => d.status === 'failed').length + chapterDownloads.filter(d => d.status === 'failed').length
  const totalCount = downloads.length + chapterDownloads.length
  const seriesCount = groupedDownloads.length + groupedChapterDownloads.length

  // Status-based filtering
  const statusFilter = (status: string): boolean => {
    if (activeTab === 'all') return true
    if (activeTab === 'completed') return status === 'completed'
    if (activeTab === 'in_progress') return ['downloading', 'paused', 'queued'].includes(status)
    if (activeTab === 'failed') return status === 'failed'
    return true
  }

  const filteredAnimeGroups = groupedDownloads
    .map(g => ({ ...g, downloads: g.downloads.filter(d => statusFilter(d.status)) }))
    .filter(g => g.downloads.length > 0)

  const filteredMangaGroups = groupedChapterDownloads
    .map(g => ({ ...g, downloads: g.downloads.filter(d => statusFilter(d.status)) }))
    .filter(g => g.downloads.length > 0)

  const extractQuality = (filename: string) => {
    const match = filename.match(/_(\d+p)\./)
    return match ? match[1] : null
  }

  // Compute per-type storage for segmented bar
  const animeBytes = downloads.reduce((sum, d) => sum + Math.max(d.total_bytes, d.downloaded_bytes), 0)
  const mangaBytes = Math.max(0, totalStorage - animeBytes)

  return (
    <div className="px-4 sm:px-6 py-5">
      {/* Shimmer animation for active progress bars */}
      <style>{`
        @keyframes shimmer-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>

      {/* Page Header */}
      <div className="mb-2">
        <h1 className="font-display font-extrabold text-[1.75rem]">Downloads</h1>
        <p className="text-[0.9375rem] text-[var(--color-text-muted)]">Manage your downloaded episodes and chapters</p>
      </div>

      {/* Storage Overview */}
      {totalStorage > 0 && (
        <div className="p-[18px_22px] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-[var(--radius-lg)] mb-5">
          <div className="flex items-baseline justify-between mb-2.5">
            <div className="font-mono text-[0.95rem] font-semibold">
              {formatBytes(totalStorage)} <span className="text-[var(--color-text-muted)] font-normal text-[0.85rem]">used</span>
            </div>
          </div>
          <div className="w-full h-2 bg-white/[0.06] rounded-full overflow-hidden flex">
            {animeBytes > 0 && (
              <div
                className="h-full bg-[var(--color-accent-primary)]"
                style={{ width: `${(animeBytes / totalStorage) * 100}%`, transition: 'width 0.4s ease' }}
                title={`Anime: ${formatBytes(animeBytes)}`}
              />
            )}
            {mangaBytes > 0 && (
              <div
                className="h-full bg-[#22d3ee]"
                style={{ width: `${(mangaBytes / totalStorage) * 100}%`, transition: 'width 0.4s ease' }}
                title={`Manga: ${formatBytes(mangaBytes)}`}
              />
            )}
          </div>
          <div className="flex items-center gap-4 mt-2.5">
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <div className="w-2 h-2 rounded-full bg-[var(--color-accent-primary)] flex-shrink-0" />
              Anime ({formatBytes(animeBytes)})
            </div>
            {mangaBytes > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <div className="w-2 h-2 rounded-full bg-[#22d3ee] flex-shrink-0" />
                Manga ({formatBytes(mangaBytes)})
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="flex items-center gap-5 flex-wrap px-5 py-3.5 bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] rounded-[var(--radius-lg)] mb-5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[0.9rem] font-semibold">{totalCount}</span>
          <span className="text-[0.7rem] text-[var(--color-text-muted)]">Total</span>
        </div>
        <div className="w-[3px] h-[3px] rounded-full bg-[var(--color-text-dim)]" />
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[0.9rem] font-semibold">{completedCount}</span>
          <span className="text-[0.7rem] text-[var(--color-text-muted)]">Completed</span>
        </div>
        <div className="w-[3px] h-[3px] rounded-full bg-[var(--color-text-dim)]" />
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[0.9rem] font-semibold">{inProgressCount}</span>
          <span className="text-[0.7rem] text-[var(--color-text-muted)]">In Progress</span>
        </div>
        <div className="w-[3px] h-[3px] rounded-full bg-[var(--color-text-dim)]" />
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[0.9rem] font-semibold">{failedCount}</span>
          <span className="text-[0.7rem] text-[var(--color-text-muted)]">Failed</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[0.9rem] font-semibold">{seriesCount}</span>
          <span className="text-[0.7rem] text-[var(--color-text-muted)]">Series</span>
        </div>
      </div>

      {/* Controls: Tabs + Actions */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-1">
          {(['all', 'completed', 'in_progress', 'failed'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-white hover:bg-white/5'
              }`}
            >
              {tab === 'all' ? 'All' : tab === 'completed' ? 'Completed' : tab === 'in_progress' ? 'In Progress' : 'Failed'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {completedCount > 0 && (
            <button onClick={handleClearCompleted} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] hover:bg-white/10 rounded-lg transition-colors text-sm">
              <Trash2 size={14} /> Clear completed
            </button>
          )}
          {!isMobile() && (
            <button onClick={handleOpenFolder} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] hover:bg-white/10 rounded-lg transition-colors text-sm">
              <Folder size={14} /> Open folder
            </button>
          )}
          {failedCount > 0 && (
            <button onClick={handleClearFailed} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] hover:bg-white/10 rounded-lg transition-colors text-sm text-red-400">
              <Trash2 size={14} /> Clear failed
            </button>
          )}
          {inProgressCount > 0 && (
            <button onClick={handlePauseAll} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] hover:bg-white/10 rounded-lg transition-colors text-sm">
              <Pause size={14} /> Pause All
            </button>
          )}
        </div>
      </div>

      {/* Download Groups */}
      {loading && totalCount === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
        </div>
      ) : totalCount === 0 ? (
        <div className="text-center py-16">
          <Download className="w-16 h-16 mx-auto mb-4 text-[var(--color-text-muted)]" />
          <p className="text-lg font-semibold mb-2">No Downloads Yet</p>
          <p className="text-[var(--color-text-secondary)]">Downloaded episodes and chapters will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Anime groups */}
          {filteredAnimeGroups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.mediaId)
            const groupTotalSize = group.downloads.reduce((sum, d) => sum + Math.max(d.total_bytes, d.downloaded_bytes), 0)
            const downloadingCount = group.downloads.filter(d => d.status === 'downloading').length
            const grpFailedCount = group.downloads.filter(d => d.status === 'failed').length
            const hasFailed = grpFailedCount > 0

            return (
              <div key={group.mediaId} className={`group/grp border rounded-[var(--radius-lg)] overflow-hidden transition-colors ${hasFailed ? 'border-red-400/20' : 'border-[var(--color-glass-border)] hover:border-[var(--color-glass-border-hover)]'}`}>
                {/* Group Header */}
                <button
                  onClick={() => toggleGroup(group.mediaId)}
                  className="w-full flex items-center gap-3.5 px-[18px] py-3.5 bg-white/[0.04] hover:bg-white/[0.06] transition-colors cursor-pointer select-none"
                >
                  <div className="w-12 h-16 rounded-md bg-white/5 flex-shrink-0 flex items-center justify-center overflow-hidden">
                    {coverUrls[group.mediaId] ? (
                      <img src={coverUrls[group.mediaId]} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Tv size={20} className="text-[var(--color-text-muted)]" />
                    )}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-[0.95rem] font-semibold truncate">{group.mediaTitle}</div>
                    <div className="flex items-center gap-2 text-[0.8rem] text-[var(--color-text-muted)] mt-0.5 flex-wrap">
                      <span>{formatBytes(groupTotalSize)}</span>
                      <div className="w-[3px] h-[3px] rounded-full bg-[var(--color-text-dim)] flex-shrink-0" />
                      <span>{group.downloads.length} episode{group.downloads.length !== 1 ? 's' : ''}</span>
                      {downloadingCount > 0 && (
                        <>
                          <div className="w-[3px] h-[3px] rounded-full bg-[var(--color-text-dim)] flex-shrink-0" />
                          <span className="inline-flex items-center gap-1 text-[var(--color-accent-light)] text-[0.75rem] font-semibold">
                            <Loader2 size={10} className="animate-spin" />
                            {downloadingCount} downloading
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {hasFailed && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[0.65rem] font-semibold bg-red-400/[0.12] text-red-400 border border-red-400/20 flex-shrink-0">
                      {grpFailedCount} failed
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteAnime(group.mediaId, group.mediaTitle) }}
                    className="w-7 h-7 rounded-[var(--radius-md)] border border-transparent text-[var(--color-text-dim)] opacity-0 group-hover/grp:opacity-100 hover:bg-red-400/15 hover:text-red-400 hover:border-red-400/30 flex items-center justify-center transition-all flex-shrink-0"
                    title="Delete all episodes"
                  >
                    <Trash2 size={14} />
                  </button>
                  <div className={`w-7 h-7 flex items-center justify-center text-[var(--color-text-muted)] flex-shrink-0 transition-transform duration-250 ${isCollapsed ? '-rotate-90' : ''}`}>
                    <ChevronDown size={18} />
                  </div>
                </button>

                {/* Episodes */}
                <div
                  className={`overflow-hidden transition-all duration-[350ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
                    isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[3000px] opacity-100'
                  }`}
                >
                  {group.downloads
                    .sort((a, b) => a.episode_number - b.episode_number)
                    .map((download) => (
                      <DownloadItem
                        key={download.id}
                        download={download}
                        onCancel={handleCancel}
                        onDelete={handleDelete}
                        onPause={handlePause}
                        onResume={handleResume}
                        onPlay={handlePlayEpisode}
                        extractQuality={extractQuality}
                        formatBytes={formatBytes}
                      />
                    ))}
                </div>
              </div>
            )
          })}

          {/* Manga groups */}
          {filteredMangaGroups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.mediaId)
            const grpFailedCount = group.downloads.filter(d => d.status === 'failed').length
            const hasFailed = grpFailedCount > 0

            return (
              <div key={group.mediaId} className={`group/grp border rounded-[var(--radius-lg)] overflow-hidden transition-colors ${hasFailed ? 'border-red-400/20' : 'border-[var(--color-glass-border)] hover:border-[var(--color-glass-border-hover)]'}`}>
                {/* Group Header */}
                <button
                  onClick={() => toggleGroup(group.mediaId)}
                  className="w-full flex items-center gap-3.5 px-[18px] py-3.5 bg-white/[0.04] hover:bg-white/[0.06] transition-colors cursor-pointer select-none"
                >
                  <div className="w-12 h-16 rounded-md bg-white/5 flex-shrink-0 flex items-center justify-center overflow-hidden">
                    {coverUrls[group.mediaId] ? (
                      <img src={coverUrls[group.mediaId]} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <BookOpen size={20} className="text-[var(--color-text-muted)]" />
                    )}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.95rem] font-semibold truncate">{group.mediaTitle}</span>
                      <span className="inline-flex px-2 py-0.5 rounded text-[0.6rem] font-bold uppercase tracking-wider bg-cyan-400/10 text-cyan-400 border border-cyan-400/20 font-mono flex-shrink-0">MANGA</span>
                    </div>
                    <div className="flex items-center gap-2 text-[0.8rem] text-[var(--color-text-muted)] mt-0.5">
                      <span>{group.downloads.length} chapter{group.downloads.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  {hasFailed && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[0.65rem] font-semibold bg-red-400/[0.12] text-red-400 border border-red-400/20 flex-shrink-0">
                      {grpFailedCount} failed
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteManga(group.mediaId, group.mediaTitle) }}
                    className="w-7 h-7 rounded-[var(--radius-md)] border border-transparent text-[var(--color-text-dim)] opacity-0 group-hover/grp:opacity-100 hover:bg-red-400/15 hover:text-red-400 hover:border-red-400/30 flex items-center justify-center transition-all flex-shrink-0"
                    title="Delete all chapters"
                  >
                    <Trash2 size={14} />
                  </button>
                  <div className={`w-7 h-7 flex items-center justify-center text-[var(--color-text-muted)] flex-shrink-0 transition-transform duration-250 ${isCollapsed ? '-rotate-90' : ''}`}>
                    <ChevronDown size={18} />
                  </div>
                </button>

                {/* Chapters */}
                <div
                  className={`overflow-hidden transition-all duration-[350ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
                    isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[3000px] opacity-100'
                  }`}
                >
                  {group.downloads
                    .sort((a, b) => a.chapter_number - b.chapter_number)
                    .map((download) => (
                      <ChapterDownloadItem
                        key={download.id}
                        download={download}
                        onCancel={handleCancelChapter}
                        onDelete={handleDeleteChapter}
                      />
                    ))}
                </div>
              </div>
            )
          })}

          {filteredAnimeGroups.length === 0 && filteredMangaGroups.length === 0 && (
            <div className="text-center py-12 text-[var(--color-text-muted)]">
              No downloads match the selected filter
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Modal shell for desktop — wraps DownloadPageContent with backdrop, fixed positioning,
 * close button, and Escape key handler. Not rendered on mobile (TopNav navigates to /downloads instead).
 */
export function DownloadManager({ isOpen, onClose }: DownloadManagerProps) {
  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }

    // Use capture phase to intercept before other handlers
    document.addEventListener('keydown', handleEscape, true)
    return () => document.removeEventListener('keydown', handleEscape, true)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-300">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/90 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div
        className="relative bg-[var(--color-bg-primary)] rounded-xl max-w-4xl w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-500 border border-white/5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button (modal only) */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 sm:top-6 sm:right-6 z-10 w-8 h-8 sm:w-10 sm:h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
        >
          <X size={20} className="sm:w-6 sm:h-6" />
        </button>

        <DownloadPageContent onNavigateAway={onClose} />
      </div>
    </div>
  )
}

// Episode download row — matches mock's inline layout with quality badge + progress bar
function DownloadItem({
  download,
  onCancel,
  onDelete,
  onPause,
  onResume,
  onPlay,
  extractQuality,
  formatBytes,
}: {
  download: DownloadProgress
  onCancel: (id: string) => void
  onDelete: (id: string, filename: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onPlay: (mediaId: string, episodeId: string) => void
  extractQuality: (filename: string) => string | null
  formatBytes: (bytes: number) => string
}) {
  const formatEta = (dl: DownloadProgress): string | null => {
    if (dl.speed <= 0 || dl.total_bytes <= 0) return null
    const remaining = dl.total_bytes - dl.downloaded_bytes
    if (remaining <= 0) return null
    const secs = Math.ceil(remaining / dl.speed)
    if (secs < 60) return `~${secs}s remaining`
    if (secs < 3600) return `~${Math.ceil(secs / 60)} min remaining`
    const h = Math.floor(secs / 3600)
    const m = Math.ceil((secs % 3600) / 60)
    return `~${h}h ${m}m remaining`
  }

  const quality = extractQuality(download.filename)
  const isFailed = download.status === 'failed'

  return (
    <div className={`group flex items-center gap-3.5 py-3 px-[18px] pl-[92px] bg-white/[0.02] border-t border-white/[0.04] transition-colors hover:bg-white/[0.04] relative ${isFailed ? 'bg-red-400/[0.04]' : ''}`}>
      {/* Episode label */}
      <span className="font-mono text-[0.8rem] font-semibold text-[var(--color-text-secondary)] min-w-[64px] flex-shrink-0">
        Episode {download.episode_number}
      </span>

      {/* Info: quality badge + size + status */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quality badge */}
          {quality && (
            <span className={`inline-flex px-[7px] py-[2px] rounded-[var(--radius-sm)] font-mono text-[0.6rem] font-semibold border ${
              quality === '720p'
                ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20'
                : 'bg-[rgba(229,9,20,0.1)] text-[var(--color-accent-light)] border-[rgba(229,9,20,0.2)]'
            }`}>
              {quality}
            </span>
          )}

          {/* Size */}
          {download.total_bytes > 0 && (
            <span className="text-[0.8rem] text-[var(--color-text-muted)]">{formatBytes(download.total_bytes)}</span>
          )}

          {/* Status badge */}
          {download.status === 'completed' && (
            <span className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-green-400">
              <CheckCircle size={12} /> Completed
            </span>
          )}
          {download.status === 'downloading' && (
            <span className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-[var(--color-accent-light)]">
              <Loader2 size={10} className="animate-spin" />
              {download.percentage.toFixed(0)}%
            </span>
          )}
          {download.status === 'paused' && (
            <span className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-yellow-400">
              <Pause size={10} /> Paused
            </span>
          )}
          {download.status === 'failed' && (
            <span className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-red-400">
              <X size={10} /> Failed
            </span>
          )}
          {download.status === 'queued' && (
            <span className="text-[0.75rem] font-semibold text-[var(--color-text-muted)]">Queued</span>
          )}
        </div>

        {/* Progress bar for downloading/paused */}
        {(download.status === 'downloading' || download.status === 'paused') && (
          <div className="mt-1.5">
            <div className="w-full h-1 bg-[var(--color-glass-border)] rounded-full overflow-hidden relative">
              <div
                className="h-full rounded-full transition-[width] duration-300 relative overflow-hidden"
                style={{
                  width: `${download.percentage}%`,
                  background: download.status === 'paused'
                    ? 'var(--color-gold, #f5c518)'
                    : 'var(--color-accent-gradient-h, linear-gradient(90deg, var(--color-accent-primary), var(--color-accent-light)))',
                  boxShadow: download.status === 'downloading'
                    ? '0 0 10px var(--color-accent-glow, rgba(229,9,20,0.4))'
                    : download.status === 'paused' ? '0 0 8px rgba(245,197,24,0.3)' : 'none',
                }}
              >
                {download.status === 'downloading' && (
                  <div
                    className="absolute inset-0"
                    style={{
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                      animation: 'shimmer-progress 1.5s ease-in-out infinite',
                    }}
                  />
                )}
              </div>
            </div>
            <div className="font-mono text-[0.68rem] text-[var(--color-text-muted)] mt-0.5">
              {formatBytes(download.downloaded_bytes)} / {formatBytes(download.total_bytes)}
              {formatEta(download) && <span className="ml-2">{formatEta(download)}</span>}
            </div>
          </div>
        )}

        {/* Completed progress bar (full green) */}
        {download.status === 'completed' && (
          <div className="mt-1.5 w-full h-1 bg-[var(--color-glass-border)] rounded-full overflow-hidden">
            <div className="h-full w-full rounded-full bg-green-400" style={{ boxShadow: '0 0 8px rgba(70,211,105,0.3)' }} />
          </div>
        )}

        {/* Failed progress bar */}
        {download.status === 'failed' && download.percentage > 0 && (
          <div className="mt-1.5 w-full h-1 bg-[var(--color-glass-border)] rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-red-400" style={{ width: `${download.percentage}%`, boxShadow: '0 0 8px rgba(248,113,113,0.3)' }} />
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {download.status === 'downloading' && (
          <>
            <button onClick={() => onPause(download.id)} className="w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] hover:text-white hover:bg-white/10 flex items-center justify-center transition-all" title="Pause">
              <Pause size={13} />
            </button>
            <button onClick={() => onCancel(download.id)} className="w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] hover:text-white hover:bg-white/10 flex items-center justify-center transition-all" title="Cancel">
              <X size={13} />
            </button>
          </>
        )}
        {download.status === 'paused' && (
          <>
            <button onClick={() => onResume(download.id)} className="w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] text-green-400 hover:bg-green-500/10 flex items-center justify-center transition-all" title="Resume">
              <Play size={13} />
            </button>
            <button onClick={() => onCancel(download.id)} className="w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] hover:text-white hover:bg-white/10 flex items-center justify-center transition-all" title="Cancel">
              <X size={13} />
            </button>
          </>
        )}
        {download.status === 'failed' && (
          <button onClick={() => onResume(download.id)} className="inline-flex items-center gap-1 px-2.5 py-[3px] rounded-[var(--radius-sm)] text-[0.7rem] font-semibold bg-red-400/[0.12] text-red-400 border border-red-400/25 hover:bg-red-400/[0.22] hover:border-red-400/40 transition-all cursor-pointer" title="Retry">
            Retry
          </button>
        )}
        {download.status === 'queued' && (
          <button onClick={() => onCancel(download.id)} className="w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] hover:text-white hover:bg-white/10 flex items-center justify-center transition-all" title="Cancel">
            <X size={13} />
          </button>
        )}
        {download.status === 'completed' && (
          <>
            <button onClick={() => onPlay(download.media_id, download.episode_id)} className="w-7 h-7 rounded-[var(--radius-md)] border border-transparent text-[var(--color-text-dim)] opacity-0 group-hover:opacity-100 hover:bg-green-500/15 hover:text-green-400 hover:border-green-400/30 flex items-center justify-center transition-all" title="Play">
              <Play size={13} />
            </button>
            <button onClick={() => onDelete(download.id, download.filename)} className="w-7 h-7 rounded-[var(--radius-md)] border border-transparent text-[var(--color-text-dim)] opacity-0 group-hover:opacity-100 hover:bg-red-400/15 hover:text-red-400 hover:border-red-400/30 flex items-center justify-center transition-all" title="Delete">
              <Trash2 size={13} />
            </button>
          </>
        )}
        {download.status === 'cancelled' && (
          <button onClick={() => onDelete(download.id, download.filename)} className="w-7 h-7 rounded-[var(--radius-md)] border border-transparent text-[var(--color-text-dim)] hover:bg-red-400/15 hover:text-red-400 flex items-center justify-center transition-all" title="Remove">
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

// Chapter download row — matches mock's inline layout for manga chapters
function ChapterDownloadItem({
  download,
  onCancel,
  onDelete
}: {
  download: ChapterDownloadWithTitle
  onCancel: (mediaId: string, chapterId: string) => void
  onDelete: (mediaId: string, chapterId: string) => void
}) {
  const isFailed = download.status === 'failed'

  return (
    <div className={`group flex items-center gap-3.5 py-3 px-[18px] pl-[92px] bg-white/[0.02] border-t border-white/[0.04] transition-colors hover:bg-white/[0.04] relative ${isFailed ? 'bg-red-400/[0.04]' : ''}`}>
      {/* Chapter label */}
      <span className="font-mono text-[0.8rem] font-semibold text-[var(--color-text-secondary)] min-w-[64px] flex-shrink-0">
        Ch. {download.chapter_number}
      </span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {download.total_images > 0 && (
            <span className="text-[0.8rem] text-[var(--color-text-muted)]">{download.total_images} images</span>
          )}

          {download.status === 'completed' && (
            <span className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-green-400">
              <CheckCircle size={12} /> Completed
            </span>
          )}
          {download.status === 'downloading' && (
            <span className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-[var(--color-accent-light)]">
              <Loader2 size={10} className="animate-spin" />
              {download.downloaded_images}/{download.total_images}
            </span>
          )}
          {download.status === 'failed' && (
            <span className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-red-400">
              <X size={10} /> Failed
            </span>
          )}
          {download.status === 'queued' && (
            <span className="text-[0.75rem] font-semibold text-[var(--color-text-muted)]">Queued</span>
          )}
        </div>

        {/* Progress bar */}
        {download.status === 'downloading' && (
          <div className="mt-1.5">
            <div className="w-full h-1 bg-[var(--color-glass-border)] rounded-full overflow-hidden relative">
              <div
                className="h-full rounded-full transition-[width] duration-300 relative overflow-hidden"
                style={{
                  width: `${download.percentage}%`,
                  background: 'var(--color-accent-gradient-h, linear-gradient(90deg, var(--color-accent-primary), var(--color-accent-light)))',
                  boxShadow: '0 0 10px var(--color-accent-glow, rgba(229,9,20,0.4))',
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                    animation: 'shimmer-progress 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            </div>
            <div className="font-mono text-[0.68rem] text-[var(--color-text-muted)] mt-0.5">
              {download.downloaded_images} / {download.total_images} images
            </div>
          </div>
        )}

        {download.status === 'completed' && (
          <div className="mt-1.5 w-full h-1 bg-[var(--color-glass-border)] rounded-full overflow-hidden">
            <div className="h-full w-full rounded-full bg-green-400" style={{ boxShadow: '0 0 8px rgba(70,211,105,0.3)' }} />
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {(download.status === 'downloading' || download.status === 'queued') && (
          <button onClick={() => onCancel(download.media_id, download.chapter_id)} className="w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] hover:text-white hover:bg-white/10 flex items-center justify-center transition-all" title="Cancel">
            <X size={13} />
          </button>
        )}
        {download.status === 'completed' && (
          <button onClick={() => onDelete(download.media_id, download.chapter_id)} className="w-7 h-7 rounded-[var(--radius-md)] border border-transparent text-[var(--color-text-dim)] opacity-0 group-hover:opacity-100 hover:bg-red-400/15 hover:text-red-400 hover:border-red-400/30 flex items-center justify-center transition-all" title="Delete">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
