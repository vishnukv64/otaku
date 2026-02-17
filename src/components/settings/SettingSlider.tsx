interface SettingSliderProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  formatValue?: (value: number) => string
}

export function SettingSlider({
  value,
  min,
  max,
  step,
  onChange,
  formatValue = (v) => String(v)
}: SettingSliderProps) {
  // Calculate percentage for the filled track
  const percentage = ((value - min) / (max - min)) * 100

  return (
    <div className="flex items-center gap-3 sm:gap-4 min-w-[140px] sm:min-w-[220px]">
      <div className="relative flex-1 h-6 flex items-center">
        {/* Track background */}
        <div className="absolute w-full h-2 bg-[var(--color-bg-tertiary)] rounded-full border border-[var(--color-border-subtle)]" />

        {/* Filled track */}
        <div
          className="absolute h-2 bg-[var(--color-accent-primary)] rounded-full"
          style={{ width: `${percentage}%` }}
        />

        {/* Actual input (transparent, for interaction) */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative w-full h-6 appearance-none bg-transparent cursor-pointer z-10
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-5
            [&::-webkit-slider-thumb]:h-5
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-[var(--color-accent-primary)]
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-white
            [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-110
            [&::-moz-range-thumb]:w-5
            [&::-moz-range-thumb]:h-5
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-[var(--color-accent-primary)]
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-white
            [&::-moz-range-thumb]:shadow-md
            [&::-moz-range-thumb]:cursor-pointer
            [&::-moz-range-track]:bg-transparent
            [&::-webkit-slider-runnable-track]:bg-transparent"
        />
      </div>

      {/* Value display */}
      <span className="text-[var(--color-text-primary)] text-sm font-semibold min-w-[3.5rem] text-right px-2 py-1 bg-[var(--color-surface-subtle)] rounded-md">
        {formatValue(value)}
      </span>
    </div>
  )
}
