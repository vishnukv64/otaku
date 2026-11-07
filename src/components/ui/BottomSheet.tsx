import { ReactNode, useEffect, useRef, useState, useCallback } from 'react'
import { Check, X } from 'lucide-react'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  maxHeight?: string
  /** Header title (mock: design/files/system.html "Bottom sheet anatomy"). Adds a close button. */
  title?: ReactNode
  /** Sticky actions under the scrolling body, e.g. Cancel / Apply or a destructive confirm. */
  footer?: ReactNode
}

export function BottomSheet({ isOpen, onClose, children, maxHeight = '88vh', title, footer }: BottomSheetProps) {
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
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={`absolute bottom-0 left-0 right-0 flex flex-col bg-[var(--color-panel)] rounded-t-[18px] shadow-[0_-8px_40px_rgba(0,0,0,0.6)] ${
          !isDragging && !closing ? 'animate-bottom-sheet-up' : ''
        } ${closing ? 'animate-bottom-sheet-down' : ''}`}
        style={{
          maxHeight,
          paddingBottom: 'var(--sab)',
          transform: isDragging ? `translateY(${dragY}px)` : undefined,
          transition: isDragging ? 'none' : undefined,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex shrink-0 justify-center pt-2 pb-1.5 cursor-grab">
          <div className="h-[5px] w-[38px] rounded-full bg-white/30" />
        </div>

        {title && (
          <div className="flex shrink-0 items-center justify-between pb-1.5 pl-[18px] pr-2">
            <h3 className="font-display text-lg font-bold text-white">{title}</h3>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white active:bg-[var(--color-glass-bg-hover)]"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Content */}
        <div
          ref={contentRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {children}
        </div>

        {footer && (
          <div className="flex shrink-0 gap-2.5 border-t border-[var(--color-glass-border)] px-4 pt-3 pb-4">{footer}</div>
        )}
      </div>
    </div>
  )
}

/**
 * One selectable row in a sheet (picker options, menus). `checked` marks the current value;
 * `destructive` uses the accent-light text colour the mocks use for destructive actions.
 */
export function SheetOption({
  children,
  onClick,
  icon,
  detail,
  checked,
  destructive,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  icon?: ReactNode
  detail?: ReactNode
  checked?: boolean
  destructive?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? undefined : 'menuitemradio'}
      aria-checked={checked}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[52px] w-full items-center gap-3 border-b border-[var(--color-glass-border)] px-[18px] text-left text-[15px] last:border-b-0 active:bg-[var(--color-glass-bg-hover)] disabled:opacity-40 ${
        destructive
          ? 'text-[var(--color-accent-light)]'
          : checked
            ? 'font-semibold text-white'
            : 'text-[var(--color-text)]'
      }`}
    >
      {checked !== undefined && (
        <Check
          size={20}
          aria-hidden="true"
          className={checked ? 'text-[var(--color-accent-primary)]' : 'text-transparent'}
        />
      )}
      {icon && <span className={destructive ? undefined : 'text-[var(--color-text-secondary)]'}>{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
      {detail && <span className="text-[13.5px] text-[var(--color-text-muted)]">{detail}</span>}
    </button>
  )
}
