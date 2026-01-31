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
 * Settings are persisted to localStorage and database (for download location)
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getAppSetting, setAppSetting, deleteAppSetting } from '@/utils/tauri-commands'

// Database key for download location
const DB_KEY_DOWNLOAD_LOCATION = 'download_location'

interface SettingsState {
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

  // Internal state
  _dbInitialized: boolean

  // Actions
  updateSettings: (settings: Partial<Omit<SettingsState, 'updateSettings' | 'resetToDefaults' | 'initFromDatabase' | '_dbInitialized'>>) => void
  resetToDefaults: () => void
  initFromDatabase: () => Promise<void>
}

const defaultSettings = {
  // Appearance
  theme: 'dark' as const,
  gridDensity: 'comfortable' as const,
  showContinueWatching: true,

  // Content
  nsfwFilter: false,

  // Downloads
  downloadLocation: '',
  defaultDownloadQuality: 'auto' as const,
  maxConcurrentDownloads: 3,
  autoDeleteWatched: false,

  // Player defaults
  defaultVolume: 1.0,
  defaultPlaybackSpeed: 1.0,
  markWatchedThreshold: 90,
  autoplayTrailers: true,

  // Internal
  _dbInitialized: false,
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get): SettingsState => ({
      ...defaultSettings,

      // Update multiple settings at once
      updateSettings: (newSettings) => {
        set((state) => ({ ...state, ...newSettings }))

        // If download location is being updated, save to database
        if (newSettings.downloadLocation !== undefined) {
          const location = newSettings.downloadLocation
          if (location && location.trim() !== '') {
            setAppSetting(DB_KEY_DOWNLOAD_LOCATION, location).catch((err) => {
              console.error('Failed to save download location to database:', err)
            })
          } else {
            // If empty, delete from database
            deleteAppSetting(DB_KEY_DOWNLOAD_LOCATION).catch((err) => {
              console.error('Failed to delete download location from database:', err)
            })
          }
        }
      },

      // Reset all settings to default values
      resetToDefaults: () => {
        set(defaultSettings)
        // Also clear from database
        deleteAppSetting(DB_KEY_DOWNLOAD_LOCATION).catch((err) => {
          console.error('Failed to delete download location from database:', err)
        })
      },

      // Initialize settings from database (call on app startup)
      initFromDatabase: async () => {
        // Only init once
        if (get()._dbInitialized) return

        try {
          const dbLocation = await getAppSetting(DB_KEY_DOWNLOAD_LOCATION)
          if (dbLocation) {
            set({ downloadLocation: dbLocation, _dbInitialized: true })
          } else {
            set({ _dbInitialized: true })
          }
        } catch (err) {
          console.error('Failed to load settings from database:', err)
          set({ _dbInitialized: true })
        }
      },
    }),
    {
      name: 'otaku-settings',
      // Don't persist the _dbInitialized flag
      partialize: (state) => {
        const { _dbInitialized: _, ...rest } = state
        return rest
      },
    }
  )
)
