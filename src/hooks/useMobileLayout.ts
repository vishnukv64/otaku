import { useState, useEffect } from 'react'
import { isMobile } from '@/utils/platform'

interface MobileLayout {
  isMobile: boolean
  isPortrait: boolean
  isLandscape: boolean
  viewportWidth: number
  viewportHeight: number
}

export function useMobileLayout(): MobileLayout {
  const [layout, setLayout] = useState<MobileLayout>(() => ({
    isMobile: isMobile(),
    isPortrait: window.innerHeight > window.innerWidth,
    isLandscape: window.innerWidth >= window.innerHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }))

  useEffect(() => {
    const update = () => {
      setLayout({
        isMobile: isMobile(),
        isPortrait: window.innerHeight > window.innerWidth,
        isLandscape: window.innerWidth >= window.innerHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      })
    }

    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return layout
}
