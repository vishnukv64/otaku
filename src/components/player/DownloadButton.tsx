/**
 * DownloadButton Component
 *
 * Allows users to download the current episode with quality selection
 */

import { useEffect, useState } from 'react'
import { Download, Check, X, Loader2, Star } from 'lucide-react'
import type { VideoSource } from '@/types/extension'
import { startDownload } from '@/utils/tauri-commands'
import { useSettingsStore } from '@/store/settingsStore'
import { isAdaptive, qualityLabel, parseQualityPreference } from '@/utils/pickSource'
import { listAdaptiveVariants, resolveAdaptiveToVariant } from '@/utils/hlsResolve'

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
  const customDownloadLocation = useSettingsStore((state) => state.downloadLocation)
  const [showOptions, setShowOptions] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [resolvingOptions, setResolvingOptions] = useState(false)
  const [downloadOptions, setDownloadOptions] = useState<VideoSource[]>([])
  const hasAnySource = sources.some((s) => s.url && s.url.trim() !== '')

  useEffect(() => {
    if (!showOptions) return
    let cancelled = false

    const buildOptions = async () => {
      setResolvingOptions(true)
      const seen = new Set<string>()
      const out: VideoSource[] = []

      for (const source of sources) {
        if (!source.url || source.url.trim() === '') continue

        if (isAdaptive(source)) {
          try {
            const variants = await listAdaptiveVariants(source)
            for (const variant of variants) {
              const key = `${source.server}|${variant.resolution}`
              if (seen.has(key)) continue
              seen.add(key)
              out.push({
                ...source,
                url: variant.url,
                resolution: variant.resolution,
                quality: `${variant.resolution}p`,
              })
            }
          } catch (err) {
            console.warn('[DownloadButton] failed to expand adaptive variants', err)
          }
          continue
        }

        const key = `${source.server}|${source.resolution ?? 'adaptive'}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(source)
      }

      out.sort((a, b) => {
        if (a.server !== b.server) return a.server.localeCompare(b.server)
        return (b.resolution ?? 0) - (a.resolution ?? 0)
      })

      if (!cancelled) {
        setDownloadOptions(out)
        setResolvingOptions(false)
      }
    }

    buildOptions().catch((err) => {
      console.error('[DownloadButton] buildOptions failed', err)
      if (!cancelled) {
        setDownloadOptions([])
        setResolvingOptions(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [showOptions, sources])

  const handleDownload = async (source: VideoSource) => {
    const label = qualityLabel(source)
    setShowOptions(false)
    setDownloading(label)

    try {
      // Adaptive HLS sources point at the master playlist - downloading that
      // URL would save a text file, not the video. Resolve just-in-time to
      // a concrete variant URL matching the user's preferred quality.
      let downloadUrl = source.url
      let resolvedLabel = label
      if (isAdaptive(source)) {
        const pref = parseQualityPreference(defaultDownloadQuality)
        const resolved = await resolveAdaptiveToVariant(source, pref)
        if (!resolved) {
          throw new Error('Could not resolve a concrete HLS variant for download')
        }
        downloadUrl = resolved.url
        resolvedLabel = `${resolved.resolution}p`
      }

      const safeTitle = animeTitle.replace(/[^a-zA-Z0-9]/g, '_')
      const filename = `${safeTitle}_EP${episodeNumber}_${resolvedLabel}.otaku`
      await startDownload(mediaId, episodeId, episodeNumber, downloadUrl, filename, customDownloadLocation || undefined)

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
  if (!hasAnySource) return null

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
              {resolvingOptions && (
                <div className="px-3 py-4 text-sm text-[var(--color-text-muted)] flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Resolving downloadable variants...
                </div>
              )}
              {!resolvingOptions && downloadOptions.length === 0 && (
                <div className="px-3 py-4 text-sm text-[var(--color-text-muted)]">
                  No downloadable variants available for this episode.
                </div>
              )}
              {downloadOptions.map((source, index) => {
                const label = qualityLabel(source)
                // Default is preferred when:
                //  - setting is 'auto' and source has no concrete resolution (adaptive), OR
                //  - setting matches this source's resolution (e.g. '1080p' === `${resolution}p`).
                const isDefault =
                  defaultDownloadQuality === 'auto'
                    ? (source.resolution === undefined && index === 0) ||
                      (source.resolution !== undefined && index === 0)
                    : label.toLowerCase() === defaultDownloadQuality;

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
                        {label}
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
