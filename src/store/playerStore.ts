/**
 * Player Store - Video player state management
 *
 * Handles:
 * - Current episode/chapter
 * - Playback position
 * - Quality settings
 * - Subtitle settings
 */

import { create } from 'zustand'

interface PlayerState {
  // State will be defined as we implement features
}

export const usePlayerStore = create<PlayerState>(() => ({
  // Initial state
}))
