import { useState } from 'react'
import { ArrowLeft, Shield, Download, LayoutGrid } from 'lucide-react'
import { StepIndicator } from './StepIndicator'
import { SettingToggle } from '@/components/settings/SettingToggle'
import { SettingDropdown } from '@/components/settings/SettingDropdown'
import { useSettingsStore } from '@/store/settingsStore'
import { isMobile } from '@/utils/platform'

const qualityOptions = [
  { value: 'auto', label: 'Auto (Recommended)' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
  { value: '360p', label: '360p' },
]

const gridOptions: Array<{
  value: 'compact' | 'comfortable' | 'spacious'
  label: string
  cols: number
}> = [
  { value: 'compact', label: 'Compact', cols: 5 },
  { value: 'comfortable', label: 'Comfortable', cols: 4 },
  { value: 'spacious', label: 'Spacious', cols: 3 },
]

interface StepConfig {
  id: string
  icon: typeof Shield
  iconColor: string
  title: string
  description: string
}

const allSteps: StepConfig[] = [
  {
    id: 'nsfw',
    icon: Shield,
    iconColor: '#e50914',
    title: 'Content Filter',
    description: 'Enable to show adult content in search results and recommendations.',
  },
  {
    id: 'quality',
    icon: Download,
    iconColor: '#e50914',
    title: 'Download Quality',
    description: 'Choose the default quality for downloaded episodes.',
  },
  {
    id: 'grid',
    icon: LayoutGrid,
    iconColor: '#e50914',
    title: 'Grid Density',
    description: 'Choose how many items to show per row in your library.',
  },
]

interface SetupWizardProps {
  onComplete: () => void
  onBack: () => void
}

export function SetupWizard({ onComplete, onBack }: SetupWizardProps) {
  const mobile = isMobile()
  // Skip download quality step on mobile
  const steps = mobile ? allSteps.filter((s) => s.id !== 'quality') : allSteps

  const [currentStep, setCurrentStep] = useState(0)
  const nsfwFilter = useSettingsStore((s) => s.nsfwFilter)
  const downloadQuality = useSettingsStore((s) => s.defaultDownloadQuality)
  const gridDensity = useSettingsStore((s) => s.gridDensity)

  const step = steps[currentStep]
  const isLast = currentStep === steps.length - 1

  const handleNext = () => {
    if (isLast) {
      onComplete()
    } else {
      setCurrentStep((s) => s + 1)
    }
  }

  const handleBack = () => {
    if (currentStep === 0) {
      onBack()
    } else {
      setCurrentStep((s) => s - 1)
    }
  }

  return (
    <div
      className={`min-h-screen flex flex-col ${
        mobile ? 'px-6 pt-[calc(12px+var(--sat))] pb-[calc(24px+var(--sab))]' : 'px-8'
      }`}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between py-4">
        <button
          onClick={handleBack}
          className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={onComplete}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          Skip
        </button>
      </div>

      {/* Step content — centered */}
      <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full">
        {/* Step icon */}
        <div
          className="animate-onboarding-fade-up w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
          key={step.id}
          style={{
            background: `${step.iconColor}20`,
            animationDelay: '0ms',
          }}
        >
          <step.icon className="w-8 h-8" style={{ color: step.iconColor }} />
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2 text-center">
          {step.title}
        </h2>

        {/* Description */}
        <p className="text-sm text-[var(--color-text-secondary)] text-center mb-8 max-w-xs">
          {step.description}
        </p>

        {/* Control widget per step */}
        <div className="w-full flex justify-center mb-10">
          {step.id === 'nsfw' && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-[var(--color-text-secondary)]">
                {nsfwFilter ? 'Enabled' : 'Disabled'}
              </span>
              <SettingToggle
                value={nsfwFilter}
                onChange={(v) =>
                  useSettingsStore.getState().updateSettings({ nsfwFilter: v })
                }
              />
            </div>
          )}

          {step.id === 'quality' && (
            <SettingDropdown
              value={downloadQuality}
              options={qualityOptions}
              onChange={(v) =>
                useSettingsStore
                  .getState()
                  .updateSettings({
                    defaultDownloadQuality: v as SettingsStore['defaultDownloadQuality'],
                  })
              }
            />
          )}

          {step.id === 'grid' && (
            <div className="flex gap-3">
              {gridOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    useSettingsStore
                      .getState()
                      .updateSettings({ gridDensity: opt.value })
                  }
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                    gridDensity === opt.value
                      ? 'border-[#e50914] bg-[#e50914]/10'
                      : 'border-white/10 bg-[var(--color-bg-secondary)]/50 hover:border-white/20'
                  }`}
                >
                  {/* Mini grid preview */}
                  <div
                    className="grid gap-1"
                    style={{
                      gridTemplateColumns: `repeat(${opt.cols}, 1fr)`,
                      width: '48px',
                    }}
                  >
                    {Array.from({ length: opt.cols * 2 }, (_, i) => (
                      <div
                        key={i}
                        className={`aspect-[2/3] rounded-sm ${
                          gridDensity === opt.value
                            ? 'bg-[#e50914]/40'
                            : 'bg-white/10'
                        }`}
                      />
                    ))}
                  </div>
                  <span
                    className={`text-xs ${
                      gridDensity === opt.value
                        ? 'text-[#e50914] font-medium'
                        : 'text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Step indicator dots */}
        <div className="mb-8">
          <StepIndicator totalSteps={steps.length} currentStep={currentStep} />
        </div>

        {/* Next / Finish button */}
        <button
          onClick={handleNext}
          className="px-8 py-3 rounded-xl bg-[#e50914] text-white font-semibold text-base hover:bg-[#ff1a25] transition-all active:scale-95"
        >
          {isLast ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  )
}

// Type helper to avoid importing the full store type
type SettingsStore = ReturnType<typeof useSettingsStore.getState>
