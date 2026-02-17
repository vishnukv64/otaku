import { ReactNode, useEffect, useRef, useState, useCallback } from 'react'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  maxHeight?: string
}

export function BottomSheet({ isOpen, onClose, children, maxHeight = '90vh' }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [closing, setClosing] = useState(false)
  const touchStart = useRef({ y: 0, time: 0 })
  const canDrag = useRef(false)

  const handleClose = useCallback(() => {
    setClosing(true)
    setTimeout(() => {
      setClosing(false)
      setDragY(0)
      onClose()
    }, 200)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, handleClose])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  const handleTouchStart = (e: React.TouchEvent) => {
    const content = contentRef.current
    // Only allow drag when content is scrolled to top
    canDrag.current = !content || content.scrollTop <= 0
    touchStart.current = { y: e.touches[0].clientY, time: Date.now() }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!canDrag.current) return
    const deltaY = e.touches[0].clientY - touchStart.current.y
    if (deltaY > 0) {
      setIsDragging(true)
      setDragY(deltaY)
    }
  }

  const handleTouchEnd = () => {
    if (!isDragging) return
    const elapsed = Date.now() - touchStart.current.time
    const velocity = dragY / elapsed // px/ms

    if (dragY > 150 || velocity > 0.5) {
      handleClose()
    } else {
      setDragY(0)
    }
    setIsDragging(false)
  }

  if (!isOpen && !closing) return null

  return (
    <div className="fixed inset-0 z-[200]">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
          closing ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={handleClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={`absolute bottom-0 left-0 right-0 bg-[var(--color-bg-primary)] rounded-t-2xl shadow-2xl ${
          !isDragging && !closing ? 'animate-bottom-sheet-up' : ''
        } ${closing ? 'animate-bottom-sheet-down' : ''}`}
        style={{
          maxHeight,
          transform: isDragging ? `translateY(${dragY}px)` : undefined,
          transition: isDragging ? 'none' : undefined,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2 cursor-grab">
          <div className="w-10 h-1 rounded-full bg-white/30" />
        </div>

        {/* Content */}
        <div
          ref={contentRef}
          className="overflow-y-auto overscroll-contain"
          style={{
            maxHeight: `calc(${maxHeight} - 24px)`,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
