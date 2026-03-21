interface SettingSectionProps {
  title: string
  description?: string
  children: React.ReactNode
}

export function SettingSection({ title, description, children }: SettingSectionProps) {
  return (
    <div className="mb-8">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] border-l-[3px] border-[var(--color-accent-primary)] pl-3">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {description}
          </p>
        )}
      </div>
      <div className="space-y-4 bg-[var(--color-surface-elevated)] rounded-lg p-4">
        {children}
      </div>
    </div>
  )
}
