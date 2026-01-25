/**
 * DownloadManager Component
 *
 * Modal displaying all active and completed downloads with progress tracking
 */

import { useEffect, useState } from 'react'
import { X, Download, Trash2, CheckCircle, XCircle, Loader2, Folder } from 'lucide-react'
import { listDownloads, cancelDownload, type DownloadProgress } from '@/utils/tauri-commands'
import { open } from '@tauri-apps/plugin-shell'

interface DownloadManagerProps {
  isOpen: boolean
  onClose: () => void
}

export function DownloadManager({ isOpen, onClose }: DownloadManagerProps) {
  const [downloads, setDownloads] = useState<DownloadProgress[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    const loadDownloads = async () => {
      setLoading(true)
      try {
        const result = await listDownloads()
        setDownloads(result)
      } catch (error) {
        console.error('Failed to load downloads:', error)
      } finally {
        setLoading(false)
      }
    }

    loadDownloads()

    // Poll for updates every 500ms when open
    const interval = setInterval(loadDownloads, 500)
    return () => clearInterval(interval)
  }, [isOpen])

  const handleCancel = async (downloadId: string) => {
    try {
      await cancelDownload(downloadId)
      // Refresh downloads
      const result = await listDownloads()
      setDownloads(result)
    } catch (error) {
      console.error('Failed to cancel download:', error)
    }
  }

  const handleOpenFolder = async () => {
    try {
      // Open downloads folder
      const homeDir = await import('@tauri-apps/api/path').then(m => m.downloadDir())
      const otakuPath = `${await homeDir}/Otaku`
      await open(otakuPath)
    } catch (error) {
      console.error('Failed to open folder:', error)
    }
  }

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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto animate-in fade-in duration-300">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/90 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-[var(--color-bg-primary)] rounded-xl max-w-4xl w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-500 border border-white/5">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/10">
            <div className="flex items-center gap-3">
              <Download className="w-6 h-6 text-[var(--color-accent-primary)]" />
              <h2 className="text-2xl font-bold">Downloads</h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenFolder}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm font-medium"
              >
                <Folder size={16} />
                Open Folder
              </button>

              <button
                onClick={onClose}
                className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <X size={24} />
              </button>
            </div>
          </div>

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
            ) : (
              <div className="space-y-3">
                {downloads.map((download) => (
                  <div
                    key={download.id}
                    className="bg-[var(--color-bg-secondary)] rounded-lg p-4 hover:bg-[var(--color-bg-hover)] transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* Status Icon */}
                      <div className="flex-shrink-0 pt-1">
                        {getStatusIcon(download.status)}
                      </div>

                      {/* Download Info */}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold mb-1 truncate">{download.filename}</h3>

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
                            </>
                          )}

                          {download.status === 'completed' && (
                            <span className="text-green-400 font-medium">
                              Completed · {formatBytes(download.total_bytes)}
                            </span>
                          )}

                          {download.status === 'failed' && (
                            <span className="text-red-400 font-medium">Failed</span>
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
                      <div className="flex-shrink-0">
                        {(download.status === 'downloading' || download.status === 'queued') && (
                          <button
                            onClick={() => handleCancel(download.id)}
                            className="w-8 h-8 flex items-center justify-center hover:bg-red-500/20 text-red-400 rounded transition-colors"
                            title="Cancel Download"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
