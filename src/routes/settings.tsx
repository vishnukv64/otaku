import { createFileRoute } from '@tanstack/react-router'
import { useSettingsStore } from '../store/settingsStore'
import { usePlayerStore } from '../store/playerStore'
import { invoke } from '@tauri-apps/api/core'
import { getVersion, getTauriVersion } from '@tauri-apps/api/app'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { SettingSection } from '../components/settings/SettingSection'
import { SettingRow } from '../components/settings/SettingRow'
import { SettingToggle } from '../components/settings/SettingToggle'
import { SettingSlider } from '../components/settings/SettingSlider'
import { SettingDropdown } from '../components/settings/SettingDropdown'
import { SettingFileInput } from '../components/settings/SettingFileInput'
import { DangerButton } from '../components/settings/DangerButton'
import { UpdateSection } from '../components/settings/UpdateSection'
import { HardDrive, Activity, ChevronRight, FileText, Info } from 'lucide-react'
import { Link } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: SettingsScreen,
})

interface StorageUsage {
  database_size: number
  downloads_size: number
  total_size: number
}

function SettingsScreen() {
  const settings = useSettingsStore()
  const playerSettings = usePlayerStore((state) => state.settings)
  const updatePlayerSettings = usePlayerStore((state) => state.updateSettings)

  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')
  const [tauriVersion, setTauriVersion] = useState<string>('')

  const loadVersionInfo = async () => {
    try {
      const [version, tauri] = await Promise.all([
        getVersion(),
        getTauriVersion(),
      ])
      setAppVersion(version)
      setTauriVersion(tauri)
    } catch (error) {
      console.error('Failed to load version info:', error)
    }
  }

  const loadStorageUsage = async () => {
    try {
      const usage = await invoke<StorageUsage>('get_storage_usage')
      setStorageUsage(usage)
    } catch (error) {
      console.error('Failed to load storage usage:', error)
    }
  }

  // Load storage usage and version info on mount
  useEffect(() => {
    // Defer setState calls to avoid synchronous setState in effect body
    const timeoutId = setTimeout(() => {
      loadStorageUsage()
      loadVersionInfo()
    }, 0)
    return () => clearTimeout(timeoutId)
  }, [])

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  const handleClearWatchHistory = async () => {
    try {
      await invoke('clear_all_watch_history')
      toast.success('Watch history cleared')
      loadStorageUsage()
    } catch (error) {
      toast.error(`Failed to clear watch history: ${error}`)
    }
  }

  const handleClearLibrary = async () => {
    try {
      await invoke('clear_library')
      toast.success('Library cleared')
      loadStorageUsage()
    } catch (error) {
      toast.error(`Failed to clear library: ${error}`)
    }
  }

  const handleClearAllData = async () => {
    try {
      await invoke('clear_all_data')
      toast.success('All data cleared')
      loadStorageUsage()
    } catch (error) {
      toast.error(`Failed to clear data: ${error}`)
    }
  }

  const handleResetSettings = () => {
    settings.resetToDefaults()
    toast.success('Settings reset to defaults')
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)] px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">
            Settings
          </h1>
          <p className="text-[var(--color-text-secondary)] mt-2">
            Customize your Otaku experience
          </p>
        </div>

        {/* General Section */}
        <SettingSection
          title="General"
          description="App-wide preferences and display options"
        >
          <SettingRow
            label="Theme"
            description="Choose your preferred color scheme (Light mode coming soon)"
          >
            <SettingDropdown
              value={settings.theme}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light (Coming Soon)' },
              ]}
              onChange={(value) =>
                settings.updateSettings({ theme: value as 'dark' | 'light' })
              }
            />
          </SettingRow>

          <SettingRow
            label="NSFW Content Filter"
            description="Hide adult content in search and library"
          >
            <SettingToggle
              value={settings.nsfwFilter}
              onChange={(value) => settings.updateSettings({ nsfwFilter: value })}
            />
          </SettingRow>

          <SettingRow
            label="Show Continue Watching"
            description="Display continue watching section on home page"
          >
            <SettingToggle
              value={settings.showContinueWatching}
              onChange={(value) =>
                settings.updateSettings({ showContinueWatching: value })
              }
            />
          </SettingRow>
        </SettingSection>

        {/* Player Section */}
        <SettingSection
          title="Player"
          description="Video playback preferences and behavior"
        >
          <SettingRow
            label="Default Quality"
            description="Preferred video quality for new episodes"
          >
            <SettingDropdown
              value={playerSettings.preferredQuality}
              options={[
                { value: 'Auto', label: 'Auto' },
                { value: '1080p', label: '1080p' },
                { value: '720p', label: '720p' },
                { value: '480p', label: '480p' },
                { value: '360p', label: '360p' },
              ]}
              onChange={(value) =>
                updatePlayerSettings({ preferredQuality: value })
              }
            />
          </SettingRow>

          <SettingRow
            label="Default Playback Speed"
            description="Default video playback speed"
          >
            <SettingDropdown
              value={String(playerSettings.playbackSpeed)}
              options={[
                { value: '0.25', label: '0.25x' },
                { value: '0.5', label: '0.5x' },
                { value: '0.75', label: '0.75x' },
                { value: '1', label: '1x (Normal)' },
                { value: '1.25', label: '1.25x' },
                { value: '1.5', label: '1.5x' },
                { value: '1.75', label: '1.75x' },
                { value: '2', label: '2x' },
              ]}
              onChange={(value) =>
                updatePlayerSettings({ playbackSpeed: parseFloat(value) })
              }
            />
          </SettingRow>

          <SettingRow
            label="Auto-play Next Episode"
            description="Automatically play the next episode when current one finishes"
          >
            <SettingToggle
              value={playerSettings.autoPlayNext}
              onChange={(value) => updatePlayerSettings({ autoPlayNext: value })}
            />
          </SettingRow>

          <SettingRow
            label="Default Volume"
            description="Starting volume for new videos"
          >
            <SettingSlider
              value={settings.defaultVolume * 100}
              min={0}
              max={100}
              step={5}
              onChange={(value) =>
                settings.updateSettings({ defaultVolume: value / 100 })
              }
              formatValue={(v) => `${Math.round(v)}%`}
            />
          </SettingRow>

          <SettingRow
            label="Mark as Watched Threshold"
            description="Mark episode as completed when this percentage is reached"
          >
            <SettingSlider
              value={settings.markWatchedThreshold}
              min={50}
              max={100}
              step={5}
              onChange={(value) =>
                settings.updateSettings({ markWatchedThreshold: value })
              }
              formatValue={(v) => `${v}%`}
            />
          </SettingRow>
        </SettingSection>

        {/* Downloads Section */}
        <SettingSection
          title="Downloads"
          description="Configure download behavior and storage"
        >
          <SettingRow
            label="Download Location"
            description="Custom folder for downloaded episodes"
          >
            <SettingFileInput
              value={settings.downloadLocation}
              onChange={(value) =>
                settings.updateSettings({ downloadLocation: value })
              }
            />
          </SettingRow>

          <SettingRow
            label="Default Download Quality"
            description="Preferred quality for episode downloads"
          >
            <SettingDropdown
              value={settings.defaultDownloadQuality}
              options={[
                { value: 'auto', label: 'Auto (Best Available)' },
                { value: '1080p', label: '1080p' },
                { value: '720p', label: '720p' },
                { value: '480p', label: '480p' },
                { value: '360p', label: '360p' },
              ]}
              onChange={(value) =>
                settings.updateSettings({
                  defaultDownloadQuality: value as 'auto' | '1080p' | '720p' | '480p' | '360p',
                })
              }
            />
          </SettingRow>

          <SettingRow
            label="Max Concurrent Downloads"
            description="Maximum number of simultaneous downloads"
          >
            <SettingSlider
              value={settings.maxConcurrentDownloads}
              min={1}
              max={5}
              step={1}
              onChange={(value) =>
                settings.updateSettings({ maxConcurrentDownloads: value })
              }
              formatValue={(v) => String(v)}
            />
          </SettingRow>

          <SettingRow
            label="Auto-delete Watched Episodes"
            description="Automatically delete episodes after marking as watched"
          >
            <SettingToggle
              value={settings.autoDeleteWatched}
              onChange={(value) =>
                settings.updateSettings({ autoDeleteWatched: value })
              }
            />
          </SettingRow>

          {storageUsage && (
            <SettingRow
              label="Storage Used"
              description="Total space used by app data and downloads"
            >
              <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                <HardDrive size={16} />
                <span className="font-mono text-sm">
                  {formatBytes(storageUsage.total_size)}
                </span>
              </div>
            </SettingRow>
          )}
        </SettingSection>

        {/* Appearance Section */}
        <SettingSection
          title="Appearance"
          description="Customize how content is displayed"
        >
          <SettingRow
            label="Grid Density"
            description="Spacing and size of media cards in library and search"
          >
            <SettingDropdown
              value={settings.gridDensity}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'spacious', label: 'Spacious' },
              ]}
              onChange={(value) =>
                settings.updateSettings({
                  gridDensity: value as 'compact' | 'comfortable' | 'spacious',
                })
              }
            />
          </SettingRow>
        </SettingSection>

        {/* Developer Section */}
        <SettingSection
          title="Developer"
          description="Debugging and diagnostic tools"
        >
          <SettingRow
            label="System Stats"
            description="View real-time CPU, memory, and storage metrics"
          >
            <Link
              to="/stats"
              className="
                flex items-center gap-2
                bg-[var(--color-surface-subtle)]
                hover:bg-[var(--color-surface-hover)]
                text-[var(--color-text-primary)]
                rounded-lg
                px-4
                py-2
                font-medium
                transition-colors
              "
            >
              <Activity size={16} />
              View Stats
              <ChevronRight size={16} className="text-[var(--color-text-tertiary)]" />
            </Link>
          </SettingRow>
          <SettingRow
            label="Application Logs"
            description="View error logs and debug information"
          >
            <Link
              to="/logs"
              className="
                flex items-center gap-2
                bg-[var(--color-surface-subtle)]
                hover:bg-[var(--color-surface-hover)]
                text-[var(--color-text-primary)]
                rounded-lg
                px-4
                py-2
                font-medium
                transition-colors
              "
            >
              <FileText size={16} />
              View Logs
              <ChevronRight size={16} className="text-[var(--color-text-tertiary)]" />
            </Link>
          </SettingRow>
        </SettingSection>

        {/* Data & Privacy Section */}
        <SettingSection
          title="Data & Privacy"
          description="Manage your data and reset settings"
        >
          <SettingRow
            label="Clear Watch History"
            description="Remove all watch progress and continue watching data"
          >
            <DangerButton
              onClick={handleClearWatchHistory}
              label="Clear History"
              confirmMessage="This will remove all watch progress. Continue?"
            />
          </SettingRow>

          <SettingRow
            label="Clear Library"
            description="Remove all saved anime from your library"
          >
            <DangerButton
              onClick={handleClearLibrary}
              label="Clear Library"
              confirmMessage="This will remove all saved anime from your library. Continue?"
            />
          </SettingRow>

          <SettingRow
            label="Clear All Data"
            description="Delete everything including history, library, and media cache"
          >
            <DangerButton
              onClick={handleClearAllData}
              label="Clear All Data"
              confirmMessage="This will delete everything including history, library, and downloads metadata. Downloaded files will NOT be deleted. This cannot be undone. Continue?"
            />
          </SettingRow>

          <SettingRow
            label="Reset Settings"
            description="Restore all settings to default values"
          >
            <button
              onClick={handleResetSettings}
              className="
                bg-[var(--color-surface-subtle)]
                hover:bg-[var(--color-surface-hover)]
                text-[var(--color-text-primary)]
                rounded-lg
                px-4
                py-2
                font-medium
                transition-colors
              "
            >
              Reset to Defaults
            </button>
          </SettingRow>
        </SettingSection>

        {/* Updates Section */}
        <UpdateSection />

        {/* About Section */}
        <SettingSection
          title="About"
          description="Application information and version details"
        >
          <SettingRow
            label="Version"
            description="Current application version"
          >
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <Info size={16} />
              <span className="font-mono text-sm">
                {appVersion ? `v${appVersion}` : 'Loading...'}
              </span>
            </div>
          </SettingRow>

          <SettingRow
            label="Tauri Version"
            description="Underlying Tauri framework version"
          >
            <span className="font-mono text-sm text-[var(--color-text-secondary)]">
              {tauriVersion ? `v${tauriVersion}` : 'Loading...'}
            </span>
          </SettingRow>

        </SettingSection>
      </div>
    </div>
  )
}
