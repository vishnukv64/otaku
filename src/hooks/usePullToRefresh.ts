import { useEffect, useRef, useState } from 'react'

/** Phone pull-to-refresh: drag down from scrollTop 0 past 70px to call onRefresh. */
export function usePullToRefresh(onRefresh: () => Promise<unknown> | void, enabled: boolean) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)
  const cb = useRef(onRefresh)
  cb.current = onRefresh

  useEffect(() => {
    if (!enabled) return
    const onStart = (e: TouchEvent) => {
      startY.current = window.scrollY <= 0 ? e.touches[0].clientY : null
    }
    const onMove = (e: TouchEvent) => {
      if (startY.current == null) return
      const d = e.touches[0].clientY - startY.current
      pullRef.current = d > 0 ? Math.min(d * 0.5, 90) : 0
      setPull(pullRef.current)
    }
    const onEnd = async () => {
      const fire = pullRef.current >= 70
      startY.current = null
      pullRef.current = 0
      setPull(0)
      if (!fire) return
      setRefreshing(true)
      try {
        await cb.current()
      } finally {
        setRefreshing(false)
      }
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [enabled])

  return { pull, refreshing }
}
