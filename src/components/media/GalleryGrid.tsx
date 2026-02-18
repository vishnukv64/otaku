import { useState, useCallback, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { JikanPicture } from '@/utils/tauri-commands'

interface GalleryGridProps {
  pictures: JikanPicture[]
  loading?: boolean
}

function getPictureUrl(pic: JikanPicture): string | undefined {
  return pic.webp?.large_image_url || pic.webp?.image_url
    || pic.jpg?.large_image_url || pic.jpg?.image_url
    || undefined
}

function getThumbUrl(pic: JikanPicture): string | undefined {
  return pic.webp?.image_url || pic.webp?.small_image_url
    || pic.jpg?.image_url || pic.jpg?.small_image_url
    || undefined
}

export function GalleryGrid({ pictures, loading }: GalleryGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const openLightbox = (index: number) => setLightboxIndex(index)
  const closeLightbox = () => setLightboxIndex(null)

  const goNext = useCallback(() => {
    if (lightboxIndex != null) {
      setLightboxIndex((lightboxIndex + 1) % pictures.length)
    }
  }, [lightboxIndex, pictures.length])

  const goPrev = useCallback(() => {
    if (lightboxIndex != null) {
      setLightboxIndex((lightboxIndex - 1 + pictures.length) % pictures.length)
    }
  }, [lightboxIndex, pictures.length])

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex == null) return

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox()
      else if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
    }

    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [lightboxIndex, goNext, goPrev])

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] bg-[var(--color-bg-hover)] rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (pictures.length === 0) {
    return (
      <p className="text-center py-8 text-[var(--color-text-secondary)]">
        No pictures available
      </p>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
        {pictures.map((pic, idx) => {
          const thumbUrl = getThumbUrl(pic)
          if (!thumbUrl) return null
          return (
            <button
              key={idx}
              onClick={() => openLightbox(idx)}
              className="aspect-[3/4] rounded-lg overflow-hidden bg-[var(--color-bg-secondary)] hover:opacity-80 transition-opacity cursor-pointer"
            >
              <img
                src={thumbUrl}
                alt={`Picture ${idx + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          )
        })}
      </div>

      {/* Lightbox */}
      {lightboxIndex != null && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
          onClick={closeLightbox}
        >
          {/* Close button */}
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10 p-2"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Counter */}
          <div className="absolute top-4 left-4 text-white/60 text-sm z-10">
            {lightboxIndex + 1} / {pictures.length}
          </div>

          {/* Previous */}
          {pictures.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); goPrev() }}
              className="absolute left-2 sm:left-4 text-white/60 hover:text-white z-10 p-2"
            >
              <ChevronLeft className="w-8 h-8" />
            </button>
          )}

          {/* Image */}
          <img
            src={getPictureUrl(pictures[lightboxIndex]) || ''}
            alt={`Picture ${lightboxIndex + 1}`}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Next */}
          {pictures.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); goNext() }}
              className="absolute right-2 sm:right-4 text-white/60 hover:text-white z-10 p-2"
            >
              <ChevronRight className="w-8 h-8" />
            </button>
          )}
        </div>
      )}
    </>
  )
}
