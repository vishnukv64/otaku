/**
 * PiP Store - Picture-in-Picture state management
 *
 * Coordinates the mini player overlay that persists across route changes.
 * When the user enters PiP from VideoPlayer, this store holds the playback
 * context so MiniPlayer (mounted at root level) can pick it up.
 */

import { create } from 'zustand'
import type { VideoSource } from '@/types/extension'
import type { VideoServerUrls } from '@/utils/tauri-commands'

export interface PipData {
  /** The specific source URL being played (HLS manifest or direct MP4) */
  sourceUrl: string
  /** Whether the source is an HLS stream */
  isHls: boolean
  /** Full sources array (for potential server switching in future) */
  sources: VideoSource[]
  /** Currently selected server index */
  selectedServer: number
  /** Video server info for proxying (passed from VideoPlayer to avoid async fetch) */
  videoServer: VideoServerUrls
  /** Playback position in seconds */
  currentTime: number
  /** Total duration in seconds */
  duration: number
  /** Volume level 0-1 */
  volume: number
  /** Whether audio is muted */
  isMuted: boolean
  /** MAL ID for navigation and progress saving */
  malId: string
  /** Episode ID for navigation and progress saving */
  episodeId: string
  /** Anime title for display */
  animeTitle: string
  /** Episode number for display and progress saving */
  episodeNumber: number
}

interface PipState {
  /** Whether the mini player is active */
  isActive: boolean
  /** Playback context for the mini player */
  data: PipData | null
  /**
   * When expanding back to full player, this holds the current time
   * so watch.tsx can resume at the exact position without waiting for DB
   */
  expandTime: number | null

  /** Enter PiP mode with the given playback context */
  enterPip: (data: PipData) => void
  /** Update the current playback time (called periodically by MiniPlayer) */
  updateTime: (time: number) => void
  /** Set the expand time and deactivate PiP (called when expanding to full player) */
  expandToFull: (currentTime: number) => void
  /** Clear the expand time (called by watch.tsx after consuming it) */
  clearExpandTime: () => void
  /** Close PiP entirely */
  closePip: () => void
}

export const usePipStore = create<PipState>()((set) => ({
  isActive: false,
  data: null,
  expandTime: null,

  enterPip: (data) => set({ isActive: true, data, expandTime: null }),

  updateTime: (time) =>
    set((state) =>
      state.data ? { data: { ...state.data, currentTime: time } } : {}
    ),

  expandToFull: (currentTime) =>
    set((state) => ({
      isActive: false,
      data: state.data ? { ...state.data, currentTime } : null,
      expandTime: currentTime,
    })),

  clearExpandTime: () => set({ expandTime: null, data: null }),

  closePip: () => set({ isActive: false, data: null, expandTime: null }),
}))
