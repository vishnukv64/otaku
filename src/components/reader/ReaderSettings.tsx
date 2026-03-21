/**
 * ReaderSettings - Small popover matching read.html mock
 * Positioned fixed top-right (top: 60px, right: 20px)
 * Contains only "Page Fit" chips: Width | Height | Original
 */

import { useEffect, useRef } from 'react'
import { useReaderStore, FitMode } from '@/store/readerStore'
import { cn } from '@/lib/utils'

interface ReaderSettingsProps {
  isOpen: boolean
  onClose: () => void
}

const fitOptions: { value: FitMode; label: string }[] = [
  { value: 'width', label: 'Width' },
  { value: 'height', label: 'Height' },
  { value: 'original', label: 'Original' },
]

export function ReaderSettings({ isOpen, onClose }: ReaderSettingsProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const { settings, setFitMode } = useReaderStore()

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }

    // Delay listener to avoid catching the opening click
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick)
    }, 10)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick)
    }
  }, [isOpen, onClose])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  return (
    <div
      ref={popoverRef}
      className={cn(
        'fixed top-[60px] right-5 z-[250]',
        'bg-[rgba(14,14,14,0.97)] backdrop-blur-[20px]',
        'border border-white/10 rounded-xl',
        'px-4 py-3',
        'min-w-[200px]',
        'shadow-[0_12px_40px_rgba(0,0,0,0.6)]',
        'transition-all duration-200 ease-out',
        isOpen
          ? 'opacity-100 pointer-events-auto translate-y-0'
          : 'opacity-0 pointer-events-none -translate-y-2'
      )}
    >
      {/* Page Fit row */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-white/60 whitespace-nowrap">
          Page Fit
        </span>
        <div className="flex gap-1">
          {fitOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFitMode(opt.value)}
              className={cn(
                'px-2.5 py-1 rounded-[6px]',
                'border text-[0.7rem] font-sans',
                'cursor-pointer transition-all duration-150',
                settings.fitMode === opt.value
                  ? 'bg-[rgba(229,9,20,0.2)] text-[#ff6b6b] border-[rgba(229,9,20,0.3)]'
                  : 'border-white/10 bg-white/[0.05] text-white/50 hover:bg-white/10 hover:text-white'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
