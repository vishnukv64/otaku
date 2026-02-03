import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import {
  Clock,
  FolderOpen,
  Loader2,
  Trash2,
  HardDrive,
  RefreshCw,
  History,
} from 'lucide-react'
import { notifySuccess, notifyError } from '@/utils/notify'
import { SettingSection } from './SettingSection'
import { SettingRow } from './SettingRow'
import { SettingToggle } from './SettingToggle'
import { SettingDropdown } from './SettingDropdown'

interface AutoBackupSettings {
  enabled: boolean
  interval_hours: number
  backup_location: string | null
  max_backups: number
  include_tracker_auth: boolean
  last_backup: string | null
}

interface BackupInfo {
  file_path: string
  file_name: string
  created_at: string
  size_bytes: number
}

interface BackupResult {
  success: boolean
  file_path: string | null
  timestamp: string
  error: string | null
  items_backed_up: {
    library_count: number
    watch_history_count: number
    reading_history_count: number
  }
}

export function AutoBackupSection() {
  const [settings, setSettings] = useState<AutoBackupSettings | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [showBackupList, setShowBackupList] = useState(false)
  const [defaultBackupDir, setDefaultBackupDir] = useState('')

  const loadSettings = async () => {
    try {
      const [config, defaultDir] = await Promise.all([
        invoke<AutoBackupSettings>('get_auto_backup_config'),
        invoke<string>('get_default_backup_directory'),
      ])
      setSettings(config)
      setDefaultBackupDir(defaultDir)
    } catch (error) {
      console.error('Failed to load auto-backup settings:', error)
      notifyError('Error', 'Failed to load auto-backup settings')
    } finally {
      setLoading(false)
    }
  }

  const loadBackups = async () => {
    try {
      const list = await invoke<BackupInfo[]>('list_available_backups')
      setBackups(list)
    } catch (error) {
      console.error('Failed to load backups:', error)
    }
  }

  useEffect(() => {
    loadSettings()
    loadBackups()

    // Listen for backup completion events
    const unlisten = listen<BackupResult>('auto-backup-completed', (event) => {
      notifySuccess(
        'Auto-backup Complete',
        `Backed up ${event.payload.items_backed_up.library_count} library items`
      )
      loadBackups()
      loadSettings() // Refresh last backup time
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const updateSettings = async (updates: Partial<AutoBackupSettings>) => {
    if (!settings) return

    const newSettings = { ...settings, ...updates }
    setSettings(newSettings)
    setSaving(true)

    try {
      await invoke('update_auto_backup_config', { settings: newSettings })
    } catch (error) {
      console.error('Failed to save settings:', error)
      notifyError('Error', 'Failed to save auto-backup settings')
      // Revert on error
      setSettings(settings)
    } finally {
      setSaving(false)
    }
  }

  const handleSelectBackupFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: settings?.backup_location || defaultBackupDir,
      })

      if (selected) {
        updateSettings({ backup_location: selected as string })
      }
    } catch (error) {
      console.error('Failed to select folder:', error)
    }
  }

  const handleBackupNow = async () => {
    setBackingUp(true)

    try {
      const result = await invoke<BackupResult>('trigger_backup_now')

      if (result.success) {
        notifySuccess(
          'Backup Complete',
          `Backed up ${result.items_backed_up.library_count} library items, ${result.items_backed_up.watch_history_count} watch history entries`
        )
        loadBackups()
        loadSettings() // Refresh last backup time
      } else {
        notifyError('Backup Failed', result.error || 'Unknown error')
      }
    } catch (error) {
      notifyError('Backup Failed', `${error}`)
    } finally {
      setBackingUp(false)
    }
  }

  const handleDeleteBackup = async (filePath: string) => {
    try {
      await invoke('delete_backup', { filePath })
      setBackups(backups.filter((b) => b.file_path !== filePath))
      notifySuccess('Deleted', 'Backup file deleted')
    } catch (error) {
      notifyError('Error', `Failed to delete backup: ${error}`)
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return isoString
    }
  }

  const formatRelativeTime = (isoString: string) => {
    try {
      const date = new Date(isoString)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      const diffDays = Math.floor(diffHours / 24)

      if (diffHours < 1) return 'Less than an hour ago'
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
      if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
      return formatDate(isoString)
    } catch {
      return isoString
    }
  }

  if (loading) {
    return (
      <SettingSection title="Auto-Backup" description="Loading settings...">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-[var(--color-text-tertiary)]" size={24} />
        </div>
      </SettingSection>
    )
  }

  if (!settings) {
    return null
  }

  return (
    <SettingSection
      title="Auto-Backup"
      description="Automatically backup your data at regular intervals"
    >
      {/* Enable/Disable */}
      <SettingRow
        label="Enable Auto-Backup"
        description="Automatically create backups of your data"
      >
        <div className="flex items-center gap-2">
          {saving && <Loader2 size={16} className="animate-spin text-[var(--color-text-tertiary)]" />}
          <SettingToggle
            value={settings.enabled}
            onChange={(value) => updateSettings({ enabled: value })}
          />
        </div>
      </SettingRow>

      {settings.enabled && (
        <>
          {/* Backup Interval */}
          <SettingRow
            label="Backup Frequency"
            description="How often to create automatic backups"
          >
            <SettingDropdown
              value={String(settings.interval_hours)}
              options={[
                { value: '6', label: 'Every 6 hours' },
                { value: '12', label: 'Every 12 hours' },
                { value: '24', label: 'Daily' },
                { value: '72', label: 'Every 3 days' },
                { value: '168', label: 'Weekly' },
              ]}
              onChange={(value) => updateSettings({ interval_hours: parseInt(value) })}
            />
          </SettingRow>

          {/* Max Backups */}
          <SettingRow
            label="Keep Backups"
            description="Number of backup files to keep (older ones are deleted)"
          >
            <SettingDropdown
              value={String(settings.max_backups)}
              options={[
                { value: '3', label: '3 backups' },
                { value: '5', label: '5 backups' },
                { value: '7', label: '7 backups' },
                { value: '14', label: '14 backups' },
                { value: '30', label: '30 backups' },
              ]}
              onChange={(value) => updateSettings({ max_backups: parseInt(value) })}
            />
          </SettingRow>

          {/* Backup Location */}
          <SettingRow
            label="Backup Location"
            description={settings.backup_location || defaultBackupDir}
          >
            <button
              onClick={handleSelectBackupFolder}
              className="
                flex items-center gap-2
                px-4 py-2 rounded-lg
                font-medium
                bg-[var(--color-surface-subtle)]
                hover:bg-[var(--color-surface-hover)]
                text-[var(--color-text-primary)]
                transition-colors
              "
            >
              <FolderOpen size={16} />
              Change Folder
            </button>
          </SettingRow>

          {/* Last Backup Info */}
          <SettingRow
            label="Last Backup"
            description={
              settings.last_backup
                ? formatRelativeTime(settings.last_backup)
                : 'No backup yet'
            }
          >
            <button
              onClick={handleBackupNow}
              disabled={backingUp}
              className="
                flex items-center gap-2
                px-4 py-2 rounded-lg
                font-medium
                bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)]
                text-white
                transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              {backingUp ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Backing up...
                </>
              ) : (
                <>
                  <RefreshCw size={16} />
                  Backup Now
                </>
              )}
            </button>
          </SettingRow>

          {/* View Backups */}
          <SettingRow
            label="Backup History"
            description={`${backups.length} backup${backups.length !== 1 ? 's' : ''} available`}
          >
            <button
              onClick={() => setShowBackupList(!showBackupList)}
              className="
                flex items-center gap-2
                px-4 py-2 rounded-lg
                font-medium
                bg-[var(--color-surface-subtle)]
                hover:bg-[var(--color-surface-hover)]
                text-[var(--color-text-primary)]
                transition-colors
              "
            >
              <History size={16} />
              {showBackupList ? 'Hide' : 'View'} Backups
            </button>
          </SettingRow>

          {/* Backup List */}
          {showBackupList && backups.length > 0 && (
            <div className="bg-[var(--color-surface-subtle)] rounded-lg p-3 space-y-2">
              {backups.map((backup) => (
                <div
                  key={backup.file_path}
                  className="
                    flex items-center justify-between
                    p-3 rounded-lg
                    bg-[var(--color-surface)]
                    border border-[var(--color-border)]
                  "
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {backup.file_name}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-[var(--color-text-tertiary)] flex items-center gap-1">
                        <Clock size={12} />
                        {formatDate(backup.created_at)}
                      </span>
                      <span className="text-xs text-[var(--color-text-tertiary)] flex items-center gap-1">
                        <HardDrive size={12} />
                        {formatBytes(backup.size_bytes)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteBackup(backup.file_path)}
                    className="
                      p-2 rounded-lg
                      text-[var(--color-text-tertiary)]
                      hover:text-red-500
                      hover:bg-red-500/10
                      transition-colors
                    "
                    title="Delete backup"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showBackupList && backups.length === 0 && (
            <div className="bg-[var(--color-surface-subtle)] rounded-lg p-6 text-center">
              <p className="text-[var(--color-text-tertiary)]">
                No backups yet. Click "Backup Now" to create your first backup.
              </p>
            </div>
          )}
        </>
      )}
    </SettingSection>
  )
}
