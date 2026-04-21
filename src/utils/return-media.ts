/**
 * Module-level store for pending return media.
 *
 * When the user navigates from a detail modal to /watch or /read,
 * we save the media here so the modal can reopen on back-navigation.
 * Module-level variables persist across route changes in a SPA,
 * making this more reliable than sessionStorage alone.
 */

import type { SearchResult } from '@/types/extension'

export type PendingReturnMedia = SearchResult & {
  _returnExtensionId?: string
}

let _pending: { type: 'anime' | 'manga'; data: PendingReturnMedia } | null = null

export function savePendingReturn(type: 'anime' | 'manga', data: PendingReturnMedia) {
  _pending = { type, data }
  // Also persist to sessionStorage as a page-reload fallback
  try {
    sessionStorage.setItem(`otaku_return_${type}`, JSON.stringify(data))
  } catch { /* quota exceeded or unavailable — module var is enough */ }
}

export function consumePendingReturn(type: 'anime' | 'manga'): PendingReturnMedia | null {
  // Prefer in-memory value (always available within the same page session)
  if (_pending?.type === type) {
    const data = _pending.data
    _pending = null
    sessionStorage.removeItem(`otaku_return_${type}`)
    return data
  }

  // Fallback: check sessionStorage (survives page reload in Tauri)
  try {
    const saved = sessionStorage.getItem(`otaku_return_${type}`)
    if (saved) {
      sessionStorage.removeItem(`otaku_return_${type}`)
      return JSON.parse(saved)
    }
  } catch { /* ignore */ }

  return null
}
