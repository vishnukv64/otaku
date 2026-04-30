import { Compass, Gauge, Target } from 'lucide-react'
import type { ActivityPatterns, CompletionRateStats, TimeToCompletion as TimeToCompletionData } from '@/utils/tauri-commands'

interface CompletionPredictorProps {
  timeToComplete: TimeToCompletionData | null
  completionRate: CompletionRateStats | null
  patterns: ActivityPatterns | null
}

function formatDays(days: number): string {
  if (days <= 1) return '< 1 day'
  if (days >= 30) {
    const months = Math.round(days / 30)
    return `${months} month${months !== 1 ? 's' : ''}`
  }
  return `${Math.round(days)} day${Math.round(days) !== 1 ? 's' : ''}`
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0m/day'
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const remainder = Math.round(minutes % 60)
    return remainder > 0 ? `${hours}h ${remainder}m/day` : `${hours}h/day`
  }
  return `${Math.round(minutes)}m/day`
}

function predictionCopy(avgDays: number | null, completionPct: number | null): string {
  if (avgDays == null || completionPct == null) {
    return 'Complete a few more series to unlock a stronger pace prediction.'
  }

  if (completionPct >= 70) {
    return `You usually follow through — once you start something, you tend to finish it in about ${formatDays(avgDays)}.`
  }

  if (completionPct >= 40) {
    return `You explore a lot before locking in. When a series sticks, you usually finish it in about ${formatDays(avgDays)}.`
  }

  return `You sample widely, so your strongest predictor is taste fit. The series you do finish usually take about ${formatDays(avgDays)}.`
}

function PredictorTile({
  icon,
  label,
  value,
  hint,
  iconColor,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
  iconColor: string
}) {
  return (
    <div className="rounded-xl bg-[var(--color-surface-hover)] p-5 transition-colors hover:bg-[color-mix(in_srgb,var(--color-surface-hover)_82%,white)]">
      <div className="mb-3 flex items-center gap-2">
        <div className={iconColor}>{icon}</div>
        <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
      </div>
      <p className="text-xl font-bold text-[var(--color-text-primary)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{hint}</p>
    </div>
  )
}

export function CompletionPredictor({ timeToComplete, completionRate, patterns }: CompletionPredictorProps) {
  const totalStarted = (completionRate?.anime_started ?? 0) + (completionRate?.manga_started ?? 0)
  const totalCompleted = (completionRate?.anime_completed ?? 0) + (completionRate?.manga_completed ?? 0)
  const completionPct = totalStarted > 0 ? (totalCompleted / totalStarted) * 100 : null
  const avgDays = timeToComplete && timeToComplete.total_completed > 0 ? timeToComplete.avg_days : null
  const monthlyProjection = avgDays && avgDays > 0 ? 30 / avgDays : null

  if (!avgDays && !completionPct && !patterns?.avg_daily_minutes) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3">Completion Predictor</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Finish a few series and build some activity history to unlock prediction insights.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-[var(--color-surface-subtle)] p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Completion Predictor</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          A simple forecast built from your finish rate, completion speed, and daily rhythm.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PredictorTile
          icon={<Target size={18} />}
          label="Finish Rate"
          value={completionPct != null ? `${Math.round(completionPct)}%` : 'Not enough data'}
          hint={
            completionPct != null && totalStarted > 0
              ? `${totalCompleted} finished out of ${totalStarted} started`
              : 'Start and complete more series to measure this'
          }
          iconColor="text-[var(--color-accent-primary)]"
        />

        <PredictorTile
          icon={<Gauge size={18} />}
          label="Typical Pace"
          value={avgDays != null ? formatDays(avgDays) : 'Not enough data'}
          hint={
            monthlyProjection != null
              ? `About ${monthlyProjection.toFixed(monthlyProjection >= 2 ? 1 : 2)} series per month at your usual pace`
              : 'Complete more series to estimate pace'
          }
          iconColor="text-[var(--color-info)]"
        />

        <PredictorTile
          icon={<Compass size={18} />}
          label="Daily Rhythm"
          value={patterns ? formatMinutes(patterns.avg_daily_minutes) : 'Not enough data'}
          hint={
            patterns
              ? `${patterns.most_active_day} is usually your strongest watch/read day`
              : 'Use the app a bit more to map your rhythm'
          }
          iconColor="text-[var(--color-gold)]"
        />
      </div>

      <div className="mt-5 rounded-lg bg-[var(--color-surface-hover)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
        {predictionCopy(avgDays, completionPct)}
      </div>
    </div>
  )
}
