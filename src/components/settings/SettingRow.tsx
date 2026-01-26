interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
}

export function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex-1">
        <div className="text-[var(--color-text-primary)] font-medium">
          {label}
        </div>
        {description && (
          <div className="text-sm text-[var(--color-text-secondary)] mt-0.5">
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
