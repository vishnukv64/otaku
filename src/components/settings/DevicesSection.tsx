import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { QRCodeSVG } from 'qrcode.react'
import { Loader2, Smartphone } from 'lucide-react'
import { SettingSection } from './SettingSection'
import { SettingRow } from './SettingRow'
import { useSyncStore } from '@/store/syncStore'
import {
  formatSynced,
  syncApprovePair,
  syncCancelPairing,
  syncRelaySignin,
  syncRelaySignout,
  syncStartPairing,
  syncUnpair,
  type PairingInfo,
} from '@/utils/sync-commands'
import { notifyError } from '@/utils/notify'

interface PairRequest {
  name: string
  platform: string
  words: string[]
}

const btn =
  'rounded-lg bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-surface-hover)] disabled:opacity-50'

/** Mac (desktop) side of Pair & sync: QR + code, approve words, linked phones with revoke. */
export function DevicesSection() {
  const { status, refresh, watch } = useSyncStore()
  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [request, setRequest] = useState<PairRequest | null>(null)
  const [left, setLeft] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => watch(), [watch])

  useEffect(() => {
    const offs: Promise<() => void>[] = [
      listen<PairRequest>('sync://pair-request', (e) => setRequest(e.payload)),
      listen('sync://pair-expired', () => {
        setPairing(null)
        setRequest(null)
      }),
      listen('sync://pair-state', () => {
        setPairing(null)
        setRequest(null)
        void refresh()
      }),
    ]
    return () => offs.forEach((p) => void p.then((f) => f()))
  }, [refresh])

  useEffect(() => {
    if (!pairing) return
    const t = setInterval(() => setLeft(Math.max(0, Math.round((pairing.expiresAt - Date.now()) / 1000))), 500)
    return () => clearInterval(t)
  }, [pairing])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      notifyError('Devices', String(e))
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const start = () =>
    run(async () => {
      const p = await syncStartPairing()
      setPairing(p)
      setLeft(Math.round((p.expiresAt - Date.now()) / 1000))
    })

  const phones = status?.devices.filter((d) => d.role === 'phone') ?? []
  const relay = status?.relay

  return (
    <SettingSection title="Devices" description="Pair a phone to sync progress, library and stats">
      <SettingRow
        label="Relay"
        description={
          relay?.signedIn
            ? `Signed in${relay.email ? ` as ${relay.email}` : ''} · ${relay.url}`
            : `Sign in to ${relay?.url ?? 'the Praxis relay'} to pair away from your Wi-Fi. LAN pairing works without it.`
        }
      >
        {relay?.signedIn ? (
          <button className={btn} onClick={() => void run(syncRelaySignout)} disabled={busy}>
            Sign out
          </button>
        ) : (
          <button className={btn} onClick={() => void run(syncRelaySignin)} disabled={busy}>
            Sign in
          </button>
        )}
      </SettingRow>

      <SettingRow label="Link a phone" description="Open Otaku on your phone → You → Pair & sync, then scan.">
        {pairing ? (
          <button className={btn} onClick={() => void syncCancelPairing().then(() => setPairing(null))}>
            Cancel
          </button>
        ) : (
          <button className={btn} onClick={() => void start()} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : 'Show QR'}
          </button>
        )}
      </SettingRow>

      {pairing && !request && (
        <div className="flex flex-wrap items-center gap-6 py-4">
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={pairing.qr} size={176} />
          </div>
          <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
            <div>Or enter on the phone:</div>
            <div className="font-mono text-3xl tracking-[0.3em] text-white" aria-label="Pairing code">
              {pairing.code}
            </div>
            <div className="font-mono text-xs">{pairing.lan || 'no LAN address'}</div>
            <div>
              Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · single use
            </div>
            {!pairing.signedIn && <div className="text-[var(--color-warning)]">Not signed in to the relay, so this works on your Wi-Fi only.</div>}
          </div>
        </div>
      )}

      {request && (
        <div className="space-y-3 py-4">
          <div className="text-sm text-white">
            <strong>{request.name || 'A phone'}</strong> wants to pair. Check these words match the phone:
          </div>
          <div className="flex gap-3 font-display text-xl font-bold text-white">
            {request.words.map((w, i) => (
              <span key={`${w}-${i}`}>{w}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              className={`${btn} !bg-[var(--color-accent-primary)]`}
              onClick={() => void run(() => syncApprovePair(true)).then(() => setRequest(null))}
            >
              Approve
            </button>
            <button className={btn} onClick={() => void run(() => syncApprovePair(false)).then(() => setRequest(null))}>
              Reject
            </button>
          </div>
        </div>
      )}

      {phones.length === 0 && (
        <div className="py-3 text-sm text-[var(--color-text-secondary)]">No phones linked yet.</div>
      )}
      {phones.map((d) => (
        <SettingRow
          key={d.id}
          label={d.name}
          description={`${d.connected ? 'Online' : 'Offline'} · synced ${formatSynced(d.lastSynced)}${d.queued ? ` · ${d.queued} queued` : ''}`}
        >
          <div className="flex items-center gap-2">
            <Smartphone size={16} className="text-[var(--color-text-muted)]" aria-hidden="true" />
            <button className={btn} onClick={() => void run(() => syncUnpair(d.id))} disabled={busy}>
              Revoke
            </button>
          </div>
        </SettingRow>
      ))}
    </SettingSection>
  )
}
