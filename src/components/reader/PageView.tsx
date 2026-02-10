/**
 * PageView - Single page display component with lazy loading
 */

import { useState, useRef } from 'react'
import { Loader2, ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FitMode } from '@/store/readerStore'
import { useProxiedImage } from '@/hooks/useProxiedImage'

interface PageViewProps {
  imageUrl: string
  pageNumber: number
  totalPages: number
  fitMode: FitMode
  zoom: number
  showPageNumber?: boolean
  onLoad?: () => void
  onError?: () => void
  onClick?: (zone: 'left' | 'center' | 'right') => void
  className?: string
}

export function PageView({
  imageUrl,
  pageNumber,
  totalPages,
  fitMode,
  zoom,
  showPageNumber = true,
  onLoad,
  onError,
  onClick,
  className,
}: PageViewProps) {
  // Proxy remote images through the Rust backend (adds required Referer header)
  const proxied = useProxiedImage(imageUrl)

  // Track <img> element load state separately from proxy fetch state
  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevUrlRef = useRef(imageUrl)

  // Reset img load state when URL changes
  if (prevUrlRef.current !== imageUrl) {
    prevUrlRef.current = imageUrl
    setImgLoaded(false)
    setImgError(false)
  }

  // Combined state: loading if proxy is fetching OR img hasn't loaded yet
  const loading = proxied.loading || (!imgLoaded && !imgError && !proxied.error)
  const error = proxied.error || imgError
  const imageSrc = proxied.src

  const handleLoad = () => {
    setImgLoaded(true)
    onLoad?.()
  }

  const handleError = () => {
    setImgError(true)
    onError?.()
  }

  const handleClick = (e: React.MouseEvent) => {
    if (!containerRef.current || !onClick) return

    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const width = rect.width

    // Divide into three zones
    if (x < width * 0.3) {
      onClick('left')
    } else if (x > width * 0.7) {
      onClick('right')
    } else {
      onClick('center')
    }
  }

  const getFitStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      transform: `scale(${zoom})`,
      transformOrigin: 'center',
    }

    switch (fitMode) {
      case 'width':
        return { ...baseStyle, width: '100%', height: 'auto', maxWidth: '100%' }
      case 'height':
        return { ...baseStyle, height: '100%', width: 'auto', maxHeight: '100%' }
      case 'original':
        return { ...baseStyle }
      case 'contain':
      default:
        return { ...baseStyle, maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
    }
  }

  // Check if className contains explicit width/height sizing
  const hasExplicitSizing = className && (
    className.includes('w-[') ||
    className.includes('h-[') ||
    className.includes('max-w-[') ||
    className.includes('max-h-')
  )

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center justify-center cursor-pointer',
        // Only add w-full h-full if no explicit sizing is passed
        !hasExplicitSizing && 'w-full h-full overflow-hidden',
        // For explicit sizing, allow overflow for original mode
        hasExplicitSizing && 'overflow-visible',
        className
      )}
      onClick={handleClick}
    >
      {/* Loading state */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/50 text-muted-foreground">
          <ImageOff className="w-12 h-12 mb-2" />
          <p className="text-sm">Failed to load page</p>
        </div>
      )}

      {/* Image */}
      {imageSrc && !error && (
        <img
          src={imageSrc}
          alt={`Page ${pageNumber}`}
          onLoad={handleLoad}
          onError={handleError}
          style={getFitStyle()}
          className={cn(
            'transition-transform duration-200',
            loading && 'opacity-0'
          )}
          draggable={false}
        />
      )}

      {/* Page number indicator */}
      {showPageNumber && !loading && !error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/70 text-white text-sm rounded-full">
          {pageNumber} / {totalPages}
        </div>
      )}
    </div>
  )
}
