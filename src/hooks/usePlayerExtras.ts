import { useEffect, useState } from 'react'
import { fetchSkipTimes, type SkipInterval } from '@/utils/aniskip'
import { findSpriteCue, parseSpriteVtt, type SpriteCue } from '@/utils/previewVtt'

/** The AniSkip interval containing `currentTime`, if any. */
export function useActiveSkip(
  malId: string | undefined,
  episode: number | undefined,
  duration: number,
  currentTime: number,
): SkipInterval | null {
  const [state, setState] = useState<{ key: string; list: SkipInterval[] }>({ key: '', list: [] })
  const key = `${malId}:${episode}`
  const ready = !!malId && /^\d+$/.test(malId) && episode != null && duration > 0
  useEffect(() => {
    if (!ready) return
    let live = true
    fetchSkipTimes(malId!, episode!, duration).then((list) => live && setState({ key, list }))
    return () => {
      live = false
    }
    // duration only gates the first fetch; the cache ignores it afterwards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, malId, episode])
  if (state.key !== key) return null
  return state.list.find((i) => currentTime >= i.start && currentTime < i.end) ?? null
}

export interface SeekPreview {
  url: string
  x: number
  y: number
  w: number
  h: number
}

/** Returns a lookup from time to a sprite-sheet crop, or null until the VTT loads. */
export function useSeekPreview(
  vttUrl: string | undefined,
  proxy: ((url: string) => string) | null,
): ((t: number) => SeekPreview | null) | null {
  const [loaded, setLoaded] = useState<{ vttUrl: string; cues: SpriteCue[] } | null>(null)
  const canLoad = !!vttUrl && !!proxy
  useEffect(() => {
    if (!canLoad) return
    let live = true
    fetch(proxy!(vttUrl!))
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => live && setLoaded({ vttUrl: vttUrl!, cues: parseSpriteVtt(text, vttUrl!) }))
      .catch(() => {})
    return () => {
      live = false
    }
    // proxy is rebuilt each render; the URL is the identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, vttUrl])
  if (!canLoad || loaded?.vttUrl !== vttUrl || !loaded.cues.length || !proxy) return null
  return (t) => {
    const c = findSpriteCue(loaded.cues, t)
    return c && { url: proxy(c.url), x: c.x, y: c.y, w: c.w, h: c.h }
  }
}
