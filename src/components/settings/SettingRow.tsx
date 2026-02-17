interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
}

export function SettingRow({ label, description, children }: SettingRowProps) {
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
