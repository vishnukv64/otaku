/**
 * Settings Store - Application settings
 *
 * Handles:
 * - Appearance (grid density, continue watching)
 * - Content filtering (NSFW)
 * - Download configuration
 * - Player defaults
 *
 * All settings are persisted to the SQLite database for backup/export support
 */

import { create } from 'zustand'
import { getAppSetting, setAppSetting } from '@/utils/tauri-commands'
import { isMobile } from '@/utils/platform'
import {
  ANIKOTO_DEFAULT_API_BASE_URL,
  ANIKOTO_DEFAULT_SITE_BASE_URL,
  ANIKOTO_DEFAULT_YOTOCHAN_BASE_URL,
  ANIKOTO_LEGACY_LOCAL_API_BASE_URL,
} from '@/extensions/anikoto-extension'

// Database key for all settings
const DB_KEY_SETTINGS = 'app_settings'

export type StreamingProviderMode = 'kaa' | 'allanime' | 'anikoto' | 'hstream'

const STREAMING_PROVIDER_MODES: StreamingProviderMode[] = ['kaa', 'allanime', 'anikoto', 'hstream']

// Bump when the default provider changes and existing installs should move to it once.
const PROVIDER_DEFAULT_VERSION = 2

interface SettingsData {
  // Appearance
  gridDensity: 'compact' | 'comfortable' | 'spacious'
  showContinueWatching: boolean

  // Content
  nsfwFilter: boolean
  /** Opt-in extended catalog (the hstream provider). Off by default; enabled after a confirmation. */
  extendedCatalog: boolean

  // Downloads
  downloadLocation: string
  defaultDownloadQuality: 'auto' | '1080p' | '720p' | '480p' | '360p'
  maxConcurrentDownloads: number
  autoDeleteWatched: boolean

  // Player defaults
  defaultVolume: number
  defaultPlaybackSpeed: number
  markWatchedThreshold: number
  streamingProvider: StreamingProviderMode
  anikotoApiBaseUrl: string
  anikotoSiteBaseUrl: string
  anikotoYotochanBaseUrl: string
  providerDefaultVersion: number

  // Onboarding
  onboardingCompleted: boolean
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
  gridDensity: isMobile() ? 'compact' : 'comfortable',
  showContinueWatching: true,

  // Content
  nsfwFilter: false,
  extendedCatalog: false,

  // Downloads
  downloadLocation: '',
  defaultDownloadQuality: 'auto',
  maxConcurrentDownloads: 3,
  autoDeleteWatched: false,

  // Player defaults
  defaultVolume: 1.0,
  defaultPlaybackSpeed: 1.0,
  markWatchedThreshold: 90,
  streamingProvider: 'kaa',
  anikotoApiBaseUrl: ANIKOTO_DEFAULT_API_BASE_URL,
  anikotoSiteBaseUrl: ANIKOTO_DEFAULT_SITE_BASE_URL,
  anikotoYotochanBaseUrl: ANIKOTO_DEFAULT_YOTOCHAN_BASE_URL,
  providerDefaultVersion: PROVIDER_DEFAULT_VERSION,

  // Onboarding
  onboardingCompleted: false,
}

// Helper to save settings to database
const saveToDatabase = async (settings: SettingsData) => {
  try {
    await setAppSetting(DB_KEY_SETTINGS, JSON.stringify(settings))
    // Also save NSFW filter as a separate key for the release checker
    // The release checker needs this to properly fetch episode info for adult content
    await setAppSetting('nsfw_filter', settings.nsfwFilter ? '1' : '0')
  } catch (err) {
    console.error('Failed to save settings to database:', err)
  }
}

// Extract only the data fields (not internal state or actions)
const extractSettingsData = (state: SettingsState): SettingsData => ({
  gridDensity: state.gridDensity,
  showContinueWatching: state.showContinueWatching,
  nsfwFilter: state.nsfwFilter,
  extendedCatalog: state.extendedCatalog,
  downloadLocation: state.downloadLocation,
  defaultDownloadQuality: state.defaultDownloadQuality,
  maxConcurrentDownloads: state.maxConcurrentDownloads,
  autoDeleteWatched: state.autoDeleteWatched,
  defaultVolume: state.defaultVolume,
  defaultPlaybackSpeed: state.defaultPlaybackSpeed,
  markWatchedThreshold: state.markWatchedThreshold,
  streamingProvider: state.streamingProvider,
  anikotoApiBaseUrl: state.anikotoApiBaseUrl,
  anikotoSiteBaseUrl: state.anikotoSiteBaseUrl,
  anikotoYotochanBaseUrl: state.anikotoYotochanBaseUrl,
  providerDefaultVersion: state.providerDefaultVersion,
  onboardingCompleted: state.onboardingCompleted,
})

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...defaultSettings,
  _initialized: false,
  _saving: false,

  // Update multiple settings at once
  updateSettings: (rawSettings) => {
    // Turning the extended catalog off also drops an extended-catalog provider selection.
    const newSettings =
      rawSettings.extendedCatalog === false && get().streamingProvider === 'hstream'
        ? { ...rawSettings, streamingProvider: defaultSettings.streamingProvider }
        : rawSettings
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
        const anikotoApiBaseUrl = !parsed.anikotoApiBaseUrl || parsed.anikotoApiBaseUrl === ANIKOTO_LEGACY_LOCAL_API_BASE_URL
          ? ANIKOTO_DEFAULT_API_BASE_URL
          : parsed.anikotoApiBaseUrl
        // Installs saved before KAA existed move to the new default once;
        // a provider picked after that is kept.
        const providerOutdated = (parsed.providerDefaultVersion ?? 1) < PROVIDER_DEFAULT_VERSION
        const streamingProvider: StreamingProviderMode =
          !providerOutdated &&
          parsed.streamingProvider &&
          STREAMING_PROVIDER_MODES.includes(parsed.streamingProvider) &&
          (parsed.streamingProvider !== 'hstream' || parsed.extendedCatalog === true)
            ? parsed.streamingProvider
            : defaultSettings.streamingProvider
        // Merge with defaults to handle new settings added in updates
        const mergedSettings = {
          ...defaultSettings,
          ...parsed,
          streamingProvider,
          anikotoApiBaseUrl,
          anikotoSiteBaseUrl: parsed.anikotoSiteBaseUrl || ANIKOTO_DEFAULT_SITE_BASE_URL,
          anikotoYotochanBaseUrl: parsed.anikotoYotochanBaseUrl || ANIKOTO_DEFAULT_YOTOCHAN_BASE_URL,
          providerDefaultVersion: PROVIDER_DEFAULT_VERSION,
          // Existing users upgrading won't have this field — skip onboarding for them
          onboardingCompleted: parsed.onboardingCompleted ?? true,
        }
        set({ ...mergedSettings, _initialized: true })
        if (
          providerOutdated ||
          streamingProvider !== parsed.streamingProvider ||
          anikotoApiBaseUrl !== parsed.anikotoApiBaseUrl ||
          !parsed.anikotoSiteBaseUrl ||
          !parsed.anikotoYotochanBaseUrl
        ) {
          await saveToDatabase(mergedSettings)
        }
        // Sync NSFW filter key for the release checker
        await setAppSetting('nsfw_filter', mergedSettings.nsfwFilter ? '1' : '0')
      } else {
        set({ _initialized: true })
        // Sync default NSFW filter setting
        await setAppSetting('nsfw_filter', defaultSettings.nsfwFilter ? '1' : '0')
      }
    } catch (err) {
      console.error('Failed to load settings from database:', err)
      set({ _initialized: true })
    }
  },
}))
