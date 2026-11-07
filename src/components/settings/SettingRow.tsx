import { isMobile } from '@/utils/platform'

interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
  /** Phone only: greys the row and shows this reason instead of the description. */
  disabledReason?: string
}

export function SettingRow({ label, description, children, disabledReason }: SettingRowProps) {
  if (isMobile()) {
    return (
      <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 min-h-[52px] ${disabledReason ? 'opacity-50 [&_*]:pointer-events-none' : ''}`}>
        <div className="min-w-0 flex-1 basis-40">
          <div className="text-[15px] font-medium text-[var(--color-text-primary)]">{label}</div>
          {(disabledReason || description) && (
            <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{disabledReason ?? description}</div>
          )}
        </div>
        {/* Sliders and text fields take the full row under the label; toggles and pickers sit trailing */}
        <div className="shrink-0 [&:has(input[type=range])]:w-full [&:has(input[type=url])]:w-full [&:has(input[type=url])]:shrink">
          {children}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3 py-2 min-h-[44px]">
      <div className="flex-1 min-w-0">
        <div className="text-[var(--color-text-primary)] font-medium text-sm sm:text-base">
          {label}
        </div>
        {description && (
          <div className="text-xs sm:text-sm text-[var(--color-text-secondary)] mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="flex-shrink-0">
        {children}
      </div>
    </div>
  )
}
