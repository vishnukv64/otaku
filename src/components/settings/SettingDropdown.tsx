interface Option {
  value: string
  label: string
}

interface SettingDropdownProps {
  value: string
  options: Option[]
  onChange: (value: string) => void
}

export function SettingDropdown({ value, options, onChange }: SettingDropdownProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="
        bg-[var(--color-surface-subtle)]
        text-[var(--color-text-primary)]
        border border-[var(--color-border)]
        rounded-lg
        px-3
        py-1.5
        min-w-[150px]
        cursor-pointer
        hover:bg-[var(--color-surface-hover)]
        focus:outline-none
        focus:ring-2
        focus:ring-[var(--color-accent-primary)]
        focus:ring-opacity-50
      "
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
