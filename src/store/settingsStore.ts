/**
 * Settings Store - Application settings
 *
 * Handles:
 * - Theme preferences
 * - Appearance (grid density, continue watching)
 * - Content filtering (NSFW)
 * - Download configuration
 * - Player defaults
 *
 * All settings are persisted to the SQLite database for backup/export support
 */

import { create } from 'zustand'
import { getAppSetting, setAppSetting } from '@/utils/tauri-commands'

// Database key for all settings
const DB_KEY_SETTINGS = 'app_settings'

interface SettingsData {
  // Appearance
  theme: 'dark' | 'light'
  gridDensity: 'compact' | 'comfortable' | 'spacious'
  showContinueWatching: boolean

  // Content
  nsfwFilter: boolean

  // Downloads
  downloadLocation: string
  defaultDownloadQuality: 'auto' | '1080p' | '720p' | '480p' | '360p'
  maxConcurrentDownloads: number
  autoDeleteWatched: boolean

  // Player defaults
  defaultVolume: number
  defaultPlaybackSpeed: number
  markWatchedThreshold: number
  autoplayTrailers: boolean
}

interface SettingsState extends SettingsData {
  // Internal state
  _initialized: boolean
  _saving: boolean

  // Actions
  updateSettings: (settings: Partial<SettingsData>) => void
  resetToDefaults: () => void
  initFromDatabase: () => Promise<void>
}

const defaultSettings: SettingsData = {
  // Appearance
  theme: 'dark',
  gridDensity: 'comfortable',
  showContinueWatching: true,

  // Content
  nsfwFilter: false,

  // Downloads
  downloadLocation: '',
  defaultDownloadQuality: 'auto',
  maxConcurrentDownloads: 3,
  autoDeleteWatched: false,

  // Player defaults
  defaultVolume: 1.0,
  defaultPlaybackSpeed: 1.0,
  markWatchedThreshold: 90,
  autoplayTrailers: true,
}

// Helper to save settings to database
const saveToDatabase = async (settings: SettingsData) => {
  try {
    await setAppSetting(DB_KEY_SETTINGS, JSON.stringify(settings))
  } catch (err) {
    console.error('Failed to save settings to database:', err)
  }
}

// Extract only the data fields (not internal state or actions)
const extractSettingsData = (state: SettingsState): SettingsData => ({
  theme: state.theme,
  gridDensity: state.gridDensity,
  showContinueWatching: state.showContinueWatching,
  nsfwFilter: state.nsfwFilter,
  downloadLocation: state.downloadLocation,
  defaultDownloadQuality: state.defaultDownloadQuality,
  maxConcurrentDownloads: state.maxConcurrentDownloads,
  autoDeleteWatched: state.autoDeleteWatched,
  defaultVolume: state.defaultVolume,
  defaultPlaybackSpeed: state.defaultPlaybackSpeed,
  markWatchedThreshold: state.markWatchedThreshold,
  autoplayTrailers: state.autoplayTrailers,
})

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...defaultSettings,
  _initialized: false,
  _saving: false,

  // Update multiple settings at once
  updateSettings: (newSettings) => {
    set((state) => ({ ...state, ...newSettings }))

    // Save to database (debounced via the state update)
    const currentState = get()
    const settingsData = extractSettingsData({ ...currentState, ...newSettings } as SettingsState)
    saveToDatabase(settingsData)
  },

  // Reset all settings to default values
  resetToDefaults: () => {
    set({ ...defaultSettings, _initialized: true })
    saveToDatabase(defaultSettings)
  },

  // Initialize settings from database (call on app startup)
  initFromDatabase: async () => {
    // Only init once
    if (get()._initialized) return

    try {
      const stored = await getAppSetting(DB_KEY_SETTINGS)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<SettingsData>
        // Merge with defaults to handle new settings added in updates
        set({ ...defaultSettings, ...parsed, _initialized: true })
      } else {
        set({ _initialized: true })
      }
    } catch (err) {
      console.error('Failed to load settings from database:', err)
      set({ _initialized: true })
    }
  },
}))
