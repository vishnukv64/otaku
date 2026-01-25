import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
}

interface PlayerState {
  // Watch history and progress
  watchProgress: Record<string, WatchProgress> // key: animeId-episodeId

  // Player settings
  settings: PlayerSettings

  // Current playback state (not persisted)
  currentAnimeId: string | null
  currentEpisodeId: string | null

  // Actions
  setWatchProgress: (animeId: string, episodeId: string, progress: Partial<WatchProgress>) => void
  getWatchProgress: (animeId: string, episodeId: string) => WatchProgress | null
  clearWatchProgress: (animeId: string, episodeId?: string) => void

  updateSettings: (settings: Partial<PlayerSettings>) => void

  setCurrentPlayback: (animeId: string | null, episodeId: string | null) => void
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      // Initial state
      watchProgress: {},
      settings: {
        volume: 1,
        muted: false,
        autoPlayNext: true,
        preferredQuality: 'Auto',
        preferredServer: 0,
      },
      currentAnimeId: null,
      currentEpisodeId: null,

      // Set or update watch progress for an episode
      setWatchProgress: (animeId, episodeId, progress) => {
        const key = `${animeId}-${episodeId}`
        const existing = get().watchProgress[key]

        set((state) => ({
          watchProgress: {
            ...state.watchProgress,
            [key]: {
              episodeId,
              currentTime: progress.currentTime ?? existing?.currentTime ?? 0,
              duration: progress.duration ?? existing?.duration ?? 0,
              lastWatched: progress.lastWatched ?? Date.now(),
              completed: progress.completed ?? existing?.completed ?? false,
            },
          },
        }))
      },

      // Get watch progress for an episode
      getWatchProgress: (animeId, episodeId) => {
        const key = `${animeId}-${episodeId}`
        return get().watchProgress[key] || null
      },

      // Clear watch progress (all episodes or specific episode)
      clearWatchProgress: (animeId, episodeId) => {
        set((state) => {
          if (episodeId) {
            // Clear specific episode
            const key = `${animeId}-${episodeId}`
            const { [key]: _, ...rest } = state.watchProgress
            return { watchProgress: rest }
          } else {
            // Clear all episodes for this anime
            const filtered = Object.entries(state.watchProgress)
              .filter(([key]) => !key.startsWith(`${animeId}-`))
              .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
            return { watchProgress: filtered }
          }
        })
      },

      // Update player settings
      updateSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }))
      },

      // Set current playback
      setCurrentPlayback: (animeId, episodeId) => {
        set({ currentAnimeId: animeId, currentEpisodeId: episodeId })
      },
    }),
    {
      name: 'otaku-player-storage',
      // Only persist watch progress and settings, not current playback
      partialize: (state) => ({
        watchProgress: state.watchProgress,
        settings: state.settings,
      }),
    }
  )
)
