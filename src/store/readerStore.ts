/**
 * Reader Store - Zustand store for manga reader settings and state
 *
 * Manages:
 * - Reading mode preferences (single, double, vertical, webtoon)
 * - Reader settings (direction, fit mode, colors)
 * - Current reading state
 *
 * Settings are persisted to SQLite database for backup/export support
 */

import { create } from 'zustand'
import { getAppSetting, setAppSetting } from '@/utils/tauri-commands'

// Database key for reader settings
const DB_KEY_READER_SETTINGS = 'reader_settings'

export type ReadingMode = 'single' | 'double' | 'vertical' | 'webtoon'
export type ReadingDirection = 'ltr' | 'rtl'
export type FitMode = 'width' | 'height' | 'original' | 'contain'

export interface ReaderSettings {
  // Reading modes
  readingMode: ReadingMode
  readingDirection: ReadingDirection
  fitMode: FitMode

  // Visual settings
  backgroundColor: string
  showPageNumbers: boolean
  showProgressBar: boolean

  // Behavior settings
  preloadPages: number
  autoAdvanceChapter: boolean
  tapToNavigate: boolean
  swipeToNavigate: boolean

  // Zoom settings
  zoom: number
  minZoom: number
  maxZoom: number

  // Advanced settings
  brightness: number
  markReadThreshold: number // Percentage of chapter to mark as read (0-100)
}

export interface ReaderState {
  // Current reading state (not persisted)
  currentMangaId: string | null
  currentChapterId: string | null
  currentPage: number
  totalPages: number
  isFullscreen: boolean
  showControls: boolean
  isLoading: boolean

  // Settings (persisted)
  settings: ReaderSettings

  // Internal
  _initialized: boolean
}

interface ReaderActions {
  // Page navigation
  setCurrentPage: (page: number) => void
  nextPage: () => void
  previousPage: () => void
  goToPage: (page: number) => void

  // Chapter management
  setCurrentChapter: (mangaId: string, chapterId: string) => void
  clearCurrentChapter: () => void
  setTotalPages: (total: number) => void

  // UI state
  setFullscreen: (fullscreen: boolean) => void
  toggleFullscreen: () => void
  setShowControls: (show: boolean) => void
  toggleControls: () => void
  setLoading: (loading: boolean) => void

  // Settings
  updateSettings: (settings: Partial<ReaderSettings>) => void
  setReadingMode: (mode: ReadingMode) => void
  setReadingDirection: (direction: ReadingDirection) => void
  setFitMode: (mode: FitMode) => void
  setZoom: (zoom: number) => void
  resetSettings: () => void
  initFromDatabase: () => Promise<void>
}

const defaultSettings: ReaderSettings = {
  readingMode: 'single',
  readingDirection: 'ltr',
  fitMode: 'contain',
  backgroundColor: '#1a1a1a',
  showPageNumbers: true,
  showProgressBar: true,
  preloadPages: 3,
  autoAdvanceChapter: false,
  tapToNavigate: true,
  swipeToNavigate: true,
  zoom: 1,
  minZoom: 0.5,
  maxZoom: 3,
  brightness: 1,
  markReadThreshold: 90,
}

const initialState: ReaderState = {
  currentMangaId: null,
  currentChapterId: null,
  currentPage: 1,
  totalPages: 0,
  isFullscreen: false,
  showControls: true,
  isLoading: false,
  settings: defaultSettings,
  _initialized: false,
}

// Helper to save settings to database
const saveSettingsToDatabase = async (settings: ReaderSettings) => {
  try {
    await setAppSetting(DB_KEY_READER_SETTINGS, JSON.stringify(settings))
  } catch (err) {
    console.error('Failed to save reader settings to database:', err)
  }
}

export const useReaderStore = create<ReaderState & ReaderActions>()((set, get) => ({
  ...initialState,

  // Page navigation
  setCurrentPage: (page) => {
    const { totalPages } = get()
    const clampedPage = Math.max(1, Math.min(page, totalPages || 1))
    set({ currentPage: clampedPage })
  },

  nextPage: () => {
    const { currentPage, totalPages, settings } = get()
    const increment = settings.readingMode === 'double' ? 2 : 1
    const newPage = Math.min(currentPage + increment, totalPages || currentPage)
    set({ currentPage: newPage })
  },

  previousPage: () => {
    const { currentPage, settings } = get()
    const decrement = settings.readingMode === 'double' ? 2 : 1
    const newPage = Math.max(1, currentPage - decrement)
    set({ currentPage: newPage })
  },

  goToPage: (page) => {
    const { totalPages } = get()
    const clampedPage = Math.max(1, Math.min(page, totalPages || 1))
    set({ currentPage: clampedPage })
  },

  // Chapter management
  setCurrentChapter: (mangaId, chapterId) => {
    set({
      currentMangaId: mangaId,
      currentChapterId: chapterId,
      currentPage: 1,
      totalPages: 0,
      isLoading: true,
    })
  },

  clearCurrentChapter: () => {
    set({
      currentMangaId: null,
      currentChapterId: null,
      currentPage: 1,
      totalPages: 0,
    })
  },

  setTotalPages: (total) => {
    set({ totalPages: total, isLoading: false })
  },

  // UI state
  setFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
  toggleFullscreen: () => set((state) => ({ isFullscreen: !state.isFullscreen })),
  setShowControls: (show) => set({ showControls: show }),
  toggleControls: () => set((state) => ({ showControls: !state.showControls })),
  setLoading: (loading) => set({ isLoading: loading }),

  // Settings
  updateSettings: (newSettings) => {
    const updatedSettings = { ...get().settings, ...newSettings }
    set({ settings: updatedSettings })
    saveSettingsToDatabase(updatedSettings)
  },

  setReadingMode: (mode) => {
    const updatedSettings = { ...get().settings, readingMode: mode }
    set({ settings: updatedSettings })
    saveSettingsToDatabase(updatedSettings)
  },

  setReadingDirection: (direction) => {
    const updatedSettings = { ...get().settings, readingDirection: direction }
    set({ settings: updatedSettings })
    saveSettingsToDatabase(updatedSettings)
  },

  setFitMode: (mode) => {
    const updatedSettings = { ...get().settings, fitMode: mode }
    set({ settings: updatedSettings })
    saveSettingsToDatabase(updatedSettings)
  },

  setZoom: (zoom) => {
    const { settings } = get()
    const clampedZoom = Math.max(settings.minZoom, Math.min(zoom, settings.maxZoom))
    const updatedSettings = { ...settings, zoom: clampedZoom }
    set({ settings: updatedSettings })
    saveSettingsToDatabase(updatedSettings)
  },

  resetSettings: () => {
    set({ settings: defaultSettings })
    saveSettingsToDatabase(defaultSettings)
  },

  // Initialize from database
  initFromDatabase: async () => {
    if (get()._initialized) return

    try {
      const stored = await getAppSetting(DB_KEY_READER_SETTINGS)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ReaderSettings>
        // Merge with defaults to handle new settings added in updates
        set({ settings: { ...defaultSettings, ...parsed }, _initialized: true })
      } else {
        set({ _initialized: true })
      }
    } catch (err) {
      console.error('Failed to load reader settings from database:', err)
      set({ _initialized: true })
    }
  },
}))

// Selector hooks for specific settings
export const useReadingMode = () => useReaderStore((state) => state.settings.readingMode)
export const useReadingDirection = () => useReaderStore((state) => state.settings.readingDirection)
export const useFitMode = () => useReaderStore((state) => state.settings.fitMode)
export const useReaderSettings = () => useReaderStore((state) => state.settings)
