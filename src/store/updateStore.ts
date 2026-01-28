/**
 * Update Store - Application update state management
 *
 * Handles:
 * - Update check status
 * - Available update information
 * - Download progress tracking
 * - Error state management
 *
 * State is NOT persisted as it's transient
 */

import { create } from 'zustand'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'error'

export interface UpdateInfo {
  version: string
  currentVersion: string
  date?: string
  body?: string // Changelog/release notes
}

export interface UpdateProgress {
  downloaded: number
  total: number | null
  percentage: number
}

interface UpdateState {
  // Status
  status: UpdateStatus
  error: string | null

  // Update info
  updateInfo: UpdateInfo | null

  // Download progress
  progress: UpdateProgress

  // Timestamps
  lastChecked: number | null

  // Actions
  setStatus: (status: UpdateStatus) => void
  setError: (error: string | null) => void
  setUpdateInfo: (info: UpdateInfo | null) => void
  setProgress: (progress: Partial<UpdateProgress>) => void
  setLastChecked: (timestamp: number) => void
  reset: () => void
}

const initialProgress: UpdateProgress = {
  downloaded: 0,
  total: null,
  percentage: 0,
}

export const useUpdateStore = create<UpdateState>()((set) => ({
  // Initial state
  status: 'idle',
  error: null,
  updateInfo: null,
  progress: initialProgress,
  lastChecked: null,

  // Actions
  setStatus: (status) => set({ status }),

  setError: (error) => set({ error, status: error ? 'error' : 'idle' }),

  setUpdateInfo: (updateInfo) => set({ updateInfo }),

  setProgress: (progress) =>
    set((state) => ({
      progress: { ...state.progress, ...progress },
    })),

  setLastChecked: (lastChecked) => set({ lastChecked }),

  reset: () =>
    set({
      status: 'idle',
      error: null,
      updateInfo: null,
      progress: initialProgress,
    }),
}))
