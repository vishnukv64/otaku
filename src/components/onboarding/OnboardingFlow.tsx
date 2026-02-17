import { useState } from 'react'
import { WelcomePage } from './WelcomePage'
import { SetupWizard } from './SetupWizard'

type Phase = 'welcome' | 'setup'

interface OnboardingFlowProps {
  onComplete: () => void
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [phase, setPhase] = useState<Phase>('welcome')

  return (
    <div className="fixed inset-0 z-[9999] bg-[var(--color-bg-primary)]">
      {phase === 'welcome' ? (
        <WelcomePage onGetStarted={() => setPhase('setup')} />
      ) : (
        <SetupWizard
          onComplete={onComplete}
          onBack={() => setPhase('welcome')}
        />
      )}
    </div>
  )
}
