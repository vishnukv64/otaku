/**
 * Player Store - Video player settings and watch progress
 *
 * Manages:
 * - Player settings (volume, quality, playback speed)
 * - Watch progress per episode
 * - Current playback state
 *
 * Settings and watch progress are persisted to SQLite database for backup/export support
 */

import { create } from 'zustand'
import { getAppSetting, setAppSetting } from '@/utils/tauri-commands'

// Database keys
const DB_KEY_PLAYER_SETTINGS = 'player_settings'
const DB_KEY_WATCH_PROGRESS = 'watch_progress'

interface WatchProgress {
  episodeId: string
  currentTime: number
  duration: number
  lastWatched: number // timestamp
  completed: boolean
}

interface PlayerSettings {
  volume: number
  muted: boolean
  autoPlayNext: boolean
  preferredQuality: string
  preferredServer: number
  playbackSpeed: number
}

interface PlayerState {
  // Watch history and progress
  watchProgress: Record<string, WatchProgress> // key: animeId-episodeId

  // Player settings
  settings: PlayerSettings

  // Current playback state (not persisted)
  currentAnimeId: string | null
  currentEpisodeId: string | null

  // Internal
  _initialized: boolean

  // Actions
  setWatchProgress: (animeId: string, episodeId: string, progress: Partial<WatchProgress>) => void
  getWatchProgress: (animeId: string, episodeId: string) => WatchProgress | null
  clearWatchProgress: (animeId: string, episodeId?: string) => void

  updateSettings: (settings: Partial<PlayerSettings>) => void

  setCurrentPlayback: (animeId: string | null, episodeId: string | null) => void

  initFromDatabase: () => Promise<void>
}

const defaultSettings: PlayerSettings = {
  volume: 1,
  muted: false,
  autoPlayNext: true,
  preferredQuality: 'Auto',
  preferredServer: 0,
  playbackSpeed: 1.0,
}

// Helper to save settings to database
const saveSettingsToDatabase = async (settings: PlayerSettings) => {
  try {
    await setAppSetting(DB_KEY_PLAYER_SETTINGS, JSON.stringify(settings))
  } catch (err) {
    console.error('Failed to save player settings to database:', err)
  }
}

// Helper to save watch progress to database (debounced)
let saveProgressTimeout: ReturnType<typeof setTimeout> | null = null
const saveWatchProgressToDatabase = (watchProgress: Record<string, WatchProgress>) => {
  // Debounce saves to avoid too many writes
  if (saveProgressTimeout) {
    clearTimeout(saveProgressTimeout)
  }
  saveProgressTimeout = setTimeout(async () => {
    try {
      await setAppSetting(DB_KEY_WATCH_PROGRESS, JSON.stringify(watchProgress))
    } catch (err) {
      console.error('Failed to save watch progress to database:', err)
    }
  }, 1000) // 1 second debounce
}

export const usePlayerStore = create<PlayerState>()((set, get) => ({
  // Initial state
  watchProgress: {},
  settings: defaultSettings,
  currentAnimeId: null,
  currentEpisodeId: null,
  _initialized: false,

  // Set or update watch progress for an episode
  setWatchProgress: (animeId, episodeId, progress) => {
    const key = `${animeId}-${episodeId}`
    const existing = get().watchProgress[key]

    const newProgress = {
      ...get().watchProgress,
      [key]: {
        episodeId,
        currentTime: progress.currentTime ?? existing?.currentTime ?? 0,
        duration: progress.duration ?? existing?.duration ?? 0,
        lastWatched: progress.lastWatched ?? Date.now(),
        completed: progress.completed ?? existing?.completed ?? false,
      },
    }

    set({ watchProgress: newProgress })
    saveWatchProgressToDatabase(newProgress)
  },

  // Get watch progress for an episode
  getWatchProgress: (animeId, episodeId) => {
    const key = `${animeId}-${episodeId}`
    return get().watchProgress[key] || null
  },

  // Clear watch progress (all episodes or specific episode)
  clearWatchProgress: (animeId, episodeId) => {
    let newProgress: Record<string, WatchProgress>

    if (episodeId) {
      // Clear specific episode
      const key = `${animeId}-${episodeId}`
      const { [key]: _, ...rest } = get().watchProgress
      newProgress = rest
    } else {
      // Clear all episodes for this anime
      newProgress = Object.entries(get().watchProgress)
        .filter(([key]) => !key.startsWith(`${animeId}-`))
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
    }

    set({ watchProgress: newProgress })
    saveWatchProgressToDatabase(newProgress)
  },

  // Update player settings
  updateSettings: (newSettings) => {
    const updatedSettings = { ...get().settings, ...newSettings }
    set({ settings: updatedSettings })
    saveSettingsToDatabase(updatedSettings)
  },

  // Set current playback
  setCurrentPlayback: (animeId, episodeId) => {
    set({ currentAnimeId: animeId, currentEpisodeId: episodeId })
  },

  // Initialize from database
  initFromDatabase: async () => {
    if (get()._initialized) return

    try {
      // Load settings
      const storedSettings = await getAppSetting(DB_KEY_PLAYER_SETTINGS)
      if (storedSettings) {
        const parsed = JSON.parse(storedSettings) as Partial<PlayerSettings>
        set({ settings: { ...defaultSettings, ...parsed } })
      }

      // Load watch progress
      const storedProgress = await getAppSetting(DB_KEY_WATCH_PROGRESS)
      if (storedProgress) {
        const parsed = JSON.parse(storedProgress) as Record<string, WatchProgress>
        set({ watchProgress: parsed })
      }

      set({ _initialized: true })
    } catch (err) {
      console.error('Failed to load player data from database:', err)
      set({ _initialized: true })
    }
  },
}))
