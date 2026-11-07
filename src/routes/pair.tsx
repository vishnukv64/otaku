/**
 * Pair & sync (phone only). Mock: design/files/pair.html.
 * One route, local step state: devices list -> scan/code -> verify words -> name -> connect -> ready,
 * plus device detail (toggles, unpair sheet) and the phone-as-remote screen.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { listen } from '@tauri-apps/api/event'
import jsQR from 'jsqr'
import { Camera, ChevronRight, FastForward, Pause, Play, SkipForward, Smartphone } from 'lucide-react'
import { PairMac } from '@/components/ui/OtakuIcons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { SettingToggle } from '@/components/settings/SettingToggle'
import { useSyncStore } from '@/store/syncStore'
import {
  formatSynced,
  isPairPayload,
  syncLabel,
  syncPairConnect,
  syncPairRedeem,
  syncPairScan,
  syncRemote,
  syncSetToggles,
  syncStats,
  syncUnpair,
  syncMarkConflictsSeen,
  type DeviceStats,
  type PairState,
  type ScanResult,
  type SyncDevice,
} from '@/utils/sync-commands'
import { notifyError } from '@/utils/notify'

export const Route = createFileRoute('/pair')({
  component: PairPage,
})

type Step =
  | { s: 'list' }
  | { s: 'permission' }
  | { s: 'scan'; denied?: boolean }
  | { s: 'code' }
  | { s: 'verify'; scan: ScanResult }
  | { s: 'mismatch' }
  | { s: 'name'; scan: ScanResult }
  | { s: 'connecting'; via: string; waiting: boolean }
  | { s: 'ready'; name: string }
  | { s: 'error'; code: string }
  | { s: 'detail'; id: string }
  | { s: 'remote'; id: string }

const ERRORS: Record<string, { title: string; body: string }> = {
  expired: { title: 'Code expired', body: 'Pairing codes last 2 minutes. Show a new QR on your Mac (Settings → Devices) and scan again.' },
  relay_unreachable: { title: 'Can’t reach the relay', body: 'Check your connection. If your Mac is on the same Wi-Fi, pairing works over LAN without the relay.' },
  wrong_account: { title: 'Wrong account', body: 'The relay refused this sign-in. Sign in to the same Praxis account on your Mac, then pair again.' },
  rejected: { title: 'Rejected on Mac', body: 'The pairing request was declined on your Mac.' },
  version: { title: 'Update Otaku', body: 'The Mac and phone run incompatible versions. Update Otaku on both and try again.' },
  unauthorized: { title: 'Code not valid', body: 'This pairing code was not accepted. Show a new QR on your Mac and scan again.' },
}

const card = 'overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)]'
const primaryBtn =
  'flex min-h-[48px] w-full items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-accent-primary)] px-4 text-[15px] font-semibold text-white active:opacity-80 disabled:opacity-40'
const ghostBtn =
  'flex min-h-[48px] w-full items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface)] px-4 text-[15px] font-medium text-white active:opacity-80'
const input =
  'min-h-[48px] w-full rounded-[var(--radius-lg)] border border-[var(--color-glass-border)] bg-[var(--color-bg-secondary)] px-3.5 text-[16px] text-white outline-none focus:border-[var(--color-accent-primary)]'

function Dot({ state }: { state: string }) {
  const c =
    state === 'synced'
      ? 'bg-[var(--color-success)]'
      : state === 'error'
        ? 'bg-[var(--color-accent-primary)]'
        : state === 'idle'
          ? 'bg-[var(--color-text-muted)]'
          : 'bg-[var(--color-warning)]'
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} aria-hidden="true" />
}

function Screen({ title, sub, children, onBack }: { title: string; sub?: string; children: ReactNode; onBack?: () => void }) {
  return (
    <div className="px-4 pb-10 pt-2">
      {onBack && (
        <button type="button" onClick={onBack} className="mb-2 min-h-[44px] text-[15px] text-[var(--color-accent-light)]">
          ‹ Back
        </button>
      )}
      <h1 className="font-display text-[22px] font-bold text-white">{title}</h1>
      {sub && <p className="mt-1 mb-4 text-[14px] text-[var(--color-text-secondary)]">{sub}</p>}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </div>
  )
}

function PairPage() {
  const { status, error, refresh, watch } = useSyncStore()
  const [step, setStep] = useState<Step>({ s: 'list' })

  useEffect(() => watch(), [watch])

  useEffect(() => {
    let off: (() => void) | undefined
    let dead = false
    void listen<PairState>('sync://pair-state', (e) => {
      const p = e.payload
      if (p.state === 'connecting') setStep({ s: 'connecting', via: p.via ?? 'lan', waiting: false })
      else if (p.state === 'waiting') setStep((cur) => (cur.s === 'connecting' ? { ...cur, waiting: true } : cur))
      else if (p.state === 'paired') {
        setStep({ s: 'ready', name: p.name ?? 'your Mac' })
        void refresh()
      } else setStep({ s: 'error', code: p.code ?? p.state })
    }).then((f) => (dead ? f() : (off = f)))
    return () => {
      dead = true
      off?.()
    }
  }, [refresh])

  const mac = status?.devices.find((d) => d.role === 'mac')

  switch (step.s) {
    case 'permission':
      return (
        <Screen title="Scan to pair" sub="Otaku needs your camera once, to read the QR code on your Mac." onBack={() => setStep({ s: 'list' })}>
          <div className={`${card} flex flex-col items-center gap-3 p-6 text-center`}>
            <Camera size={36} className="text-[var(--color-accent-primary)]" aria-hidden="true" />
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              The camera is used only to scan this code. Nothing is recorded or uploaded.
            </p>
          </div>
          <button className={primaryBtn} onClick={() => setStep({ s: 'scan' })}>
            Allow camera
          </button>
          <button className={ghostBtn} onClick={() => setStep({ s: 'code' })}>
            Enter code instead
          </button>
        </Screen>
      )
    case 'scan':
      return (
        <Scanner
          denied={step.denied}
          onBack={() => setStep({ s: 'list' })}
          onCode={() => setStep({ s: 'code' })}
          onDenied={() => setStep({ s: 'scan', denied: true })}
          onPayload={async (text) => {
            try {
              setStep({ s: 'verify', scan: await syncPairScan(text) })
            } catch (e) {
              notifyError('Sync', String(e))
              setStep({ s: 'error', code: 'unauthorized' })
            }
          }}
        />
      )
    case 'code':
      return (
        <CodeEntry
          onBack={() => setStep({ s: 'list' })}
          onPayload={async (text) => {
            try {
              setStep({ s: 'verify', scan: await syncPairScan(text) })
            } catch {
              setStep({ s: 'error', code: 'unauthorized' })
            }
          }}
          onFail={(code) => setStep({ s: 'error', code })}
        />
      )
    case 'verify':
      return (
        <Screen title="Do the words match?" sub={`Check these four words match the ones on ${step.scan.macName || 'your Mac'}.`}>
          <Words words={step.scan.words} />
          <button className={primaryBtn} onClick={() => setStep({ s: 'name', scan: step.scan })}>
            They match
          </button>
          <button className={ghostBtn} onClick={() => setStep({ s: 'mismatch' })}>
            They’re different
          </button>
        </Screen>
      )
    case 'mismatch':
      return (
        <Screen title="Words don’t match" sub="Someone may be intercepting the pairing. Nothing was paired. Cancel on the Mac and start again.">
          <button className={primaryBtn} onClick={() => setStep({ s: 'list' })}>
            Done
          </button>
        </Screen>
      )
    case 'name':
      return <NameStep scan={step.scan} defaultName={status?.deviceName ?? ''} onGo={() => setStep({ s: 'connecting', via: 'lan', waiting: false })} />
    case 'connecting':
      return (
        <Screen
          title={step.waiting ? 'Waiting for your Mac' : 'Connecting…'}
          sub={step.waiting ? 'Approve this phone on your Mac to finish pairing.' : `Trying ${step.via === 'lan' ? 'your Wi-Fi network' : 'the relay'}…`}
        >
          <div className="flex justify-center py-8" role="status" aria-label="Connecting">
            <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--color-surface)] border-t-[var(--color-accent-primary)]" />
          </div>
          <button className={ghostBtn} onClick={() => setStep({ s: 'list' })}>
            Cancel
          </button>
        </Screen>
      )
    case 'ready':
      return (
        <Screen title="You’re paired" sub={`Syncing with ${step.name}. Your history, library and reading progress merge in the background.`}>
          <button className={primaryBtn} onClick={() => setStep({ s: 'list' })}>
            Done
          </button>
        </Screen>
      )
    case 'error': {
      const e = ERRORS[step.code] ?? { title: 'Pairing failed', body: 'Something went wrong. Try again.' }
      return (
        <Screen title={e.title} sub={e.body}>
          <button className={primaryBtn} onClick={() => setStep({ s: 'permission' })}>
            Try again
          </button>
          <button className={ghostBtn} onClick={() => setStep({ s: 'list' })}>
            Cancel
          </button>
        </Screen>
      )
    }
    case 'detail': {
      const d = status?.devices.find((x) => x.id === step.id)
      if (!d) return <Screen title="Device removed" onBack={() => setStep({ s: 'list' })}>{null}</Screen>
      return <Detail d={d} onBack={() => setStep({ s: 'list' })} onRemote={() => setStep({ s: 'remote', id: d.id })} />
    }
    case 'remote': {
      const d = status?.devices.find((x) => x.id === step.id)
      return <Remote d={d} onBack={() => setStep({ s: 'detail', id: step.id })} />
    }
    default:
      return (
        <div className="pb-10">
          <section className="px-4 pt-2">
            <div className={`${card} flex items-center gap-3 p-4`}>
              <PairMac size={28} className="shrink-0 text-[var(--color-accent-primary)]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-white">{status?.devices.length ? 'Pair & sync' : 'Pair with your Mac'}</div>
                <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-text-muted)]">
                  {status && <Dot state={status.state} />}
                  {status ? syncLabel(status) : error ? 'Couldn’t load your devices.' : 'Loading…'}
                </div>
              </div>
            </div>
          </section>

          {error && !status && (
            <div className="px-4 pt-3">
              <button className={ghostBtn} onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}

          {status && status.state === 'error' && (
            <p className="mx-4 mt-3 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-3.5 text-[13.5px] text-[var(--color-text-secondary)]">
              {ERRORS[status.error ?? '']?.body ?? 'Can’t reach your Mac. Changes are queued and send when it is back.'}
            </p>
          )}

          {status && status.conflicts.unseen > 0 && (
            <button
              className={`${card} mx-4 mt-3 w-[calc(100%-2rem)] p-3.5 text-left`}
              onClick={() => void syncMarkConflictsSeen().then(refresh)}
            >
              <div className="text-[15px] font-semibold text-white">Synced, {status.conflicts.unseen} conflicts resolved</div>
              <div className="text-[12.5px] text-[var(--color-text-muted)]">
                Latest change wins per item; the overwritten value is kept 30 days. Tap to dismiss.
                {status.conflicts.byDevice.map((c) => ` ${c.device} kept ${c.count}.`)}
              </div>
            </button>
          )}

          <h2 className="px-[30px] pb-2 pt-[22px] text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
            Paired devices
          </h2>
          <nav className={`${card} mx-4`} aria-label="Paired devices">
            {status?.devices.map((d) => (
              <button
                key={d.id}
                onClick={() => setStep({ s: 'detail', id: d.id })}
                className="flex min-h-[56px] w-full items-center gap-3 border-b border-[var(--color-glass-border)] px-3.5 py-2.5 text-left last:border-b-0 active:bg-[var(--color-bg-hover)]"
              >
                {d.role === 'mac' ? <PairMac size={20} aria-hidden="true" className="text-white" /> : <Smartphone size={20} className="text-white" aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-white">{d.name}</span>
                  <span className="block truncate text-[12.5px] text-[var(--color-text-muted)]">
                    {d.connected ? 'Online' : 'Offline'} · synced {formatSynced(d.lastSynced)}
                    {d.queued > 0 && ` · ${d.queued} queued`}
                  </span>
                </span>
                <ChevronRight size={18} className="text-[var(--color-text-muted)]" aria-hidden="true" />
              </button>
            ))}
            {!status?.devices.length && <p className="px-3.5 py-4 text-[14px] text-[var(--color-text-secondary)]">No devices yet.</p>}
          </nav>

          <div className="mx-4 mt-4 flex flex-col gap-3">
            {!mac && (
              <button className={primaryBtn} onClick={() => setStep({ s: 'permission' })}>
                Scan QR from your Mac
              </button>
            )}
            {!mac && (
              <button className={ghostBtn} onClick={() => setStep({ s: 'code' })}>
                Enter code instead
              </button>
            )}
            {status && status.devices.length > 0 && (
              <StatsSplit />
            )}
            <Link to="/you" className="py-2 text-center text-[14px] text-[var(--color-text-muted)]">
              Back to You
            </Link>
          </div>
        </div>
      )
  }
}

function Words({ words }: { words: string[] }) {
  return (
    <div className={`${card} grid grid-cols-2 gap-3 p-5 text-center`} aria-label="Verification words">
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="font-display text-[20px] font-bold text-white">
          {w}
        </span>
      ))}
    </div>
  )
}

function NameStep({ scan, defaultName, onGo }: { scan: ScanResult; defaultName: string; onGo: () => void }) {
  const [name, setName] = useState(defaultName === 'My phone' ? '' : defaultName)
  return (
    <Screen title="Name this phone" sub={`${scan.macName || 'Your Mac'} will show this name in its linked phones.`}>
      <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Vishnu’s iPhone" maxLength={40} aria-label="Device name" />
      <button
        className={primaryBtn}
        disabled={!name.trim()}
        onClick={() =>
          void syncPairConnect(name.trim())
            .then(onGo)
            .catch((e) => notifyError('Sync', String(e)))
        }
      >
        Pair
      </button>
    </Screen>
  )
}

function CodeEntry({
  onBack,
  onPayload,
  onFail,
}: {
  onBack: () => void
  onPayload: (p: string) => void
  onFail: (code: string) => void
}) {
  const [addr, setAddr] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Screen title="Enter code" sub="Type the Mac’s address and the 6-digit code shown under the QR. Both phone and Mac need the same Wi-Fi." onBack={onBack}>
      <input className={input} inputMode="decimal" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="192.168.1.5:50123" aria-label="Mac address" autoCapitalize="off" autoCorrect="off" />
      <input
        className={`${input} text-center font-display text-[24px] tracking-[0.3em]`}
        inputMode="numeric"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        placeholder="000000"
        aria-label="6-digit code"
      />
      <button
        className={primaryBtn}
        disabled={busy || code.length !== 6 || !addr.trim()}
        onClick={() => {
          setBusy(true)
          syncPairRedeem(addr, code)
            .then(onPayload)
            .catch((e) => onFail(String(e) === 'unreachable' ? 'relay_unreachable' : 'expired'))
            .finally(() => setBusy(false))
        }}
      >
        Continue
      </button>
    </Screen>
  )
}

function Scanner({
  denied,
  onBack,
  onCode,
  onDenied,
  onPayload,
}: {
  denied?: boolean
  onBack: () => void
  onCode: () => void
  onDenied: () => void
  onPayload: (text: string) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const done = useRef(false)

  const start = useCallback(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let dead = false
    const tick = () => {
      const v = video.current
      const c = canvas.current
      if (!v || !c || dead) return
      if (v.readyState >= 2 && v.videoWidth > 0) {
        c.width = v.videoWidth
        c.height = v.videoHeight
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(v, 0, 0)
          const img = ctx.getImageData(0, 0, c.width, c.height)
          const hit = jsQR(img.data, img.width, img.height)
          if (hit && isPairPayload(hit.data) && !done.current) {
            done.current = true
            onPayload(hit.data)
            return
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (dead) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (video.current) {
          video.current.srcObject = s
          void video.current.play()
        }
        raf = requestAnimationFrame(tick)
      })
      .catch(onDenied)
    if (!navigator.mediaDevices) onDenied()
    return () => {
      dead = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onDenied, onPayload])

  useEffect(() => {
    if (denied) return
    done.current = false
    return start()
  }, [denied, start])

  if (denied)
    return (
      <Screen title="Camera access is off" sub="Allow the camera for Otaku in your phone’s Settings, or pair with the 6-digit code instead." onBack={onBack}>
        <button className={primaryBtn} onClick={onCode}>
          Enter code instead
        </button>
      </Screen>
    )

  return (
    <Screen title="Scan the QR" sub="On your Mac open Settings → Devices and show the code." onBack={onBack}>
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius-lg)] bg-black">
        <video ref={video} className="h-full w-full object-cover" playsInline muted aria-label="Camera preview" />
        <canvas ref={canvas} className="hidden" />
        <div className="pointer-events-none absolute inset-8 rounded-[var(--radius-lg)] border-2 border-white/70" />
      </div>
      <button className={ghostBtn} onClick={onCode}>
        Enter code instead
      </button>
    </Screen>
  )
}

function Row({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-[var(--color-glass-border)] px-4 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[15px] text-white">{label}</div>
        {sub && <div className="text-[12.5px] text-[var(--color-text-muted)]">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function Detail({ d, onBack, onRemote }: { d: SyncDevice; onBack: () => void; onRemote: () => void }) {
  const refresh = useSyncStore((s) => s.refresh)
  const [confirm, setConfirm] = useState(false)
  const set = (patch: Partial<Pick<SyncDevice, 'progress' | 'library' | 'reading'>>) =>
    void syncSetToggles(d.id, { progress: d.progress, library: d.library, reading: d.reading, ...patch })
      .then(refresh)
      .catch((e) => notifyError('Sync', String(e)))
  return (
    <Screen title={d.name} sub={`${d.connected ? 'Online' : 'Offline'} · synced ${formatSynced(d.lastSynced)}`} onBack={onBack}>
      <div className={card}>
        <Row label="Watch progress & history" sub={`${d.itemsIn + d.itemsOut} items exchanged`}>
          <SettingToggle value={d.progress} onChange={(v) => set({ progress: v })} />
        </Row>
        <Row label="Library & statuses">
          <SettingToggle value={d.library} onChange={(v) => set({ library: v })} />
        </Row>
        <Row label="Manga reading">
          <SettingToggle value={d.reading} onChange={(v) => set({ reading: v })} />
        </Row>
      </div>
      <div className={card}>
        <Row label="Encryption" sub="AES-256-GCM, key stays on your devices">
          <span />
        </Row>
        <Row label="Paired" sub={new Date(d.pairedAt.replace(' ', 'T') + 'Z').toLocaleDateString()}>
          <span />
        </Row>
      </div>
      {d.role === 'mac' && (
        <button className={ghostBtn} onClick={onRemote}>
          Use as remote
        </button>
      )}
      <button
        className={`${ghostBtn} !text-[var(--color-accent-light)]`}
        onClick={() => setConfirm(true)}
      >
        Unpair {d.role === 'mac' ? 'this Mac' : 'this phone'}
      </button>
      <BottomSheet
        isOpen={confirm}
        onClose={() => setConfirm(false)}
        title={`Unpair ${d.name}?`}
        footer={
          <>
            <button className={ghostBtn} onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button
              className={`${primaryBtn}`}
              onClick={() =>
                void syncUnpair(d.id)
                  .then(() => {
                    setConfirm(false)
                    onBack()
                    return refresh()
                  })
                  .catch((e) => notifyError('Sync', String(e)))
              }
            >
              Unpair
            </button>
          </>
        }
      >
        <p className="px-4 pb-4 text-[14px] text-[var(--color-text-secondary)]">
          Syncing with {d.name} stops and the room key is deleted. Your library and history stay on both devices.
          {d.queued > 0 && ` ${d.queued} queued changes will not be sent.`}
        </p>
      </BottomSheet>
    </Screen>
  )
}

function Remote({ d, onBack }: { d?: SyncDevice; onBack: () => void }) {
  const p = d?.presence
  const playing = p?.playing ?? false
  const send = (a: Parameters<typeof syncRemote>[0], v?: number) => void syncRemote(a, v).catch((e) => notifyError('Sync', String(e)))
  if (!d?.connected || !p?.title)
    return (
      <Screen title="Nothing is playing on your Mac" sub="Start an episode on the Mac, or send one from this phone." onBack={onBack}>
        {null}
      </Screen>
    )
  return (
    <Screen title={p.title} sub={`${p.episodeNumber ? `EP ${p.episodeNumber} · ` : ''}Playing on ${d.name}`} onBack={onBack}>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.round(p.duration ?? 1))}
        defaultValue={Math.round(p.position ?? 0)}
        onChange={(e) => send('seek', Number(e.target.value))}
        aria-label="Seek"
        className="w-full"
      />
      <div className="flex items-center justify-center gap-6">
        <button className="h-14 w-14 rounded-full bg-[var(--color-accent-primary)] text-white" aria-label={playing ? 'Pause' : 'Play'} onClick={() => send(playing ? 'pause' : 'play')}>
          {playing ? <Pause className="mx-auto" /> : <Play className="mx-auto" />}
        </button>
        <button className="h-12 w-12 rounded-full bg-[var(--color-surface)] text-white" aria-label="Next episode" onClick={() => send('next')}>
          <SkipForward className="mx-auto" size={20} />
        </button>
        <button className="h-12 w-12 rounded-full bg-[var(--color-surface)] text-white" aria-label="Skip intro" onClick={() => send('skip-intro')}>
          <FastForward className="mx-auto" size={20} />
        </button>
      </div>
      <input type="range" min={0} max={100} defaultValue={100} onChange={(e) => send('volume', Number(e.target.value) / 100)} aria-label="Volume" className="w-full" />
    </Screen>
  )
}

const weekAgo = () => new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)

function StatsSplit() {
  const [devices, setDevices] = useState<DeviceStats[]>([])
  useEffect(() => {
    void syncStats().then((r) => setDevices(r.devices)).catch(() => setDevices([]))
  }, [])
  const cut = weekAgo()
  const secs = devices.map((d) => ({ d, s: d.days.filter((x) => x.day >= cut).reduce((a, x) => a + x.watch, 0) }))
  const total = secs.reduce((a, x) => a + x.s, 0)
  const fmt = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  if (!devices.length) return null
  return (
    <section className={`${card} p-4`} aria-label="Combined stats">
      <div className="font-display text-[26px] font-bold text-white">{fmt(total)}</div>
      <div className="mb-3 text-[12.5px] text-[var(--color-text-muted)]">This week, all devices</div>
      {secs.map(({ d, s }) => (
        <div key={d.id} className="py-1.5">
          <div className="flex justify-between text-[14px] text-white">
            <span>{d.self ? `This phone` : d.name}</span>
            <span>{fmt(s)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface)]">
            <div className="h-full bg-[var(--color-accent-primary)]" style={{ width: `${total ? (s / total) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </section>
  )
}
