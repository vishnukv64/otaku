import { isMobile } from '@/utils/platform'

interface SettingSectionProps {
  title: string
  description?: string
  children: React.ReactNode
}

export function SettingSection({ title, description, children }: SettingSectionProps) {
  if (isMobile()) {
    // iOS grouped list: caption above, rows divided inside one rounded group
    return (
      <section className="mb-5">
        <h3 className="px-4 pb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {title}
          {description && <span className="ml-1.5 font-normal normal-case tracking-normal">· {description}</span>}
        </h3>
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)] [&>*+*]:border-t [&>*+*]:border-[var(--color-glass-border)]">
          {children}
        </div>
      </section>
    )
  }
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
