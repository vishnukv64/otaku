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
  return (
    <div className="flex items-center gap-4 min-w-[200px]">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-2 bg-[var(--color-surface-subtle)] rounded-lg appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-[var(--color-accent-primary)]
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-moz-range-thumb]:w-4
          [&::-moz-range-thumb]:h-4
          [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-[var(--color-accent-primary)]
          [&::-moz-range-thumb]:border-0
          [&::-moz-range-thumb]:cursor-pointer"
      />
      <span className="text-[var(--color-text-secondary)] text-sm font-medium min-w-[3rem] text-right">
        {formatValue(value)}
      </span>
    </div>
  )
}
