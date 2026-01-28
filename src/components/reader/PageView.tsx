/**
 * PageView - Single page display component with lazy loading
 */

import { useState, useEffect, useRef } from 'react'
import { Loader2, ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FitMode } from '@/store/readerStore'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Use proxy for CORS images
  useEffect(() => {
    setLoading(true)
    setError(false)

    // For now, use direct URL - we'll add proxy support if needed
    // In production, might need to use proxyImageRequest for CORS images
    setImageSrc(imageUrl)
  }, [imageUrl])

  const handleLoad = () => {
    setLoading(false)
    onLoad?.()
  }

  const handleError = () => {
    setLoading(false)
    setError(true)
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

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center justify-center w-full h-full overflow-hidden cursor-pointer',
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
