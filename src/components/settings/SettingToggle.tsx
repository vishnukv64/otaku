interface SettingToggleProps {
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

export function SettingToggle({ value, onChange, disabled }: SettingToggleProps) {
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={`
        relative inline-flex h-6 w-11 max-sm:h-[31px] max-sm:w-[51px] items-center rounded-full transition-colors
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${value ? 'bg-[var(--color-accent-primary)]' : 'bg-white/20'}
      `}
      aria-checked={value}
      role="switch"
    >
      <span
        className={`
          inline-block h-4 w-4 max-sm:h-[27px] max-sm:w-[27px] transform rounded-full bg-white transition-transform
          ${value ? 'translate-x-6 max-sm:translate-x-[22px]' : 'translate-x-1 max-sm:translate-x-[2px]'}
        `}
      />
    </button>
  )
}
