/**
 * Settings Store - Application settings
 *
 * Handles:
 * - Theme preferences
 * - Download location
 * - Default quality
 * - Tracker authentication
 *
 * Settings are persisted to localStorage
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState {
  theme: 'dark' | 'light'
  defaultQuality: 'auto' | '1080p' | '720p' | '480p'
  downloadLocation: string
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    () => ({
      theme: 'dark',
      defaultQuality: 'auto',
      downloadLocation: '',
    }),
    {
      name: 'otaku-settings',
    }
  )
)
