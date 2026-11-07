import { create } from 'zustand'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { syncStatus, type SyncStatus } from '@/utils/sync-commands'

interface SyncStore {
  status: SyncStatus | null
  error: string | null
  refresh: () => Promise<void>
  /** Subscribe to engine events; returns the unsubscribe. Call once from a mounted component. */
  watch: () => () => void
}

export const useSyncStore = create<SyncStore>((set, get) => ({
  status: null,
  error: null,
  refresh: async () => {
    try {
      set({ status: await syncStatus(), error: null })
    } catch (e) {
      set({ error: String(e) })
    }
  },
  watch: () => {
    void get().refresh()
    let off: UnlistenFn[] = []
    let dead = false
    void Promise.all(
      ['sync://status', 'sync://applied', 'sync://unpaired', 'sync://pair-state'].map((ev) =>
        listen(ev, () => void get().refresh())
      )
    ).then((fns) => {
      if (dead) fns.forEach((f) => f())
      else off = fns
    })
    const poll = setInterval(() => void get().refresh(), 15000)
    return () => {
      dead = true
      clearInterval(poll)
      off.forEach((f) => f())
    }
  },
}))
