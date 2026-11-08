/**
 * DownloadButton Component
 *
 * Allows users to download the current episode with quality selection
 */

import { useEffect, useState } from 'react'
import { Download, Check, X, Loader2, Star } from 'lucide-react'
import type { Subtitle, VideoSource } from '@/types/extension'
import { startDownload } from '@/utils/tauri-commands'
import { isDashUrl } from './dashPlayer'
import { useSettingsStore } from '@/store/settingsStore'
import {
  audioTypeLabel,
  buildDownloadSourceChoices,
  choicesForAudioTab,
  subtitleChoices,
  subtitleKey,
  type DownloadAudioTab,
  type DownloadSourceChoice,
} from '@/utils/downloadOptions'

interface DownloadButtonProps {
  sources: VideoSource[]
  mediaId: string
  episodeId: string
  animeTitle: string
  episodeNumber: number
  subtitles?: Subtitle[]
  className?: string
  /** Optional text shown under the icon (phone action tile) */
  label?: string
  /** Episode is already on the device: show it as done instead of offering a download. */
  downloaded?: boolean
}

const EMPTY_SUBTITLES: Subtitle[] = []

export function DownloadButton({
  sources,
  mediaId,
  episodeId,
  animeTitle,
  episodeNumber,
  subtitles = EMPTY_SUBTITLES,
  className = '',
  label,
  downloaded = false,
}: DownloadButtonProps) {
  const defaultDownloadQuality = useSettingsStore((state) => state.defaultDownloadQuality)
  const customDownloadLocation = useSettingsStore((state) => state.downloadLocation)
  const [showOptions, setShowOptions] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [resolvingOptions, setResolvingOptions] = useState(false)
  const [downloadOptions, setDownloadOptions] = useState<DownloadSourceChoice[]>([])
  const [selectedAudioTab, setSelectedAudioTab] = useState<DownloadAudioTab>('sub')
  const [subtitleSelections, setSubtitleSelections] = useState<Record<string, string>>({})
  const hasAnySource = sources.some((s) => s.url && s.url.trim() !== '')

  useEffect(() => {
    if (!showOptions) return
    let cancelled = false

    const buildOptions = async () => {
      setResolvingOptions(true)
      const out = await buildDownloadSourceChoices(sources, subtitles)

      if (!cancelled) {
        setDownloadOptions(out)
        setSelectedAudioTab(choicesForAudioTab(out, 'sub').length > 0 ? 'sub' : 'dub')
        setSubtitleSelections((current) => {
          const next = { ...current }
          for (const choice of out) {
            if (next[choice.key]) continue
            const options = subtitleChoices(choice.subtitles)
            let englishKey: string | undefined
            for (const option of options) {
              const label = option.label.toLowerCase()
              if (option.subtitle && (/english/.test(label) || option.subtitle.language?.toLowerCase() === 'en')) {
                englishKey = option.key
                break
              }
            }
            next[choice.key] = englishKey || 'off'
          }
          return next
        })
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
  }, [showOptions, sources, subtitles])

  const handleDownload = async (choice: DownloadSourceChoice) => {
    const label = `${audioTypeLabel(choice.audioType)} ${choice.quality}`
    setShowOptions(false)
    setDownloading(label)

    try {
      const safeTitle = animeTitle.replace(/[^a-zA-Z0-9]/g, '_')
      const filename = `${safeTitle}_EP${episodeNumber}_${audioTypeLabel(choice.audioType)}_${choice.quality}.otaku`
      const selectedSubtitleKey = subtitleSelections[choice.key] || 'off'
      const selectedSubtitle = choice.subtitles.find((subtitle) => subtitleKey(subtitle) === selectedSubtitleKey)
      await startDownload(
        mediaId,
        episodeId,
        episodeNumber,
        choice.source.url,
        filename,
        customDownloadLocation || undefined,
        choice.source.referrer,
        selectedSubtitle?.url,
        selectedSubtitle?.label,
        selectedSubtitle?.language
      )

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
  const dashOnly = sources.every((s) => !s.url || isDashUrl(s.url))

  const subOptions = choicesForAudioTab(downloadOptions, 'sub')
  const dubOptions = choicesForAudioTab(downloadOptions, 'dub')
  const hasBothAudioTabs = subOptions.length > 0 && dubOptions.length > 0
  const activeAudioTab = choicesForAudioTab(downloadOptions, selectedAudioTab).length > 0
    ? selectedAudioTab
    : subOptions.length > 0 ? 'sub' : 'dub'
  const visibleDownloadOptions = choicesForAudioTab(downloadOptions, activeAudioTab)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowOptions(!showOptions)}
        disabled={!!downloading || dashOnly || downloaded}
        className={`w-10 h-10 flex items-center justify-center hover:bg-white/20 rounded-full transition-colors disabled:cursor-not-allowed ${downloaded ? '' : 'disabled:opacity-50'} ${className}`}
        title={
          downloaded
            ? 'Downloaded'
            : dashOnly
              ? 'Downloads are not available for DASH streams'
              : 'Download Episode'
        }
      >
        {downloading ? (
          <Loader2 size={20} className="animate-spin" />
        ) : completed || downloaded ? (
          <Check size={20} className="text-green-400" />
        ) : (
          <Download size={20} />
        )}
        {label && downloaded ? 'Downloaded' : label}
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
                type="button"
                onClick={() => setShowOptions(false)}
                className="w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-1">
              {!resolvingOptions && hasBothAudioTabs && (
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1 mb-2">
                  {(['sub', 'dub'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setSelectedAudioTab(tab)}
                      aria-pressed={activeAudioTab === tab}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                        activeAudioTab === tab
                          ? 'bg-[var(--color-accent-primary)] text-white'
                          : 'text-[var(--color-text-muted)] hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {tab === 'sub' ? 'Sub' : 'Dub'}
                    </button>
                  ))}
                </div>
              )}
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
              {visibleDownloadOptions.map((choice, index) => {
                const label = choice.quality
                const subtitleOptions = subtitleChoices(choice.subtitles)
                // Default is preferred when:
                //  - setting is 'auto' and source has no concrete resolution (adaptive), OR
                //  - setting matches this source's resolution (e.g. '1080p' === `${resolution}p`).
                const isDefault =
                  defaultDownloadQuality === 'auto'
                    ? index === 0
                    : label.toLowerCase() === defaultDownloadQuality;

                return (
                  <div
                    key={choice.key}
                    className={`w-full text-left px-3 py-2 rounded hover:bg-white/10 transition-colors text-sm flex items-center justify-between group ${
                      isDefault ? 'bg-[var(--color-accent-primary)]/10 border border-[var(--color-accent-primary)]/30' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-2">
                        {audioTypeLabel(choice.audioType)} · {label}
                        {isDefault && (
                          <Star size={12} className="text-[var(--color-accent-primary)]" fill="currentColor" />
                        )}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {choice.server} · {choice.source.type.toUpperCase()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={subtitleSelections[choice.key] || 'off'}
                        onChange={(event) => setSubtitleSelections((current) => ({
                          ...current,
                          [choice.key]: event.target.value,
                        }))}
                        onClick={(event) => event.stopPropagation()}
                        className="max-w-[120px] bg-white/10 border border-white/15 rounded px-2 py-1 text-xs text-white"
                        title="Subtitle track"
                      >
                        {subtitleOptions.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleDownload(choice)}
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/15 transition-colors"
                        title={`Download ${audioTypeLabel(choice.audioType)} ${choice.quality}`}
                      >
                        <Download size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
