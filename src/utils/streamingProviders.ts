import { createAnikotoExtension } from '@/extensions/anikoto-extension'
import { KAA_EXTENSION } from '@/extensions/kaa-extension'
import type { StreamingProviderMode } from '@/store/settingsStore'

export const STREAMING_PROVIDERS: { value: StreamingProviderMode; label: string }[] = [
  { value: 'kaa', label: 'KickAssAnime' },
  { value: 'allanime', label: 'AllAnime' },
  { value: 'anikoto', label: 'Anikoto' },
]

export function streamingProviderLabel(provider: StreamingProviderMode): string {
  return STREAMING_PROVIDERS.find((p) => p.value === provider)?.label ?? provider
}

/** Next provider in the list, for the "Try another provider" button. */
export function nextStreamingProvider(provider: StreamingProviderMode): StreamingProviderMode {
  const i = STREAMING_PROVIDERS.findIndex((p) => p.value === provider)
  return STREAMING_PROVIDERS[(i + 1) % STREAMING_PROVIDERS.length].value
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
  if (provider === 'anikoto') {
    return createAnikotoExtension({
      apiBaseUrl: urls.anikotoApiBaseUrl,
      siteBaseUrl: urls.anikotoSiteBaseUrl,
      yotochanBaseUrl: urls.anikotoYotochanBaseUrl,
    })
  }
  return null
}
