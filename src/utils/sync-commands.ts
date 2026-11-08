import { invoke } from '@tauri-apps/api/core'

export type SyncState = 'idle' | 'synced' | 'syncing' | 'offline' | 'error'

export interface SyncDevice {
  id: string
  name: string
  platform: string
  /** What the peer is. */
  role: 'mac' | 'phone'
  connected: boolean
  queued: number
  lastSynced: string | null
  pairedAt: string
  itemsIn: number
  itemsOut: number
  progress: boolean
  library: boolean
  reading: boolean
  lan: string
  presence: PresenceData | null
}

export interface PresenceData {
  title?: string
  mediaId?: string
  episodeId?: string
  episodeNumber?: number
  position?: number
  duration?: number
  playing?: boolean
  kind?: 'anime' | 'manga'
}

export interface SyncStatus {
  deviceId: string
  deviceName: string
  state: SyncState
  queued: number
  error: string | null
  devices: SyncDevice[]
  conflicts: { unseen: number; byDevice: { device: string; count: number }[] }
  relay: { url: string; signedIn: boolean; email: string | null; expiresAt: number | null }
  lan: string | null
}

export interface PairingInfo {
  qr: string
  code: string
  expiresAt: number
  lan: string
  words: [string, string, string, string]
  relayUrl: string
  signedIn: boolean
}

export interface ScanResult {
  words: [string, string, string, string]
  macName: string
  lan: string
  relay: string
}

export interface DayStat {
  day: string
  watch: number
  chapters: number
}

export interface DeviceStats {
  id: string
  name: string
  self: boolean
  days: DayStat[]
}

export type PairState = {
  state: 'connecting' | 'waiting' | 'paired' | 'rejected' | 'error'
  via?: 'lan' | 'relay'
  name?: string
  code?: 'expired' | 'relay_unreachable' | 'wrong_account' | 'rejected' | 'version' | 'unauthorized' | 'unknown'
  detail?: string
}

export type RemoteAction = 'play' | 'pause' | 'toggle' | 'seek' | 'next' | 'volume' | 'skip-intro' | 'fullscreen'

export const syncStatus = () => invoke<SyncStatus>('sync_status')
export const syncStartPairing = () => invoke<PairingInfo>('sync_start_pairing')
export const syncCancelPairing = () => invoke<void>('sync_cancel_pairing')
export const syncApprovePair = (approve: boolean) => invoke<void>('sync_approve_pair', { approve })
export const syncPairScan = (payload: string) => invoke<ScanResult>('sync_pair_scan', { payload })
export const syncPairRedeem = (addr: string, code: string) => invoke<string>('sync_pair_redeem', { addr, code })
export const syncPairConnect = (name: string) => invoke<void>('sync_pair_connect', { name })
export const syncUnpair = (deviceId: string) => invoke<void>('sync_unpair', { deviceId })
export const syncSetToggles = (deviceId: string, t: { progress: boolean; library: boolean; reading: boolean }) =>
  invoke<void>('sync_set_toggles', { deviceId, ...t })
export const syncRenameDevice = (name: string) => invoke<void>('sync_rename_device', { name })
export const syncSetRelayUrl = (url: string) => invoke<void>('sync_set_relay_url', { url })
export const syncRelaySignin = () => invoke<SyncStatus['relay']>('sync_relay_signin')
export const syncRelaySignout = () => invoke<void>('sync_relay_signout')
export const syncStats = () => invoke<{ devices: DeviceStats[] }>('sync_stats')
export const syncMarkConflictsSeen = () => invoke<void>('sync_mark_conflicts_seen')
export const syncSend = (kind: 'presence' | 'handoff' | 'remote', data: unknown) =>
  invoke<number>('sync_send', { kind, data })

export const syncRemote = (action: RemoteAction, value?: number) => syncSend('remote', { action, value })

/** Short human label for the status chip / You row. */
export function syncLabel(s: Pick<SyncStatus, 'state' | 'queued' | 'devices'>): string {
  switch (s.state) {
    case 'idle':
      return 'Not paired'
    case 'synced':
      return 'Synced'
    case 'syncing':
      return `Syncing · ${s.queued} ${s.queued === 1 ? 'change' : 'changes'}`
    case 'offline':
      return s.queued > 0 ? `${s.queued} queued` : 'Offline'
    case 'error':
      return 'Sync error'
  }
}

/** Parse "otaku://pair?..." out of whatever a QR held; null when it is not ours. */
export function isPairPayload(text: string): boolean {
  return text.trim().startsWith('otaku://pair?')
}

/** "Today 9:39" style from the SQLite CURRENT_TIMESTAMP (UTC, no zone). */
export function formatSynced(ts: string | null, now = new Date()): string {
  if (!ts) return 'Never'
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return 'Never'
  const mins = Math.round((now.getTime() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString()
}
