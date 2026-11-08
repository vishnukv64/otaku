import { HSTREAM_EXTENSION } from '@/extensions/hstream-extension'
import { createAnikotoExtension } from '@/extensions/anikoto-extension'
import { KAA_EXTENSION } from '@/extensions/kaa-extension'
import type { StreamingProviderMode } from '@/store/settingsStore'

const ALL_PROVIDERS: { value: StreamingProviderMode; label: string; adult?: boolean }[] = [
  { value: 'kaa', label: 'KickAssAnime' },
  { value: 'allanime', label: 'AllAnime' },
  { value: 'anikoto', label: 'Anikoto' },
  { value: 'hstream', label: 'hstream.moe (18+)', adult: true },
]

/** Providers the picker offers; 18+ ones exist only while adultMode is on. */
export function streamingProviders(adultMode: boolean) {
  return ALL_PROVIDERS.filter((p) => adultMode || !p.adult)
}

export function streamingProviderLabel(provider: StreamingProviderMode): string {
  return ALL_PROVIDERS.find((p) => p.value === provider)?.label ?? provider
}

/** Hentai: the genre tag Jikan and AniList both use for explicit titles. */
export function isHentai(media: { genres?: string[] | null } | null | undefined): boolean {
  return !!media?.genres?.some((g) => g.toLowerCase() === 'hentai')
}

/**
 * Provider to use for this show: with 18+ mode on, hentai always streams from hstream
 * (the regular providers carry none of it); everything else uses the user's pick.
 */
export function providerForMedia(
  selected: StreamingProviderMode,
  adultMode: boolean,
  media: { genres?: string[] | null } | null | undefined
): StreamingProviderMode {
  return adultMode && isHentai(media) ? 'hstream' : selected
}

/** Next provider in the list, for the "Try another provider" button. */
export function nextStreamingProvider(
  provider: StreamingProviderMode,
  adultMode: boolean
): StreamingProviderMode {
  const list = streamingProviders(adultMode)
  const i = list.findIndex((p) => p.value === provider)
  return list[(i + 1) % list.length].value
}

interface AnikotoUrls {
  anikotoApiBaseUrl: string
  anikotoSiteBaseUrl: string
  anikotoYotochanBaseUrl: string
}

/**
 * Extension code for providers matched by title search, whose episode ids are
 * "{slug}::{episodeNumber}". AllAnime resolves through the MAL bridge instead,
 * so it returns null.
 */
export function slugProviderExtension(
  provider: StreamingProviderMode,
  urls: AnikotoUrls
): string | null {
  if (provider === 'kaa') return KAA_EXTENSION
  if (provider === 'hstream') return HSTREAM_EXTENSION
  if (provider === 'anikoto') {
    return createAnikotoExtension({
      apiBaseUrl: urls.anikotoApiBaseUrl,
      siteBaseUrl: urls.anikotoSiteBaseUrl,
      yotochanBaseUrl: urls.anikotoYotochanBaseUrl,
    })
  }
  return null
}
