/**
 * Phone control layer for VideoPlayer (mock: design/files/player.html).
 * Owns only UI state (visibility, lock, menus, HUD); playback stays in VideoPlayer.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Captions,
  ChevronRight,
  Download,
  Gauge,
  List,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Cast,
  Play,
  Settings,
  SkipForward,
  Sun,
  Volume2,
} from 'lucide-react'
import { BottomSheet, SheetOption } from '@/components/ui/BottomSheet'
import { LockControls, SeekBack10, SeekFwd10 } from '@/components/ui/OtakuIcons'
import { SEEK_STEP, usePlayerGestures } from '@/hooks/usePlayerGestures'
import type { SubtitleFontFamily } from '@/store/playerStore'

export type PlayerMenu = 'settings' | 'quality' | 'server' | 'audio' | 'subs' | 'speed' | 'episodes' | 'tracks'

interface EpisodeLite {
  id: string
  number: number
  title?: string
}

export interface MobilePlayerControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  title?: string
  episodeLabel: string
  isPlaying: boolean
  currentTime: number
  duration: number
  bufferedPercentage: number
  landscape: boolean
  isFullscreen: boolean
  disableSeeking: boolean
  /** Hide the controls while an overlay (error, next episode) owns the screen. */
  suspended: boolean
  togglePlay: () => void
  seekTo: (t: number) => void
  skipBy: (direction: 'forward' | 'backward') => void
  toggleFullscreen: () => void
  onBack?: () => void
  qualities: string[]
  selectedQuality: string
  onQuality: (q: string) => void
  servers: string[]
  selectedServer: number
  onServer: (i: number) => void
  audioModes: string[]
  audioMode: string
  onAudio: (m: 'sub' | 'dub') => void
  subtitleTracks: { url: string; label: string }[]
  selectedSubtitleUrl: string
  onSubtitle: (url: string) => void
  subtitleFontScale: number
  subtitleFontFamily: SubtitleFontFamily
  onSubtitleStyle: (s: { subtitleFontScale?: number; subtitleFontFamily?: SubtitleFontFamily }) => void
  speeds: number[]
  speed: number
  onSpeed: (s: number) => void
  hasNext: boolean
  onNext: () => void
  episodes?: EpisodeLite[]
  currentEpisode?: number
  onEpisodeSelect?: (id: string) => void
  showSkipIntro: boolean
  onSkipIntro: () => void
  /** Opens the Download sheet owned by the route/player. */
  onDownload?: () => void
  /** Saved position the player resumed from (seconds); shows a "Start over" chip. */
  resumedAt?: number
  offline?: boolean
}

const FONT_LABELS: Record<SubtitleFontFamily, string> = {
  system: 'System',
  inter: 'Inter',
  display: 'Display',
  mono: 'Mono',
  serif: 'Serif',
}
const HIDE_MS = 3500

function applyVolume(video: HTMLVideoElement | null, v: number) {
  if (!video) return
  video.muted = false
  video.volume = v
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

const iconBtn =
  'pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full text-white active:bg-white/15'

export function MobilePlayerControls(p: MobilePlayerControlsProps) {
  const [visible, setVisible] = useState(true)
  const [locked, setLocked] = useState(false)
  const [showUnlock, setShowUnlock] = useState(false)
  const [menu, setMenu] = useState<PlayerMenu | null>(null)
  const [brightness, setBrightness] = useState(1)
  const [hud, setHud] = useState<{ kind: 'volume' | 'brightness'; value: number } | null>(null)
  const [ripple, setRipple] = useState<{ side: 'left' | 'right'; amount: number } | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const hideTimer = useRef<number | null>(null)
  const hudTimer = useRef<number | null>(null)
  const rippleTimer = useRef<number | null>(null)
  const [resumeChip, setResumeChip] = useState(() => (p.resumedAt ?? 0) > 5)
  useEffect(() => {
    if (!resumeChip) return
    const t = window.setTimeout(() => setResumeChip(false), 6000)
    return () => window.clearTimeout(t)
  }, [resumeChip])
  const pRef = useRef(p)
  useEffect(() => {
    pRef.current = p
  })

  const armHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (pRef.current.isPlaying) setVisible(false)
    }, HIDE_MS)
  }, [])
  const reveal = useCallback(() => {
    setVisible(true)
    armHide()
  }, [armHide])

  useEffect(() => {
    if (menu) {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    } else if (p.isPlaying) armHide()
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [p.isPlaying, menu, armHide])

  useEffect(
    () => () => {
      for (const t of [hudTimer, rippleTimer]) if (t.current) window.clearTimeout(t.current)
    },
    []
  )

  const flashHud = (kind: 'volume' | 'brightness', value: number) => {
    setHud({ kind, value })
    if (hudTimer.current) window.clearTimeout(hudTimer.current)
    hudTimer.current = window.setTimeout(() => setHud(null), 900)
  }

  const gestures = usePlayerGestures({
    disabled: locked || p.suspended,
    read: () => ({
      time: p.videoRef.current?.currentTime ?? 0,
      duration: p.duration,
      volume: p.videoRef.current?.volume ?? 1,
      brightness,
    }),
    onToggleControls: () => (visible ? setVisible(false) : reveal()),
    onSeekBy: (delta) => {
      if (p.disableSeeking) return
      p.skipBy(delta > 0 ? 'forward' : 'backward')
      setRipple((r) => {
        const side = delta > 0 ? 'right' : 'left'
        return { side, amount: r?.side === side ? r.amount + SEEK_STEP : SEEK_STEP }
      })
      if (rippleTimer.current) window.clearTimeout(rippleTimer.current)
      rippleTimer.current = window.setTimeout(() => setRipple(null), 700)
    },
    onVolume: (v) => {
      applyVolume(p.videoRef.current, v)
      flashHud('volume', v)
    },
    onBrightness: (v) => {
      setBrightness(Math.max(0.2, v))
      flashHud('brightness', v)
    },
    onScrub: (time, commit) => {
      if (p.disableSeeking) return
      setScrub(commit ? null : time)
      if (commit && time !== null) p.seekTo(time)
    },
  })

  const close = () => setMenu(null)
  const pick = (fn: () => void) => () => {
    fn()
    close()
  }
  const shown = (visible || !p.isPlaying || !!menu) && !p.suspended
  const shownTime = scrub ?? p.currentTime
  const pct = p.duration > 0 ? (shownTime / p.duration) * 100 : 0

  // ── Menu bodies (shared by sheet and side panel) ────────────────────────
  const row = (label: string, detail: string, to: PlayerMenu, icon: React.ReactNode) => (
    <SheetOption key={to} icon={icon} detail={<ChevronRightDetail text={detail} />} onClick={() => setMenu(to)}>
      {label}
    </SheetOption>
  )
  const menuTitle: Record<PlayerMenu, string> = {
    settings: 'Settings',
    quality: 'Quality',
    server: 'Server',
    audio: 'Audio',
    subs: 'Subtitles',
    speed: 'Playback speed',
    episodes: 'Episodes',
    tracks: 'Audio & subtitles',
  }
  const audioBody = p.audioModes.map((m) => (
    <SheetOption key={m} checked={m === p.audioMode} onClick={pick(() => p.onAudio(m as 'sub' | 'dub'))}>
      {m === 'dub' ? 'Dub' : 'Sub'}
    </SheetOption>
  ))
  const subsList = (
    <>
      <SheetOption checked={p.selectedSubtitleUrl === 'off'} onClick={pick(() => p.onSubtitle('off'))}>
        Off
      </SheetOption>
      {p.subtitleTracks.map((t) => (
        <SheetOption key={t.url} checked={t.url === p.selectedSubtitleUrl} onClick={pick(() => p.onSubtitle(t.url))}>
          {t.label}
        </SheetOption>
      ))}
    </>
  )
  const subsStyle = (
    <>
      <div className="px-[18px] py-3 text-xs font-semibold uppercase tracking-wide text-white/50">Subtitle style</div>
      <div className="flex items-center gap-3 px-[18px] pb-3 text-sm text-white">
        <span className="w-12">Size</span>
        <input
          type="range"
          min={75}
          max={200}
          step={5}
          value={p.subtitleFontScale}
          onChange={(e) => p.onSubtitleStyle({ subtitleFontScale: Number(e.target.value) })}
          className="flex-1 accent-[var(--color-accent-primary)]"
          aria-label="Subtitle size"
        />
        <span className="w-10 text-right tabular-nums">{p.subtitleFontScale}%</span>
      </div>
      <div className="flex flex-wrap gap-2 px-[18px] pb-4">
        {(Object.keys(FONT_LABELS) as SubtitleFontFamily[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => p.onSubtitleStyle({ subtitleFontFamily: f })}
            className={`min-h-[40px] rounded-full px-4 text-sm ${
              f === p.subtitleFontFamily ? 'bg-[var(--color-accent-primary)] text-white' : 'bg-white/10 text-white/80'
            }`}
          >
            {FONT_LABELS[f]}
          </button>
        ))}
      </div>
    </>
  )
  // Picture-in-Picture / AirPlay: WebKit (iOS) first, standard API otherwise; hidden when unsupported.
  type WebkitVideo = HTMLVideoElement & {
    webkitSupportsPresentationMode?: (m: string) => boolean
    webkitSetPresentationMode?: (m: string) => void
    webkitPresentationMode?: string
    webkitShowPlaybackTargetPicker?: () => void
  }
  const wk = p.videoRef.current as WebkitVideo | null
  const canPip = !!wk && (!!wk.webkitSupportsPresentationMode?.('picture-in-picture') || document.pictureInPictureEnabled === true)
  const canAirPlay = !!wk?.webkitShowPlaybackTargetPicker
  const togglePip = () => {
    const v = p.videoRef.current as WebkitVideo | null
    if (!v) return
    if (v.webkitSetPresentationMode) {
      v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture')
    } else if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => {})
    } else {
      void v.requestPictureInPicture().catch(() => {})
    }
  }
  let body: React.ReactNode = null
  if (menu === 'settings') {
    const subLabel =
      p.selectedSubtitleUrl === 'off'
        ? 'Off'
        : (p.subtitleTracks.find((t) => t.url === p.selectedSubtitleUrl)?.label ?? 'On')
    body = (
      <>
        {row('Quality', p.selectedQuality, 'quality', <Settings size={20} />)}
        {p.servers.length > 0 && row('Server', p.servers[p.selectedServer] ?? '', 'server', <Download size={20} />)}
        {p.audioModes.length > 1 && row('Audio', p.audioMode.toUpperCase(), 'audio', <Volume2 size={20} />)}
        {row('Subtitles', subLabel, 'subs', <Captions size={20} />)}
        {row('Playback speed', `${p.speed}×`, 'speed', <Gauge size={20} />)}
      </>
    )
  } else if (menu === 'quality') {
    body = p.qualities.map((q) => (
      <SheetOption key={q} checked={q === p.selectedQuality} onClick={pick(() => p.onQuality(q))}>
        {q}
      </SheetOption>
    ))
  } else if (menu === 'server') {
    body = p.servers.map((s, i) => (
      <SheetOption key={s} checked={i === p.selectedServer} onClick={pick(() => p.onServer(i))}>
        {s}
      </SheetOption>
    ))
  } else if (menu === 'audio') {
    body = audioBody
  } else if (menu === 'tracks') {
    body = (
      <>
        {p.audioModes.length > 1 && (
          <>
            <div className="px-[18px] py-3 text-xs font-semibold uppercase tracking-wide text-white/50">Audio</div>
            {audioBody}
            <div className="px-[18px] py-3 text-xs font-semibold uppercase tracking-wide text-white/50">Subtitles</div>
          </>
        )}
        {subsList}
      </>
    )
  } else if (menu === 'subs') {
    body = (
      <>
        {subsList}
        {subsStyle}
      </>
    )
  } else if (menu === 'speed') {
    body = p.speeds.map((s) => (
      <SheetOption key={s} checked={s === p.speed} onClick={pick(() => p.onSpeed(s))}>
        {s === 1 ? 'Normal' : `${s}×`}
      </SheetOption>
    ))
  } else if (menu === 'episodes') {
    body = (p.episodes ?? []).map((ep) => (
      <SheetOption
        key={ep.id}
        checked={ep.number === p.currentEpisode}
        onClick={pick(() => p.onEpisodeSelect?.(ep.id))}
      >
        EP {ep.number}
        {ep.title ? ` · ${ep.title}` : ''}
      </SheetOption>
    ))
  }

  const sheetHeader = menu && menu !== 'settings' && menu !== 'episodes' && (
    <button
      type="button"
      onClick={() => setMenu('settings')}
      className="flex min-h-[44px] items-center gap-2 px-[18px] text-sm text-white/60"
    >
      <ArrowLeft size={16} /> Settings
    </button>
  )

  if (locked) {
    return (
      <div
        className="absolute inset-0 z-20"
        onClick={(e) => {
          e.stopPropagation()
          setShowUnlock(true)
          window.setTimeout(() => setShowUnlock(false), 2500)
        }}
      >
        {showUnlock && (
          <button
            type="button"
            aria-label="Unlock controls"
            onClick={(e) => {
              e.stopPropagation()
              setLocked(false)
              setShowUnlock(false)
              reveal()
            }}
            className="absolute left-1/2 top-1/2 flex h-14 -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-black/70 px-6 text-white"
          >
            <LockControls size={22} /> Unlock
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="absolute inset-0 z-20 select-none" onClick={(e) => e.stopPropagation()}>
      {/* Brightness: CSS filter over the picture */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backdropFilter: `brightness(${brightness})`, WebkitBackdropFilter: `brightness(${brightness})` }}
      />

      {/* Gesture surface */}
      <div
        className="absolute inset-0 touch-none"
        {...gestures}
        role="presentation"
        data-testid="player-gestures"
      />

      {ripple && (
        <div
          className={`pointer-events-none absolute top-0 bottom-0 flex w-[38%] items-center justify-center bg-white/10 ${
            ripple.side === 'left' ? 'left-0 rounded-r-[100%]' : 'right-0 rounded-l-[100%]'
          }`}
        >
          <div className="flex flex-col items-center text-white">
            {ripple.side === 'left' ? <SeekBack10 size={32} /> : <SeekFwd10 size={32} />}
            <span className="text-sm font-semibold">{ripple.amount}s</span>
          </div>
        </div>
      )}

      {hud && (
        <div className="pointer-events-none absolute left-1/2 top-6 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-white">
          {hud.kind === 'volume' ? <Volume2 size={18} /> : <Sun size={18} />}
          <div className="h-1 w-24 rounded bg-white/25">
            <div className="h-full rounded bg-white" style={{ width: `${Math.round(hud.value * 100)}%` }} />
          </div>
          <span className="w-9 text-right text-xs tabular-nums">{Math.round(hud.value * 100)}%</span>
        </div>
      )}

      {scrub !== null && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/70 px-4 py-2 text-lg font-semibold tabular-nums text-white">
          {fmt(scrub)} <span className="text-white/50">/ {fmt(p.duration)}</span>
        </div>
      )}

      {resumeChip && !p.suspended && (
        <div className="pointer-events-auto absolute bottom-24 left-4 z-10 flex items-center gap-3 rounded-full bg-black/75 py-1 pl-4 pr-1 text-sm text-white">
          Resumed at {fmt(p.resumedAt ?? 0)}
          <button
            type="button"
            className="min-h-[40px] rounded-full bg-white/15 px-4 font-semibold"
            onClick={() => {
              p.seekTo(0)
              setResumeChip(false)
            }}
          >
            Start over
          </button>
        </div>
      )}
      {p.offline && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80">
          Downloaded · offline
        </div>
      )}

      {/* Controls */}
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden={!shown}
      >
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/75 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/80 to-transparent" />

        {/* Top bar */}
        <div
          className="absolute inset-x-0 top-0 flex items-center gap-1 px-2"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 4px)' }}
        >
          <button type="button" aria-label="Back" className={iconBtn} onClick={shown ? p.onBack : undefined}>
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0 flex-1 px-1">
            <div className="truncate text-sm font-semibold text-white">{p.title}</div>
            <div className="truncate text-xs text-white/70">{p.episodeLabel}</div>
          </div>
          {p.onDownload && !p.landscape && (
            <button type="button" aria-label="Download" className={iconBtn} onClick={p.onDownload}>
              <Download size={20} />
            </button>
          )}
          <button type="button" aria-label="Settings" className={iconBtn} onClick={() => setMenu('settings')}>
            <Settings size={22} />
          </button>
        </div>

        {/* Centre */}
        <div className="absolute inset-0 flex items-center justify-center gap-10">
          {!p.disableSeeking && (
            <button type="button" aria-label="Back 10 seconds" className={`${iconBtn} h-14 w-14`} onClick={() => p.skipBy('backward')}>
              <SeekBack10 size={34} />
            </button>
          )}
          <button
            type="button"
            aria-label={p.isPlaying ? 'Pause' : 'Play'}
            className={`${iconBtn} h-16 w-16 bg-black/50`}
            onClick={p.togglePlay}
          >
            {p.isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />}
          </button>
          {!p.disableSeeking && (
            <button type="button" aria-label="Forward 10 seconds" className={`${iconBtn} h-14 w-14`} onClick={() => p.skipBy('forward')}>
              <SeekFwd10 size={34} />
            </button>
          )}
        </div>

        {p.showSkipIntro && !p.disableSeeking && (
          <button
            type="button"
            onClick={p.onSkipIntro}
            className="pointer-events-auto absolute bottom-24 right-4 min-h-[44px] rounded-lg border border-white/30 bg-black/60 px-5 text-sm font-semibold text-white"
          >
            Skip Intro
          </button>
        )}

        {/* Bottom bar */}
        <div
          className="absolute inset-x-0 bottom-0 px-3"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
        >
          <div className="flex items-center gap-3 text-xs tabular-nums text-white">
            <span className="w-11 text-right">{fmt(shownTime)}</span>
            <div className="pointer-events-auto relative h-6 flex-1">
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-white/25">
                <div className="absolute inset-y-0 left-0 rounded bg-white/35" style={{ width: `${p.bufferedPercentage}%` }} />
                <div className="absolute inset-y-0 left-0 rounded bg-[var(--color-accent-primary)]" style={{ width: `${pct}%` }} />
              </div>
              <input
                type="range"
                aria-label="Seek"
                min={0}
                max={p.duration || 0}
                step={0.1}
                value={shownTime}
                disabled={p.disableSeeking || !p.duration}
                onChange={(e) => {
                  setScrub(Number(e.target.value))
                  armHide()
                }}
                onPointerUp={(e) => {
                  p.seekTo(Number((e.target as HTMLInputElement).value))
                  setScrub(null)
                }}
                onKeyUp={(e) => {
                  p.seekTo(Number((e.target as HTMLInputElement).value))
                  setScrub(null)
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <div
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent-primary)]"
                style={{ left: `${pct}%` }}
              />
            </div>
            <span className="w-11">-{fmt(Math.max(0, p.duration - shownTime))}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <div className="flex items-center">
              {!p.landscape && (
                <button type="button" className="pointer-events-auto flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-sm text-white active:bg-white/15" onClick={() => setMenu('tracks')}>
                  <Captions size={20} /> Audio &amp; subs
                </button>
              )}
              {p.landscape && (
                <>
                  <button type="button" className="pointer-events-auto flex min-h-[44px] items-center gap-1 rounded-full px-3 text-sm text-white active:bg-white/15" onClick={() => setMenu('quality')}>
                    {p.selectedQuality}
                  </button>
                  <button type="button" aria-label="Audio and subtitles" className={iconBtn} onClick={() => setMenu('tracks')}>
                    <Captions size={22} />
                  </button>
                  {p.episodes && p.episodes.length > 1 && (
                    <button type="button" aria-label="Episodes" className={iconBtn} onClick={() => setMenu('episodes')}>
                      <List size={22} />
                    </button>
                  )}
                  {p.hasNext && (
                    <button type="button" aria-label="Next episode" className={iconBtn} onClick={p.onNext}>
                      <SkipForward size={22} />
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center">
              {canAirPlay && (
                <button type="button" aria-label="AirPlay" className={iconBtn} onClick={() => wk?.webkitShowPlaybackTargetPicker?.()}>
                  <Cast size={22} />
                </button>
              )}
              {canPip && (
                <button type="button" aria-label="Picture in picture" className={iconBtn} onClick={togglePip}>
                  <PictureInPicture2 size={22} />
                </button>
              )}
              <button type="button" aria-label="Lock controls" className={iconBtn} onClick={() => setLocked(true)}>
                <LockControls size={22} />
              </button>
              <button
                type="button"
                aria-label={p.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                className={iconBtn}
                onClick={p.toggleFullscreen}
              >
                {p.isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Menus: right side panel in landscape, bottom sheet in portrait */}
      {menu && p.landscape && (
        <div className="pointer-events-auto absolute inset-y-0 right-0 z-30 flex w-[min(340px,60%)] flex-col bg-[rgba(20,20,20,0.96)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-[18px] py-3">
            <span className="text-base font-semibold text-white">{menuTitle[menu]}</span>
            <button type="button" aria-label="Close" className="h-11 w-11 text-white/70" onClick={close}>
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {sheetHeader}
            {body}
          </div>
        </div>
      )}
      {!p.landscape && (
        <BottomSheet isOpen={!!menu} onClose={close} title={menu ? menuTitle[menu] : undefined}>
          {sheetHeader}
          {body}
        </BottomSheet>
      )}
    </div>
  )
}

function ChevronRightDetail({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1">
      {text}
      <ChevronRight size={16} />
    </span>
  )
}
