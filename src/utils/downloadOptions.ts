import type { Subtitle, VideoSource } from '@/types/extension'
import { isAdaptive, qualityLabel, type QualityPreference } from './pickSource'
import { downloadVariantUrl, listAdaptiveVariants, resolveAdaptiveToVariant } from './hlsResolve'

export interface DownloadSourceChoice {
  key: string
  source: VideoSource
  audioType?: string
  server: string
  quality: string
  resolution?: number
  subtitles: Subtitle[]
}

export interface DownloadSubtitleChoice {
  key: string
  subtitle?: Subtitle
  label: string
}

export type DownloadAudioTab = 'sub' | 'dub'

export function normalizeAudioType(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'dubbed') return 'dub'
  if (normalized === 'subbed') return 'sub'
  return normalized
}

export function audioTypeLabel(value?: string): string {
  const normalized = normalizeAudioType(value)
  if (normalized === 'dub') return 'DUB'
  if (normalized === 'sub') return 'SUB'
  if (normalized === 'hsub') return 'HSUB'
  return normalized ? normalized.toUpperCase() : 'VIDEO'
}

export function audioTabForChoice(choice: Pick<DownloadSourceChoice, 'audioType'>): DownloadAudioTab {
  return normalizeAudioType(choice.audioType) === 'dub' ? 'dub' : 'sub'
}

export function choicesForAudioTab(
  choices: DownloadSourceChoice[],
  tab: DownloadAudioTab,
): DownloadSourceChoice[] {
  return choices.filter((choice) => audioTabForChoice(choice) === tab)
}

export function subtitleKey(subtitle: Subtitle): string {
  return `${subtitle.label || ''}|${subtitle.language || ''}|${subtitle.url}`.toLowerCase()
}

export function dedupeSubtitles(subtitles: Subtitle[]): Subtitle[] {
  const seen = new Set<string>()
  const out: Subtitle[] = []
  for (const subtitle of subtitles) {
    if (!subtitle.url || /thumbnail/i.test(`${subtitle.label} ${subtitle.url}`)) continue
    const key = subtitleKey(subtitle)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(subtitle)
  }
  return out
}

export function subtitleChoices(subtitles: Subtitle[]): DownloadSubtitleChoice[] {
  return [
    { key: 'off', label: 'Off' },
    ...dedupeSubtitles(subtitles).map((subtitle) => ({
      key: subtitleKey(subtitle),
      subtitle,
      label: subtitle.label || subtitle.language || 'Subtitles',
    })),
  ]
}

export async function buildDownloadSourceChoices(
  sources: VideoSource[],
  fallbackSubtitles: Subtitle[] = [],
): Promise<DownloadSourceChoice[]> {
  const seen = new Set<string>()
  const out: DownloadSourceChoice[] = []

  for (const source of sources) {
    if (!source.url || source.url.trim() === '') continue

    if (isAdaptive(source)) {
      try {
        const variants = await listAdaptiveVariants(source)
        for (const variant of variants) {
          const key = [
            normalizeAudioType(source.audio_type) || '',
            source.server || '',
            variant.resolution,
          ].join('|')
          if (seen.has(key)) continue
          seen.add(key)
          out.push({
            key,
            source: {
              ...source,
              url: downloadVariantUrl(variant),
              resolution: variant.resolution,
              quality: `${variant.resolution}p`,
            },
            audioType: normalizeAudioType(source.audio_type),
            server: source.server || 'Default',
            quality: `${variant.resolution}p`,
            resolution: variant.resolution,
            subtitles: dedupeSubtitles(source.subtitles?.length ? source.subtitles : fallbackSubtitles),
          })
        }
      } catch (err) {
        console.warn('[downloadOptions] failed to expand adaptive variants', err)
      }
      continue
    }

    const quality = qualityLabel(source)
    const key = [
      normalizeAudioType(source.audio_type) || '',
      source.server || '',
      source.resolution ?? quality,
      source.url,
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      key,
      source,
      audioType: normalizeAudioType(source.audio_type),
      server: source.server || 'Default',
      quality,
      resolution: source.resolution,
      subtitles: dedupeSubtitles(source.subtitles?.length ? source.subtitles : fallbackSubtitles),
    })
  }

  return out.sort((a, b) => {
    const audioCmp = audioTypeLabel(a.audioType).localeCompare(audioTypeLabel(b.audioType))
    if (audioCmp !== 0) return audioCmp
    if (a.server !== b.server) return a.server.localeCompare(b.server)
    return (b.resolution ?? 0) - (a.resolution ?? 0)
  })
}

export function findMatchingDownloadChoice(
  choices: DownloadSourceChoice[],
  target: DownloadSourceChoice,
): DownloadSourceChoice | undefined {
  return choices.find((choice) => {
    if (normalizeAudioType(choice.audioType) !== normalizeAudioType(target.audioType)) return false
    if (choice.server !== target.server) return false
    if (typeof target.resolution === 'number') return choice.resolution === target.resolution
    return choice.quality === target.quality
  })
}

export function findMatchingSubtitle(
  subtitles: Subtitle[],
  target?: Subtitle,
): Subtitle | undefined {
  if (!target) return undefined
  const targetLanguage = target.language?.toLowerCase()
  const targetLanguageBase = targetLanguage?.split('-')[0]
  const targetLabel = target.label?.toLowerCase()
  const targetLooksEnglish = targetLanguageBase === 'en' || /english/.test(targetLabel || '')

  return dedupeSubtitles(subtitles).find((subtitle) => {
    const language = subtitle.language?.toLowerCase()
    const languageBase = language?.split('-')[0]
    const label = subtitle.label?.toLowerCase()
    const sameLanguage =
      targetLanguage &&
      language &&
      (language === targetLanguage || languageBase === targetLanguageBase)
    const sameLabel =
      targetLabel &&
      label &&
      (label === targetLabel || label.includes(targetLabel) || targetLabel.includes(label))
    const sameEnglish = targetLooksEnglish && (languageBase === 'en' || /english/.test(label || ''))
    return sameLanguage || sameLabel || sameEnglish || subtitle.url === target.url
  })
}

export async function resolveDownloadUrl(
  source: VideoSource,
  preference: QualityPreference,
): Promise<{ url: string; quality: string; resolution?: number }> {
  if (!isAdaptive(source)) {
    return { url: source.url, quality: qualityLabel(source), resolution: source.resolution }
  }

  const resolved = await resolveAdaptiveToVariant(source, preference)
  if (!resolved) throw new Error('Could not resolve a concrete HLS variant for download')
  return { url: resolved.url, quality: `${resolved.resolution}p`, resolution: resolved.resolution }
}
