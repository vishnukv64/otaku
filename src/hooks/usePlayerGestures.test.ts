import { describe, expect, it } from 'vitest'
import { classifyDrag, dragValue, resolveTap, tapZone } from './usePlayerGestures'

describe('usePlayerGestures mapping', () => {
  it('splits zones 30/40/30', () => {
    expect(tapZone(10, 100)).toBe('left')
    expect(tapZone(50, 100)).toBe('center')
    expect(tapZone(90, 100)).toBe('right')
  })

  it('double tap on a side seeks ±10s, single tap is pending', () => {
    expect(resolveTap('left', 1000, null)).toEqual({ type: 'pending' })
    expect(resolveTap('left', 1200, { zone: 'left', time: 1000 })).toEqual({ type: 'seek', delta: -10 })
    expect(resolveTap('right', 1200, { zone: 'right', time: 1000 })).toEqual({ type: 'seek', delta: 10 })
    expect(resolveTap('right', 1200, { zone: 'left', time: 1000 })).toEqual({ type: 'pending' })
    expect(resolveTap('right', 1500, { zone: 'right', time: 1000 })).toEqual({ type: 'pending' })
  })

  it('double tap in the centre toggles controls', () => {
    expect(resolveTap('center', 1100, { zone: 'center', time: 1000 })).toEqual({ type: 'toggleControls' })
  })

  it('axis-locks drags and picks brightness left / volume right', () => {
    expect(classifyDrag(3, 3, 10, 100)).toBeNull()
    expect(classifyDrag(40, 5, 10, 100)).toBe('scrub')
    expect(classifyDrag(2, -40, 10, 100)).toBe('brightness')
    expect(classifyDrag(2, -40, 80, 100)).toBe('volume')
  })

  it('maps drag distance to values, clamped', () => {
    const size = { width: 100, height: 100 }
    expect(dragValue('scrub', 50, 100, 0, size, 1000)).toBe(140)
    expect(dragValue('scrub', 10, -100, 0, size, 1000)).toBe(0)
    expect(dragValue('scrub', 995, 100, 0, size, 1000)).toBe(1000)
    expect(dragValue('volume', 0.5, 0, -40, size)).toBeCloseTo(1)
    expect(dragValue('brightness', 0.5, 0, 100, size)).toBe(0)
  })
})
