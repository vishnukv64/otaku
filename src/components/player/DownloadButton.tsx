/**
 * DownloadButton Component
 *
 * Allows users to download the current episode with quality selection
 */

import { useState } from 'react'
import { Download, Check, X, Loader2, Star } from 'lucide-react'
import type { VideoSource } from '@/types/extension'
import { startDownload } from '@/utils/tauri-commands'
import { useSettingsStore } from '@/store/settingsStore'

interface DownloadButtonProps {
  sources: VideoSource[]
  mediaId: string
  episodeId: string
  animeTitle: string
  episodeNumber: number
  className?: string
}

export function DownloadButton({
  sources,
  mediaId,
  episodeId,
  animeTitle,
  episodeNumber,
  className = '',
}: DownloadButtonProps) {
  const defaultDownloadQuality = useSettingsStore((state) => state.defaultDownloadQuality)
  const [showOptions, setShowOptions] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)

  const handleDownload = async (source: VideoSource) => {
    setShowOptions(false)
    setDownloading(source.quality)

    try {
      const filename = `${animeTitle.replace(/[^a-zA-Z0-9]/g, '_')}_EP${episodeNumber}_${source.quality}.mp4`
      // Correct parameter order: mediaId, episodeId, episodeNumber, url, filename
      await startDownload(mediaId, episodeId, episodeNumber, source.url, filename)

      setCompleted(true)
      setTimeout(() => {
        setCompleted(false)
        setDownloading(null)
      }, 2000)
    } catch (error) {
      console.error('Download failed:', error)
      setDownloading(null)
    }
  }

  // Filter sources to get unique quality options
  const downloadOptions = sources.filter((s) => s.url && s.url.trim() !== '')

  if (downloadOptions.length === 0) {
    return null
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowOptions(!showOptions)}
        disabled={!!downloading}
        className={`w-10 h-10 flex items-center justify-center hover:bg-white/20 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
        title="Download Episode"
      >
        {downloading ? (
          <Loader2 size={20} className="animate-spin" />
        ) : completed ? (
          <Check size={20} className="text-green-400" />
        ) : (
          <Download size={20} />
        )}
      </button>

      {/* Download Options Menu */}
      {showOptions && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowOptions(false)}
          />

          {/* Options Panel */}
          <div className="absolute bottom-full right-0 mb-2 bg-black/95 backdrop-blur-sm rounded-lg shadow-xl p-4 min-w-[250px] z-50">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold">Download Episode {episodeNumber}</h4>
              <button
                onClick={() => setShowOptions(false)}
                className="w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-1">
              {downloadOptions.map((source, index) => {
                // Check if this matches the default quality (or auto = first available)
                const isDefault =
                  defaultDownloadQuality === 'auto'
                    ? index === 0
                    : source.quality.toLowerCase().includes(defaultDownloadQuality);

                return (
                  <button
                    key={index}
                    onClick={() => handleDownload(source)}
                    className={`w-full text-left px-3 py-2 rounded hover:bg-white/10 transition-colors text-sm flex items-center justify-between group ${
                      isDefault ? 'bg-[var(--color-accent-primary)]/10 border border-[var(--color-accent-primary)]/30' : ''
                    }`}
                  >
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {source.quality}
                        {isDefault && (
                          <Star size={12} className="text-[var(--color-accent-primary)]" fill="currentColor" />
                        )}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {source.server} · {source.type.toUpperCase()}
                      </div>
                    </div>
                    <Download size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
