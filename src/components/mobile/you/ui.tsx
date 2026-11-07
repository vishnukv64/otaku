/**
 * Small phone-only building blocks shared by the You-hub screens
 * (library, history, stats, downloads, notifications, settings, logs, onboarding).
 */
import { ReactNode, useRef } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T
  options: { id: T; label: ReactNode }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={`flex gap-1 rounded-[var(--radius-lg)] border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)] p-1 ${className}`}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3 text-sm font-medium ${
            value === o.id
              ? 'bg-[var(--color-accent-primary)] text-white'
              : 'text-[var(--color-text-secondary)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Horizontally scrolling chip row (status tabs, filters). */
export function ChipRow<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: ReactNode; count?: number }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap ${
            value === o.id
              ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)] text-white'
              : 'border-[var(--color-glass-border)] bg-[var(--color-glass-bg)] text-[var(--color-text-secondary)]'
          }`}
        >
          {o.label}
          {!!o.count && <span className="text-xs opacity-80">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 py-20 text-[var(--color-text-secondary)]">
      <Loader2 className="h-9 w-9 animate-spin text-[var(--color-accent-primary)]" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode
  title: string
  text?: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      {icon && <div className="mb-4 text-[var(--color-text-muted)]">{icon}</div>}
      <h2 className="mb-2 font-display text-xl font-semibold text-white">{title}</h2>
      {text && <p className="max-w-xs text-sm text-[var(--color-text-secondary)]">{text}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-5 min-h-[44px] rounded-full bg-[var(--color-accent-primary)] px-6 text-sm font-semibold text-white"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertCircle size={44} className="text-[var(--color-accent-primary)]" aria-hidden="true" />}
      title="Error"
      text={message}
      action={onRetry ? { label: 'Retry', onClick: onRetry } : undefined}
    />
  )
}

/** Destructive confirm in a sheet: red primary, Cancel beside it. */
export function ConfirmSheet({
  isOpen,
  onClose,
  title,
  text,
  confirmLabel,
  onConfirm,
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  text?: ReactNode
  confirmLabel: string
  onConfirm: () => void
}) {
  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] flex-1 rounded-[var(--radius-lg)] border border-[var(--color-glass-border)] text-[15px] font-semibold text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className="min-h-[48px] flex-[1.4] rounded-[var(--radius-lg)] bg-[var(--color-accent-primary)] text-[15px] font-semibold text-white"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {text && <p className="px-[18px] pb-4 text-[14.5px] text-[var(--color-text-secondary)]">{text}</p>}
    </BottomSheet>
  )
}

/** Long-press (500ms) detector; a long press suppresses the click that follows it. */
export function useLongPress(onLong: () => void) {
  const timer = useRef<number>()
  const fired = useRef(false)
  const cancel = () => window.clearTimeout(timer.current)
  return {
    onTouchStart: () => {
      fired.current = false
      timer.current = window.setTimeout(() => {
        fired.current = true
        onLong()
      }, 500)
    },
    onTouchMove: cancel,
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.stopPropagation()
        e.preventDefault()
        fired.current = false
      }
    },
  }
}

/** iOS grouped-list container + row used by Settings and sheets. */
export function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  return (
    <section className="mb-5">
      {title && (
        <h3 className="px-4 pb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
      )}
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)]">
        {children}
      </div>
      {footer && <p className="px-4 pt-1.5 text-xs text-[var(--color-text-muted)]">{footer}</p>}
    </section>
  )
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const i = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][i]}`
}
