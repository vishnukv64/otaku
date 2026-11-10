import { HSTREAM_EXTENSION } from '@/extensions/hstream-extension'
import { createAnikotoExtension } from '@/extensions/anikoto-extension'
import { KAA_EXTENSION } from '@/extensions/kaa-extension'
import type { StreamingProviderMode } from '@/store/settingsStore'

const ALL_PROVIDERS: { value: StreamingProviderMode; label: string; extended?: boolean }[] = [
  { value: 'kaa', label: 'KickAssAnime' },
  { value: 'allanime', label: 'AllAnime' },
  { value: 'anikoto', label: 'Anikoto' },
  { value: 'hstream', label: 'hstream.moe', extended: true },
]

/** Providers the picker offers; extended-catalog ones only while that setting is on. */
export function streamingProviders(extendedCatalog: boolean) {
  return ALL_PROVIDERS.filter((p) => extendedCatalog || !p.extended)
}

export function streamingProviderLabel(provider: StreamingProviderMode): string {
  return ALL_PROVIDERS.find((p) => p.value === provider)?.label ?? provider
}

/**
 * Provider to use for this show: with the extended catalog on, restricted titles
 * always stream from hstream (the regular providers carry none of them);
 * everything else uses the user's pick.
 */
export function providerForMedia(
  selected: StreamingProviderMode,
  extendedCatalog: boolean,
  media: { restricted?: boolean } | null | undefined
): StreamingProviderMode {
  return extendedCatalog && media?.restricted === true ? 'hstream' : selected
}

/** Next provider in the list, for the "Try another provider" button. */
export function nextStreamingProvider(
  provider: StreamingProviderMode,
  extendedCatalog: boolean
): StreamingProviderMode {
  const list = streamingProviders(extendedCatalog)
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
