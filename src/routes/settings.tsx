import { createFileRoute } from '@tanstack/react-router'
import { useSettingsStore } from '../store/settingsStore'
import { usePlayerStore } from '../store/playerStore'
import { invoke } from '@tauri-apps/api/core'
import { getVersion, getTauriVersion } from '@tauri-apps/api/app'
import { useEffect, useState } from 'react'
import { notifySuccess, notifyError } from '@/utils/notify'
import { SettingSection } from '../components/settings/SettingSection'
import { SettingRow } from '../components/settings/SettingRow'
import { SettingToggle } from '../components/settings/SettingToggle'
import { SettingSlider } from '../components/settings/SettingSlider'
import { SettingDropdown } from '../components/settings/SettingDropdown'
import { SettingFileInput } from '../components/settings/SettingFileInput'
import { DangerButton } from '../components/settings/DangerButton'
import { UpdateSection } from '../components/settings/UpdateSection'
import { ExportImportSection } from '../components/settings/ExportImportSection'
import { AutoBackupSection } from '../components/settings/AutoBackupSection'
import {
  HardDrive,
  Activity,
  ChevronRight,
  FileText,
  Info,
  Palette,
  Play,
  BookOpen,
  Download,
  Bell,
  Shield,
  HelpCircle,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { isMobile } from '@/utils/platform'
import { ApiStatusIndicator } from '@/components/layout/ApiStatusIndicator'

type SettingsPage = 'appearance' | 'playback' | 'reader' | 'downloads' | 'notifications' | 'privacy' | 'about'

const settingsNavItems: { key: SettingsPage; label: string; icon: typeof Palette }[] = [
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'playback', label: 'Playback', icon: Play },
  { key: 'reader', label: 'Reader', icon: BookOpen },
  { key: 'downloads', label: 'Downloads', icon: Download },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'privacy', label: 'Privacy', icon: Shield },
  { key: 'about', label: 'About', icon: HelpCircle },
]

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

  const [activePage, setActivePage] = useState<SettingsPage>('appearance')
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
      notifySuccess('History Cleared', 'Watch history has been cleared')
      loadStorageUsage()
    } catch (error) {
      notifyError('Clear Failed', `Failed to clear watch history: ${error}`)
    }
  }

  const handleClearLibrary = async () => {
    try {
      await invoke('clear_library')
      notifySuccess('Library Cleared', 'Library has been cleared')
      loadStorageUsage()
    } catch (error) {
      notifyError('Clear Failed', `Failed to clear library: ${error}`)
    }
  }

  const handleClearAllData = async () => {
    try {
      await invoke('clear_all_data')
      notifySuccess('Data Cleared', 'All data has been cleared')
      loadStorageUsage()
    } catch (error) {
      notifyError('Clear Failed', `Failed to clear data: ${error}`)
    }
  }

  const handleResetSettings = () => {
    settings.resetToDefaults()
    notifySuccess('Settings Reset', 'Settings have been reset to defaults')
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-background)]">
      {/* Settings Sidebar Navigation */}
      <aside className="w-[220px] flex-shrink-0 border-r border-[var(--color-glass-border)] bg-[rgba(26,26,26,0.6)] sticky top-[var(--nav-height)] h-[calc(100vh-var(--nav-height))] overflow-y-auto px-3 py-5">
        <div className="px-3 pb-4 font-display font-bold text-base">Settings</div>
        {settingsNavItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              onClick={() => setActivePage(item.key)}
              className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-[var(--radius-md)] text-sm mb-0.5 transition-all border ${
                activePage === item.key
                  ? 'bg-[rgba(229,9,20,0.12)] border-[rgba(229,9,20,0.2)] text-[var(--color-accent-light)] border-l-[3px] border-l-[var(--color-accent-mid)] pl-[9px]'
                  : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-glass-bg)] hover:text-white'
              }`}
            >
              <Icon size={16} className="flex-shrink-0" />
              {item.label}
            </button>
          )
        })}
      </aside>

      {/* Settings Content */}
      <main className="flex-1 px-6 sm:px-9 py-7 max-w-[680px]">
        {/* Appearance Page */}
        {activePage === 'appearance' && (
          <div>
            <h2 className="font-display font-bold text-xl mb-1.5">Appearance</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">Customize how Otaku looks and feels</p>

            <SettingSection title="General" description="App-wide preferences">
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

            <SettingSection title="Grid & Layout" description="Card and grid display options">
              <SettingRow
                label="Grid Density"
                description="Spacing and size of media cards"
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
          </div>
        )}

        {/* Playback Page */}
        {activePage === 'playback' && (
          <div>
            <h2 className="font-display font-bold text-xl mb-1.5">Playback</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">Control how videos are played</p>

            <SettingSection title="Player" description="Video playback preferences">
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
          </div>
        )}

        {/* Reader Page */}
        {activePage === 'reader' && (
          <div>
            <h2 className="font-display font-bold text-xl mb-1.5">Reader</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">Manga and light novel reading preferences</p>

            <SettingSection title="Reading Mode" description="Default reading direction and page layout">
              <SettingRow
                label="Default Reading Direction"
                description="Direction for page navigation"
              >
                <SettingDropdown
                  value="vertical"
                  options={[
                    { value: 'vertical', label: 'Vertical' },
                    { value: 'horizontal', label: 'Horizontal' },
                    { value: 'double', label: 'Double Page' },
                  ]}
                  onChange={() => {}}
                />
              </SettingRow>
              <SettingRow
                label="Page Fit"
                description="How pages fit within the viewport"
              >
                <SettingDropdown
                  value="width"
                  options={[
                    { value: 'width', label: 'Width' },
                    { value: 'height', label: 'Height' },
                    { value: 'original', label: 'Original' },
                  ]}
                  onChange={() => {}}
                />
              </SettingRow>
            </SettingSection>

            <SettingSection title="Behavior" description="Reading behavior and progress">
              <SettingRow
                label="Tap to Navigate"
                description="Tap left/right sides of screen to turn pages"
              >
                <SettingToggle value={true} onChange={() => {}} />
              </SettingRow>
              <SettingRow
                label="Auto-advance Chapter"
                description="Automatically go to next chapter when finished"
              >
                <SettingToggle value={false} onChange={() => {}} />
              </SettingRow>
            </SettingSection>
          </div>
        )}

        {/* Downloads Page */}
        {activePage === 'downloads' && (
          <div>
            <h2 className="font-display font-bold text-xl mb-1.5">Downloads</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">Configure download behavior and storage</p>

            <SettingSection title="Downloads" description="Download settings">
              {!isMobile() && (
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
              )}
              <SettingRow
                label="Max Concurrent Downloads"
                description="Maximum number of simultaneous downloads"
              >
                <SettingSlider
                  value={settings.maxConcurrentDownloads}
                  min={1}
                  max={10}
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

            {/* Export & Import */}
            {!isMobile() && <ExportImportSection />}
            {!isMobile() && <AutoBackupSection />}
          </div>
        )}

        {/* Notifications Page */}
        {activePage === 'notifications' && (
          <div>
            <h2 className="font-display font-bold text-xl mb-1.5">Notifications</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">Manage notification preferences</p>

            <SettingSection title="Push Notifications" description="When to receive notifications">
              <SettingRow
                label="New Episodes"
                description="Get notified when new episodes of tracked anime air"
              >
                <SettingToggle value={true} onChange={() => {}} />
              </SettingRow>
              <SettingRow
                label="New Chapters"
                description="Get notified when new manga chapters are released"
              >
                <SettingToggle value={true} onChange={() => {}} />
              </SettingRow>
              <SettingRow
                label="Download Complete"
                description="Notify when a download finishes"
              >
                <SettingToggle value={true} onChange={() => {}} />
              </SettingRow>
            </SettingSection>
          </div>
        )}

        {/* Privacy Page */}
        {activePage === 'privacy' && (
          <div>
            <h2 className="font-display font-bold text-xl mb-1.5">Privacy</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">Control your data and privacy settings</p>

            <SettingSection title="Data & Privacy" description="Manage your data and reset settings">
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
                description="Delete everything including history and library"
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
                <DangerButton
                  onClick={handleResetSettings}
                  label="Reset to Defaults"
                  confirmMessage="This will reset all your settings to their default values. Your data and library will not be affected. Continue?"
                />
              </SettingRow>
            </SettingSection>

            {/* Developer Section — hidden on mobile */}
            {!isMobile() && (
              <SettingSection title="Developer" description="Debugging and diagnostic tools">
                <SettingRow
                  label="System Stats"
                  description="View real-time CPU, memory, and storage metrics"
                >
                  <Link
                    to="/stats"
                    className="flex items-center gap-2 bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded-lg px-4 py-2 font-medium transition-colors"
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
                    className="flex items-center gap-2 bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded-lg px-4 py-2 font-medium transition-colors"
                  >
                    <FileText size={16} />
                    View Logs
                    <ChevronRight size={16} className="text-[var(--color-text-tertiary)]" />
                  </Link>
                </SettingRow>
              </SettingSection>
            )}

            {/* Updates Section (desktop only) */}
            {!isMobile() && <UpdateSection />}
          </div>
        )}

        {/* About Page */}
        {activePage === 'about' && (
          <div>
            <h2 className="font-display font-bold text-xl mb-1.5">About</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">App information and credits</p>

            <SettingSection title="Version" description="Application information">
              <SettingRow
                label="App Version"
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

            <SettingSection title="System Status" description="API connectivity and health">
              <div className="px-1 py-2">
                <ApiStatusIndicator inline />
              </div>
            </SettingSection>
          </div>
        )}
      </main>
    </div>
  )
}
