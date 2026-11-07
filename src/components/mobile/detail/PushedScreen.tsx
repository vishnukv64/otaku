import { ReactNode, useEffect } from 'react'
import { ChevronLeft, MoreHorizontal, Share2 } from 'lucide-react'

interface PushedScreenProps {
  onClose: () => void
  /** Text passed to the native share sheet; the button is hidden when unsupported. */
  shareTitle?: string
  /** Optional ⋯ button; opens the caller's menu sheet. */
  onMenu?: () => void
  children: ReactNode
}

/** Phone detail screen: fixed full-screen layer over the tab bar with back + share over the key art. */
export function PushedScreen({ onClose, shareTitle, onMenu, children }: PushedScreenProps) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const canShare = !!shareTitle && typeof navigator !== 'undefined' && 'share' in navigator
  const btn =
    'pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur active:bg-black/75'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={shareTitle}
      className="fixed inset-0 z-[200] overflow-y-auto bg-[var(--color-bg-primary)] animate-in slide-in-from-right duration-200"
      style={{ paddingBottom: 'var(--sab)' }}
    >
      <div
        className="pointer-events-none sticky top-0 z-30 flex h-0 items-start justify-between px-2"
        style={{ paddingTop: 'calc(var(--sat) + 8px)' }}
      >
        <button type="button" onClick={onClose} aria-label="Back" className={btn}>
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className="flex gap-2">
          {canShare && (
            <button
              type="button"
              aria-label="Share"
              className={btn}
              onClick={() => navigator.share({ title: shareTitle }).catch(() => {})}
            >
              <Share2 size={18} aria-hidden="true" />
            </button>
          )}
          {onMenu && (
            <button type="button" aria-label="More" className={btn} onClick={onMenu}>
              <MoreHorizontal size={20} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}
