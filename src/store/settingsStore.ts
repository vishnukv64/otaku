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
 * Settings are persisted to localStorage
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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

  // Actions
  updateSettings: (settings: Partial<Omit<SettingsState, 'updateSettings' | 'resetToDefaults'>>) => void
  resetToDefaults: () => void
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
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set): SettingsState => ({
      ...defaultSettings,

      // Update multiple settings at once
      updateSettings: (newSettings) => {
        set((state) => ({ ...state, ...newSettings }))
      },

      // Reset all settings to default values
      resetToDefaults: () => {
        set(defaultSettings)
      },
    }),
    {
      name: 'otaku-settings',
    }
  )
)
