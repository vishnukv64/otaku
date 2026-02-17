import type { LucideIcon } from 'lucide-react'

interface FeatureCardProps {
  icon: LucideIcon
  title: string
  description: string
  accentColor: string
  delay: number
  mobile?: boolean
}

export function FeatureCard({
  icon: Icon,
  title,
  description,
  accentColor,
  delay,
  mobile,
}: FeatureCardProps) {
  if (mobile) {
    return (
      <div
        className="animate-onboarding-fade-up rounded-xl bg-[var(--color-bg-secondary)]/50 backdrop-blur-sm border border-white/5 p-3 text-center"
        style={{ animationDelay: `${delay}ms` }}
      >
        <div
          className="w-9 h-9 rounded-lg mx-auto mb-2 flex items-center justify-center"
          style={{ background: `${accentColor}20` }}
        >
          <Icon className="w-4.5 h-4.5" style={{ color: accentColor }} />
        </div>
        <h3 className="text-xs font-semibold text-[var(--color-text-primary)] mb-0.5">
          {title}
        </h3>
        <p className="text-[10px] text-[var(--color-text-secondary)] leading-snug">
          {description}
        </p>
      </div>
    )
  }

  return (
    <div
      className="animate-onboarding-fade-up rounded-xl bg-[var(--color-bg-secondary)]/50 backdrop-blur-sm border border-white/5 p-6 text-center"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
        style={{ background: `${accentColor}20` }}
      >
        <Icon className="w-6 h-6" style={{ color: accentColor }} />
      </div>
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
        {title}
      </h3>
      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
        {description}
      </p>
    </div>
  )
}
