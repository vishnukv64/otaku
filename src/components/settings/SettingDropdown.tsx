import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'

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
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find(opt => opt.value === value)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  return (
    <div ref={dropdownRef} className="relative">
      {/* Dropdown trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="
          flex items-center justify-between gap-2
          bg-[var(--color-surface-subtle)]
          text-[var(--color-text-primary)]
          border border-[var(--color-border)]
          rounded-lg
          px-3
          py-1.5
          min-w-[120px] sm:min-w-[150px]
          cursor-pointer
          hover:bg-[var(--color-surface-hover)]
          focus:outline-none
          focus:ring-2
          focus:ring-[var(--color-accent-primary)]
          focus:ring-opacity-50
          transition-colors
        "
      >
        <span>{selectedOption?.label || 'Select...'}</span>
        <ChevronDown
          size={16}
          className={`text-[var(--color-text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="
          absolute top-full left-0 right-0 mt-1 z-50
          bg-[#1a1a1a]
          border border-[#333]
          rounded-lg
          shadow-lg
          overflow-hidden
        ">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
              className={`
                w-full flex items-center justify-between gap-2
                px-3 py-2
                text-left
                text-white
                hover:bg-[#2a2a2a]
                transition-colors
                ${option.value === value ? 'bg-[#333]' : ''}
              `}
            >
              <span>{option.label}</span>
              {option.value === value && (
                <Check size={16} className="text-[var(--color-accent-primary)]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
