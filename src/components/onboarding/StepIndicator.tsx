interface StepIndicatorProps {
  totalSteps: number
  currentStep: number
}

export function StepIndicator({ totalSteps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Setup progress">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-300 ${
            i === currentStep
              ? 'w-2.5 h-2.5 bg-[#e50914]'
              : i < currentStep
                ? 'w-2 h-2 bg-[#e50914]/60'
                : 'w-2 h-2 bg-white/20'
          }`}
          aria-current={i === currentStep ? 'step' : undefined}
        />
      ))}
    </div>
  )
}
