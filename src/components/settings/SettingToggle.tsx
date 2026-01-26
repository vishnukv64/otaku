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
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${value ? 'bg-[var(--color-accent-primary)]' : 'bg-[var(--color-surface-subtle)]'}
      `}
      aria-checked={value}
      role="switch"
    >
      <span
        className={`
          inline-block h-4 w-4 transform rounded-full bg-white transition-transform
          ${value ? 'translate-x-6' : 'translate-x-1'}
        `}
      />
    </button>
  )
}
