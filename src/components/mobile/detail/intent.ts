/**
 * One-shot "open the detail screen like this" request, set by an entry point (e.g. the poster
 * quick-actions "Download episodes") right before it opens the detail. MobileAnimeDetail takes
 * it on open for the matching media. A module-level slot avoids threading a prop through every
 * screen that can open a detail.
 */
export interface DetailIntent {
  mediaId: string
  /** Open on the Episodes tab in Select mode, ready to download. */
  selectEpisodes: boolean
}

let pending: DetailIntent | null = null

export function requestDetailIntent(intent: DetailIntent): void {
  pending = intent
}

/** Returns and clears the intent if it targets this media. */
export function takeDetailIntent(mediaId: string): DetailIntent | null {
  if (!pending || pending.mediaId !== mediaId) return null
  const intent = pending
  pending = null
  return intent
}
