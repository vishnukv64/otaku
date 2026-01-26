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

  if (showConfirm) {
    return (
      <div className="flex flex-col gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
        <div className="flex items-start gap-2 text-sm text-red-400">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{confirmMessage}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className="
              flex-1
              bg-red-600
              hover:bg-red-700
              disabled:opacity-50
              disabled:cursor-not-allowed
              text-white
              rounded-lg
              px-3
              py-1.5
              text-sm
              font-medium
              transition-colors
            "
          >
            {isLoading ? 'Processing...' : 'Confirm'}
          </button>
          <button
            onClick={() => setShowConfirm(false)}
            disabled={isLoading}
            className="
              flex-1
              bg-[var(--color-surface-subtle)]
              hover:bg-[var(--color-surface-hover)]
              disabled:opacity-50
              disabled:cursor-not-allowed
              text-[var(--color-text-primary)]
              rounded-lg
              px-3
              py-1.5
              text-sm
              font-medium
              transition-colors
            "
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      disabled={disabled}
      className="
        bg-red-600
        hover:bg-red-700
        disabled:opacity-50
        disabled:cursor-not-allowed
        text-white
        rounded-lg
        px-4
        py-2
        font-medium
        transition-colors
      "
    >
      {label}
    </button>
  )
}
