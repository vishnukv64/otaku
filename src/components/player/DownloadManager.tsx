/**
 * DownloadManager Component
 *
 * Modal displaying all active and completed downloads with progress tracking
 */

import { useEffect, useState } from 'react'
import { X, Download, Trash2, CheckCircle, XCircle, Loader2, Folder, HardDrive, Copy } from 'lucide-react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { listDownloads, cancelDownload, deleteDownload, getTotalStorageUsed, clearCompletedDownloads, clearFailedDownloads, getDownloadsDirectory, openDownloadsFolder, type DownloadProgress } from '@/utils/tauri-commands'
import toast from 'react-hot-toast'

const DOWNLOAD_PROGRESS_EVENT = 'download-progress'

interface DownloadManagerProps {
  isOpen: boolean
  onClose: () => void
}

interface GroupedDownloads {
  mediaId: string
  mediaTitle: string
  downloads: DownloadProgress[]
}

export function DownloadManager({ isOpen, onClose }: DownloadManagerProps) {
  const [downloads, setDownloads] = useState<DownloadProgress[]>([])
  const [loading, setLoading] = useState(false)
  const [totalStorage, setTotalStorage] = useState(0)
  const [downloadsPath, setDownloadsPath] = useState<string>('')
  const [activeTab, setActiveTab] = useState<string>('all')

  // Load static data once on mount
  useEffect(() => {
    if (!isOpen) return

    const loadStaticData = async () => {
      try {
        const [storage, path] = await Promise.all([
          getTotalStorageUsed(),
          getDownloadsDirectory()
        ])
        setTotalStorage(storage)
        setDownloadsPath(path)
      } catch (error) {
        console.error('Failed to load static data:', error)
      }
    }

    loadStaticData()
  }, [isOpen])

  // Load downloads and listen for real-time events
  useEffect(() => {
    if (!isOpen) return

    let isMounted = true
    let unlisten: UnlistenFn | null = null
    const downloadsMap = new Map<string, DownloadProgress>()

    const fetchInitialDownloads = async () => {
      try {
        const downloadsList = await listDownloads()
        if (isMounted) {
          downloadsList.forEach(d => downloadsMap.set(d.id, d))
          setDownloads(downloadsList)

          if (downloadsList.length > 0) {
            const storage = await getTotalStorageUsed()
            if (isMounted) setTotalStorage(storage)
          }
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

    // Initial load
    setLoading(true)
    fetchInitialDownloads()
    setupEventListener()

    // Cleanup
    return () => {
      isMounted = false
      if (unlisten) {
        unlisten()
      }
    }
  }, [isOpen])

  const handleCancel = async (downloadId: string) => {
    try {
      await cancelDownload(downloadId)
      // Refresh downloads
      const result = await listDownloads()
      setDownloads(result)
      toast.success('Download cancelled')
    } catch (error) {
      console.error('Failed to cancel download:', error)
      toast.error('Failed to cancel download')
    }
  }

  const handleDelete = async (downloadId: string, filename: string) => {
    if (!confirm(`Delete "${filename}"? This will permanently remove the file.`)) {
      return
    }

    try {
      await deleteDownload(downloadId)
      // Refresh downloads
      const [downloadsList, storage] = await Promise.all([
        listDownloads(),
        getTotalStorageUsed()
      ])
      setDownloads(downloadsList)
      setTotalStorage(storage)
      toast.success('Download deleted')
    } catch (error) {
      console.error('Failed to delete download:', error)
      toast.error('Failed to delete download')
    }
  }

  const handleClearCompleted = async () => {
    const completedCount = downloads.filter(d => d.status === 'completed').length
    if (completedCount === 0) {
      toast.error('No completed downloads to clear')
      return
    }

    if (!confirm(`Clear ${completedCount} completed download(s) from the list? Files will not be deleted.`)) {
      return
    }

    try {
      await clearCompletedDownloads()
      const result = await listDownloads()
      setDownloads(result)
      toast.success(`Cleared ${completedCount} completed download(s)`)
    } catch (error) {
      console.error('Failed to clear completed downloads:', error)
      toast.error('Failed to clear completed downloads')
    }
  }

  const handleClearFailed = async () => {
    const failedCount = downloads.filter(d => d.status === 'failed').length
    if (failedCount === 0) {
      toast.error('No failed downloads to clear')
      return
    }

    if (!confirm(`Clear ${failedCount} failed download(s) from the list?`)) {
      return
    }

    try {
      await clearFailedDownloads()
      const result = await listDownloads()
      setDownloads(result)
      toast.success(`Cleared ${failedCount} failed download(s)`)
    } catch (error) {
      console.error('Failed to clear failed downloads:', error)
      toast.error('Failed to clear failed downloads')
    }
  }

  const handleOpenFolder = async () => {
    try {
      await openDownloadsFolder()
      toast.success('Opened downloads folder')
    } catch (error) {
      console.error('Failed to open folder:', error)
      toast.error('Failed to open folder: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  const handleCopyPath = () => {
    if (!downloadsPath) {
      toast.error('Downloads path not available')
      return
    }
    navigator.clipboard.writeText(downloadsPath)
    toast.success('Path copied to clipboard')
  }

  const handleDeleteAnime = async (mediaId: string, mediaTitle: string) => {
    const animeDownloads = downloads.filter(d => d.media_id === mediaId && d.status === 'completed')

    if (animeDownloads.length === 0) {
      toast.error('No completed downloads to delete')
      return
    }

    if (!confirm(`Delete all episodes for "${mediaTitle}"? This will permanently remove ${animeDownloads.length} file(s).`)) {
      return
    }

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

      toast.success(`Deleted ${animeDownloads.length} episode(s)`)
    } catch (error) {
      console.error('Failed to delete anime downloads:', error)
      toast.error('Failed to delete some episodes')
    }
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

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-300">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/90 backdrop-blur-md -z-10"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div
        className="relative bg-[var(--color-bg-primary)] rounded-xl max-w-4xl w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-500 border border-white/5"
        onClick={(e) => e.stopPropagation()}
      >
          {/* Header */}
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Download className="w-6 h-6 text-[var(--color-accent-primary)]" />
                <h2 className="text-2xl font-bold">Downloads</h2>
              </div>

              <button
                onClick={onClose}
                className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Storage info and path */}
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                  <HardDrive size={16} />
                  <span>Storage: {formatBytes(totalStorage)}</span>
                </div>
                <span className="text-[var(--color-text-muted)]">•</span>
                <span className="text-[var(--color-text-secondary)]">
                  {downloads.length} download(s)
                </span>
              </div>

              {/* Downloads path */}
              {downloadsPath && (
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] bg-white/5 rounded px-3 py-2">
                  <Folder size={14} />
                  <span className="flex-1 truncate" title={downloadsPath}>
                    {downloadsPath}
                  </span>
                  <button
                    onClick={handleCopyPath}
                    className="flex-shrink-0 hover:text-[var(--color-text-secondary)] transition-colors"
                    title="Copy path"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={handleOpenFolder}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm font-medium"
              >
                <Folder size={14} />
                Open Folder
              </button>

                {downloads.filter(d => d.status === 'completed').length > 0 && (
                <button
                  onClick={handleClearCompleted}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm font-medium"
                >
                  Clear Completed
                </button>
              )}

              {downloads.filter(d => d.status === 'failed').length > 0 && (
                <button
                  onClick={handleClearFailed}
                  className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors text-sm font-medium"
                >
                  Clear Failed
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          {groupedDownloads.length > 0 && (
            <div className="border-b border-white/10 px-6">
              <div className="flex gap-1 overflow-x-auto">
                <button
                  onClick={() => setActiveTab('all')}
                  className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === 'all'
                      ? 'text-[var(--color-accent-primary)] border-b-2 border-[var(--color-accent-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  All ({downloads.length})
                </button>
                {groupedDownloads.map((group) => (
                  <button
                    key={group.mediaId}
                    onClick={() => setActiveTab(group.mediaId)}
                    className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                      activeTab === group.mediaId
                        ? 'text-[var(--color-accent-primary)] border-b-2 border-[var(--color-accent-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {group.mediaTitle} ({group.downloads.length})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Download List */}
          <div className="p-6 max-h-[600px] overflow-y-auto">
            {loading && downloads.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-primary)]" />
              </div>
            ) : downloads.length === 0 ? (
              <div className="text-center py-12">
                <Download className="w-16 h-16 mx-auto mb-4 text-[var(--color-text-muted)]" />
                <p className="text-lg font-semibold mb-2">No Downloads Yet</p>
                <p className="text-[var(--color-text-secondary)]">
                  Downloaded episodes will appear here
                </p>
              </div>
            ) : activeTab !== 'all' ? (
              // Show grouped by anime with delete button
              <div className="space-y-4">
                {groupedDownloads
                  .filter(g => g.mediaId === activeTab)
                  .map((group) => (
                    <div key={group.mediaId}>
                      {/* Anime header with delete button */}
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold">{group.mediaTitle}</h3>
                        {group.downloads.some(d => d.status === 'completed') && (
                          <button
                            onClick={() => handleDeleteAnime(group.mediaId, group.mediaTitle)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors text-sm font-medium"
                          >
                            <Trash2 size={14} />
                            Delete All
                          </button>
                        )}
                      </div>

                      {/* Episodes */}
                      <div className="space-y-3">
                        {group.downloads
                          .sort((a, b) => a.episode_number - b.episode_number)
                          .map((download) => (
                            <DownloadItem key={download.id} download={download} onCancel={handleCancel} onDelete={handleDelete} />
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              // Show all downloads grouped by anime
              <div className="space-y-6">
                {groupedDownloads.map((group) => (
                  <div key={group.mediaId}>
                    {/* Anime header with delete button */}
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold">{group.mediaTitle}</h3>
                      {group.downloads.some(d => d.status === 'completed') && (
                        <button
                          onClick={() => handleDeleteAnime(group.mediaId, group.mediaTitle)}
                          className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors text-sm font-medium"
                        >
                          <Trash2 size={14} />
                          Delete All
                        </button>
                      )}
                    </div>

                    {/* Episodes */}
                    <div className="space-y-3">
                      {group.downloads
                        .sort((a, b) => a.episode_number - b.episode_number)
                        .map((download) => (
                          <DownloadItem key={download.id} download={download} onCancel={handleCancel} onDelete={handleDelete} />
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
    </div>
  )
}

// Extract download item to a separate component for cleaner code
function DownloadItem({
  download,
  onCancel,
  onDelete
}: {
  download: DownloadProgress
  onCancel: (id: string) => void
  onDelete: (id: string, filename: string) => void
}) {
  const getStatusIcon = (status: DownloadProgress['status']) => {
    switch (status) {
      case 'downloading':
        return <Loader2 size={20} className="animate-spin text-blue-400" />
      case 'completed':
        return <CheckCircle size={20} className="text-green-400" />
      case 'failed':
      case 'cancelled':
        return <XCircle size={20} className="text-red-400" />
      default:
        return <Download size={20} className="text-[var(--color-text-muted)]" />
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  return (
    <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4 hover:bg-[var(--color-bg-hover)] transition-colors">
      <div className="flex items-start gap-4">
        {/* Status Icon */}
        <div className="flex-shrink-0 pt-1">
          {getStatusIcon(download.status)}
        </div>

        {/* Download Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold mb-1 truncate">
            Episode {download.episode_number}
          </h3>

          {/* Progress Bar */}
          {download.status === 'downloading' && (
            <div className="mb-2">
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-accent-primary)] transition-all duration-300"
                  style={{ width: `${download.percentage}%` }}
                />
              </div>
            </div>
          )}

          {/* Status Info */}
          <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
            {download.status === 'downloading' && (
              <>
                <span>{download.percentage.toFixed(1)}%</span>
                <span>
                  {formatBytes(download.downloaded_bytes)} / {formatBytes(download.total_bytes)}
                </span>
                {download.speed > 0 && (
                  <span className="text-blue-400">
                    {formatBytes(download.speed)}/s
                  </span>
                )}
              </>
            )}

            {download.status === 'completed' && (
              <span className="text-green-400 font-medium">
                Completed · {formatBytes(download.total_bytes)}
              </span>
            )}

            {download.status === 'failed' && (
              <>
                <span className="text-red-400 font-medium">Failed</span>
                {download.error_message && (
                  <span className="text-red-400 text-xs">{download.error_message}</span>
                )}
              </>
            )}

            {download.status === 'cancelled' && (
              <span className="text-[var(--color-text-muted)] font-medium">Cancelled</span>
            )}

            {download.status === 'queued' && (
              <span className="text-yellow-400 font-medium">Queued</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {(download.status === 'downloading' || download.status === 'queued') && (
            <button
              onClick={() => onCancel(download.id)}
              className="w-8 h-8 flex items-center justify-center hover:bg-red-500/20 text-red-400 rounded transition-colors"
              title="Cancel Download"
            >
              <X size={16} />
            </button>
          )}

          {download.status === 'completed' && (
            <button
              onClick={() => onDelete(download.id, download.filename)}
              className="w-8 h-8 flex items-center justify-center hover:bg-red-500/20 text-red-400 rounded transition-colors"
              title="Delete File"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
