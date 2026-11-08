/**
 * Touch gestures for the phone video player.
 * Pure gesture -> action mapping (tested) plus a thin pointer-event hook.
 */
import { useCallback, useRef } from 'react'

export type TapZone = 'left' | 'center' | 'right'
export type DragKind = 'scrub' | 'brightness' | 'volume' | 'swipe'

export const DOUBLE_TAP_MS = 300
export const SEEK_STEP = 10
const DRAG_SLOP = 10
/** A full-width horizontal drag scrubs this many seconds. */
const SCRUB_SECONDS_PER_WIDTH = 90
/** Vertical travel that commits a middle-strip swipe. */
export const SWIPE_COMMIT = 60

/** Left 30% / centre 40% / right 30%, same split as the reader. */
export function tapZone(x: number, width: number): TapZone {
  const r = width > 0 ? x / width : 0.5
  return r < 0.3 ? 'left' : r > 0.7 ? 'right' : 'center'
}

export type TapAction =
  | { type: 'seek'; delta: number }
  | { type: 'toggleControls' }
  /** First tap of a possible double tap; the caller toggles controls after DOUBLE_TAP_MS. */
  | { type: 'pending' }

/** `last` is the previous tap (zone + timestamp), or null. */
export function resolveTap(
  zone: TapZone,
  now: number,
  last: { zone: TapZone; time: number } | null
): TapAction {
  const isDouble = !!last && last.zone === zone && now - last.time <= DOUBLE_TAP_MS
  if (zone === 'center') return isDouble ? { type: 'toggleControls' } : { type: 'pending' }
  if (isDouble) return { type: 'seek', delta: zone === 'left' ? -SEEK_STEP : SEEK_STEP }
  return { type: 'pending' }
}

/**
 * Axis-locks a drag: horizontal scrubs; vertical is brightness (left half) or volume
 * (right half), or a `swipe` when it starts in the centre strip and swipes are enabled.
 */
export function classifyDrag(
  dx: number,
  dy: number,
  startX: number,
  width: number,
  swipes = false
): DragKind | null {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.max(ax, ay) < DRAG_SLOP) return null
  if (ax > ay) return 'scrub'
  if (swipes && tapZone(startX, width) === 'center') return 'swipe'
  return startX < width / 2 ? 'brightness' : 'volume'
}

/** Middle-strip swipe result on release. */
export function swipeDirection(dy: number): 'up' | 'down' | null {
  return dy <= -SWIPE_COMMIT ? 'up' : dy >= SWIPE_COMMIT ? 'down' : null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Value after a drag: scrub -> seconds, brightness/volume -> 0..1 (swipe up raises). */
export function dragValue(
  kind: DragKind,
  start: number,
  dx: number,
  dy: number,
  size: { width: number; height: number },
  duration = 0
): number {
  if (kind === 'scrub') {
    return clamp(start + (dx / Math.max(size.width, 1)) * SCRUB_SECONDS_PER_WIDTH, 0, duration)
  }
  return clamp(start - dy / Math.max(size.height * 0.8, 1), 0, 1)
}

interface Handlers {
  /** Current values read at drag start. */
  read: () => { time: number; duration: number; volume: number; brightness: number }
  onToggleControls: () => void
  onSeekBy: (delta: number) => void
  onVolume: (v: number) => void
  onBrightness: (v: number) => void
  /** Preview while dragging (time in seconds) and commit on release; null = cancelled. */
  onScrub: (time: number | null, commit: boolean) => void
  /** Centre-strip vertical swipe (portrait: up = episodes, down = mini player). Omit to disable. */
  onSwipe?: (dir: 'up' | 'down') => void
  /** Ignore touches (e.g. controls locked) */
  disabled?: boolean
}

export function usePlayerGestures(h: Handlers) {
  const hRef = useRef(h)
  hRef.current = h
  const lastTap = useRef<{ zone: TapZone; time: number } | null>(null)
  const tapTimer = useRef<number | null>(null)
  const drag = useRef<{
    x: number
    y: number
    kind: DragKind | null
    base: ReturnType<Handlers['read']>
    value: number
  } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (hRef.current.disabled) return
    drag.current = { x: e.clientX, y: e.clientY, kind: null, base: hRef.current.read(), value: 0 }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    d.kind ??= classifyDrag(dx, dy, d.x - rect.left, rect.width, !!hRef.current.onSwipe)
    if (!d.kind) return
    if (d.kind === 'swipe') {
      d.value = dy
      return
    }
    const size = { width: rect.width, height: rect.height }
    const start =
      d.kind === 'scrub' ? d.base.time : d.kind === 'volume' ? d.base.volume : d.base.brightness
    d.value = dragValue(d.kind, start, dx, dy, size, d.base.duration)
    if (d.kind === 'scrub') hRef.current.onScrub(d.value, false)
    else if (d.kind === 'volume') hRef.current.onVolume(d.value)
    else hRef.current.onBrightness(d.value)
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind) {
      if (d.kind === 'scrub') hRef.current.onScrub(d.value, true)
      else if (d.kind === 'swipe') {
        const dir = swipeDirection(d.value)
        if (dir) hRef.current.onSwipe?.(dir)
      }
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const zone = tapZone(e.clientX - rect.left, rect.width)
    const now = Date.now()
    const action = resolveTap(zone, now, lastTap.current)
    if (tapTimer.current) window.clearTimeout(tapTimer.current)
    if (action.type === 'seek') {
      lastTap.current = { zone, time: now } // keep stacking rapid taps
      hRef.current.onSeekBy(action.delta)
    } else if (action.type === 'toggleControls') {
      lastTap.current = null
      hRef.current.onToggleControls()
    } else {
      lastTap.current = { zone, time: now }
      // Side zones: a lone tap toggles controls once the double-tap window has passed.
      tapTimer.current = window.setTimeout(() => {
        lastTap.current = null
        hRef.current.onToggleControls()
      }, DOUBLE_TAP_MS)
    }
  }, [])

  const onPointerCancel = useCallback(() => {
    if (drag.current?.kind === 'scrub') hRef.current.onScrub(null, false)
    drag.current = null
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}
