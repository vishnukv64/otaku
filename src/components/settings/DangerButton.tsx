import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface DangerButtonProps {
  onClick: () => void | Promise<void>
  label: string
  confirmMessage: string
  disabled?: boolean
}

export function DangerButton({ onClick, label, confirmMessage, disabled }: DangerButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleConfirm = async () => {
    setIsLoading(true)
    try {
      await onClick()
      setShowConfirm(false)
    } catch (error) {
      console.error('Action failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowConfirm(true)}
        disabled={disabled || showConfirm}
        className="
          bg-red-600
          hover:bg-red-700
          disabled:opacity-50
          disabled:cursor-not-allowed
          text-white
          rounded-lg
          px-3 sm:px-4
          py-1.5 sm:py-2
          text-xs sm:text-sm
          font-medium
          transition-colors
          whitespace-nowrap
        "
      >
        {label}
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowConfirm(false)}>
          <div className="bg-[var(--color-bg-primary)] border border-red-500/30 rounded-xl p-4 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2 text-sm text-red-400 mb-4">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
              <span>{confirmMessage}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleConfirm}
                disabled={isLoading}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                {isLoading ? 'Processing...' : 'Confirm'}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                disabled={isLoading}
                className="flex-1 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
