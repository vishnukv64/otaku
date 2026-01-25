/**
 * Toast Notification Component
 *
 * Simple toast notifications for download status updates
 */

import { useEffect, useState } from 'react'
import { X, CheckCircle, XCircle, AlertCircle } from 'lucide-react'

export interface ToastProps {
  id: string
  type: 'success' | 'error' | 'info'
  title: string
  message?: string
  duration?: number
  onClose: (id: string) => void
}

export function Toast({ id, type, title, message, duration = 4000, onClose }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true)
      setTimeout(() => onClose(id), 300)
    }, duration)

    return () => clearTimeout(timer)
  }, [id, duration, onClose])

  const icons = {
    success: <CheckCircle size={20} className="text-green-400" />,
    error: <XCircle size={20} className="text-red-400" />,
    info: <AlertCircle size={20} className="text-blue-400" />,
  }

  const bgColors = {
    success: 'bg-green-500/10 border-green-500/30',
    error: 'bg-red-500/10 border-red-500/30',
    info: 'bg-blue-500/10 border-blue-500/30',
  }

  return (
    <div
      className={`
        ${bgColors[type]}
        backdrop-blur-md rounded-lg p-4 shadow-2xl border
        transition-all duration-300 min-w-[320px] max-w-md
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
      `}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 pt-0.5">{icons[type]}</div>

        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm mb-0.5">{title}</h4>
          {message && (
            <p className="text-xs text-[var(--color-text-secondary)]">{message}</p>
          )}
        </div>

        <button
          onClick={() => {
            setIsExiting(true)
            setTimeout(() => onClose(id), 300)
          }}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

export function ToastContainer({ toasts }: { toasts: ToastProps[] }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast {...toast} />
        </div>
      ))}
    </div>
  )
}
