import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen } from 'lucide-react'

interface SettingFileInputProps {
  value: string
  onChange: (value: string) => void
  buttonText?: string
}

export function SettingFileInput({
  value,
  onChange,
  buttonText = 'Browse'
}: SettingFileInputProps) {
  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Download Location',
      })

      if (selected && typeof selected === 'string') {
        onChange(selected)
      }
    } catch (error) {
      console.error('Failed to open folder picker:', error)
    }
  }

  return (
    <div className="flex items-center gap-2 min-w-[300px]">
      <input
        type="text"
        value={value || 'Default location'}
        readOnly
        placeholder="Default location"
        className="
          flex-1
          bg-[var(--color-surface-subtle)]
          text-[var(--color-text-secondary)]
          border border-[var(--color-border)]
          rounded-lg
          px-3
          py-1.5
          text-sm
          cursor-default
        "
      />
      <button
        onClick={handleBrowse}
        className="
          flex items-center gap-2
          bg-[var(--color-accent-primary)]
          hover:bg-[var(--color-accent-hover)]
          text-white
          rounded-lg
          px-3
          py-1.5
          font-medium
          transition-colors
        "
      >
        <FolderOpen size={16} />
        {buttonText}
      </button>
    </div>
  )
}
