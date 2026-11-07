/**
 * Phone reader sheets (mock: design/files/reader.html): Settings (every readerStore
 * setting) and Chapter list, both as BottomSheets.
 */
import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, RotateCcw, Rows3, Search } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { ReaderDouble, ReaderPagedLtr, ReaderPagedRtl, ReaderWebtoon } from '@/components/ui/OtakuIcons'
import { useReaderStore, type FitMode, type ReadingMode } from '@/store/readerStore'
import type { Chapter } from '@/types/extension'

const chip = (on: boolean) =>
  `min-h-[44px] rounded-lg px-3 text-sm ${
    on ? 'bg-[var(--color-accent-primary)] text-white' : 'bg-white/10 text-white/80'
  }`

const seg = (on: boolean) =>
  `flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-xs font-semibold ${
    on ? 'bg-[var(--color-accent-primary)] text-white' : 'bg-white/10 text-white/70'
  }`

function Head({ children }: { children: React.ReactNode }) {
  return <div className="px-[18px] pb-1.5 pt-4 text-xs font-semibold uppercase tracking-wide text-white/50">{children}</div>
}

function Row({ label, value, hint, dim, children }: { label: string; value?: React.ReactNode; hint?: string; dim?: boolean; children: React.ReactNode }) {
  return (
    <div className={`px-[18px] py-3 ${dim ? 'opacity-40' : ''}`}>
      <div className="mb-2 flex items-center justify-between text-sm text-white">
        <b className="font-semibold">{label}</b>
        <span className="text-white/60">{value}</span>
      </div>
      {children}
      {hint && <p className="mt-2 text-xs text-white/50">{hint}</p>}
    </div>
  )
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[56px] items-center justify-between gap-3 px-[18px] py-2 text-white">
      <span>
        <span className="block text-[15px] font-semibold">{label}</span>
        <span className="block text-xs text-white/50">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 accent-[var(--color-accent-primary)]"
      />
    </label>
  )
}

function Slider(p: { label: string; value: number; min: number; max: number; step: number; lo?: string; hi?: string; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <Row label={p.label} value={p.fmt(p.value)}>
      <div className="flex items-center gap-3 text-xs text-white/50">
        <span className="w-8">{p.lo}</span>
        <input
          type="range"
          aria-label={p.label}
          min={p.min}
          max={p.max}
          step={p.step}
          value={p.value}
          onChange={(e) => p.onChange(Number(e.target.value))}
          className="flex-1 accent-[var(--color-accent-primary)]"
        />
        <span className="w-8 text-right">{p.hi}</span>
      </div>
    </Row>
  )
}

const MODES: { mode: ReadingMode; label: string; sub?: string; Icon: typeof ReaderDouble }[] = [
  { mode: 'single', label: 'Page', Icon: ReaderPagedLtr },
  { mode: 'double', label: 'Double', sub: 'landscape', Icon: ReaderDouble },
  { mode: 'vertical', label: 'Vertical', Icon: Rows3 },
  { mode: 'webtoon', label: 'Webtoon', Icon: ReaderWebtoon },
]
const BACKGROUNDS = [
  { c: '#1a1a1a', label: 'Default' },
  { c: '#000000', label: 'Black' },
  { c: '#808080', label: 'Grey' },
  { c: '#ffffff', label: 'White' },
]
const FITS: { value: FitMode; label: string }[] = [
  { value: 'contain', label: 'Fit screen (default)' },
  { value: 'width', label: 'Width' },
  { value: 'height', label: 'Height' },
  { value: 'original', label: 'Original' },
]

export function MobileReaderSettings({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { settings: s, updateSettings: u, setReadingMode, setReadingDirection, setFitMode, setZoom, resetSettings } =
    useReaderStore()
  const paged = s.readingMode === 'single' || s.readingMode === 'double'
  const pct = (v: number) => `${Math.round(v * 100)}%`
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Reader settings">
      <Head>Reading</Head>
      <Row label="Reading mode">
        <div role="tablist" aria-label="Reading mode" className="flex gap-2">
          {MODES.map(({ mode, label, sub, Icon }) => (
            <button key={mode} type="button" role="tab" aria-selected={s.readingMode === mode} onClick={() => setReadingMode(mode)} className={seg(s.readingMode === mode)}>
              <Icon size={20} />
              {label}
              {sub && <small className="text-[10px] font-normal opacity-70">{sub}</small>}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Direction" value={s.readingDirection === 'ltr' ? 'Left to right' : 'Right to left'} dim={!paged} hint="Applies to Page and Double. Flips tap zones, swipe and the slider.">
        <div className="flex gap-2">
          {(['ltr', 'rtl'] as const).map((d) => (
            <button key={d} type="button" aria-selected={s.readingDirection === d} onClick={() => setReadingDirection(d)} className={seg(s.readingDirection === d)}>
              {d === 'ltr' ? <ReaderPagedLtr size={20} /> : <ReaderPagedRtl size={20} />}
              {d === 'ltr' ? 'Left to right' : 'Right to left'}
            </button>
          ))}
        </div>
      </Row>
      <Head>Page fit</Head>
      <div className="flex flex-wrap gap-2 px-[18px] py-3">
        {FITS.map((f) => (
          <button key={f.value} type="button" aria-pressed={s.fitMode === f.value} className={chip(s.fitMode === f.value)} onClick={() => setFitMode(f.value)}>
            {f.label}
          </button>
        ))}
      </div>
      <Slider label="Zoom" value={s.zoom} min={s.minZoom} max={s.maxZoom} step={0.1} lo="50%" hi="300%" fmt={pct} onChange={setZoom} />
      <Head>Display</Head>
      <Row label="Background" value={s.backgroundColor}>
        <div className="flex gap-3">
          {BACKGROUNDS.map(({ c, label }) => (
            <button
              key={c}
              type="button"
              aria-label={label}
              aria-pressed={s.backgroundColor === c}
              onClick={() => u({ backgroundColor: c })}
              className={`flex h-11 w-11 items-center justify-center rounded-full border-2 ${s.backgroundColor === c ? 'border-[var(--color-accent-primary)]' : 'border-white/20'}`}
              style={{ background: c }}
            >
              {s.backgroundColor === c && <Check size={18} className={c === '#ffffff' ? 'text-black' : 'text-white'} />}
            </button>
          ))}
        </div>
      </Row>
      <Slider label="Brightness" value={Math.round(s.brightness * 100)} min={20} max={100} step={5} fmt={(v) => `${v}%`} onChange={(v) => u({ brightness: v / 100 })} />
      <Toggle label="Show page numbers" hint="Pill while controls are hidden" value={s.showPageNumbers} onChange={(v) => u({ showPageNumbers: v })} />
      <Toggle label="Show progress bar" hint="Thin bar along the bottom edge" value={s.showProgressBar} onChange={(v) => u({ showProgressBar: v })} />
      <Head>Behaviour</Head>
      <Toggle label="Tap to navigate" hint="Side taps turn pages" value={s.tapToNavigate} onChange={(v) => u({ tapToNavigate: v })} />
      <Toggle label="Swipe to navigate" hint="Horizontal swipe in paged modes" value={s.swipeToNavigate} onChange={(v) => u({ swipeToNavigate: v })} />
      <Toggle label="Auto-advance chapter" hint="Open the next chapter after the last page" value={s.autoAdvanceChapter} onChange={(v) => u({ autoAdvanceChapter: v })} />
      <div className="flex min-h-[56px] items-center justify-between px-[18px] py-2 text-white">
        <span>
          <span className="block text-[15px] font-semibold">Preload pages</span>
          <span className="block text-xs text-white/50">Pages fetched ahead</span>
        </span>
        <span className="flex items-center gap-1">
          <button type="button" aria-label="Fewer" disabled={s.preloadPages <= 1} onClick={() => u({ preloadPages: s.preloadPages - 1 })} className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 disabled:opacity-40"><ChevronDown size={18} /></button>
          <span className="w-6 text-center tabular-nums">{s.preloadPages}</span>
          <button type="button" aria-label="More" disabled={s.preloadPages >= 10} onClick={() => u({ preloadPages: s.preloadPages + 1 })} className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 disabled:opacity-40"><ChevronUp size={18} /></button>
        </span>
      </div>
      <Slider label="Mark as read at" value={s.markReadThreshold} min={0} max={100} step={5} lo="0%" hi="100%" fmt={(v) => `${v}%`} onChange={(v) => u({ markReadThreshold: v })} />
      <div className="px-4 pb-4 pt-[18px]">
        <button type="button" onClick={resetSettings} className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-white/20 text-sm font-semibold text-white">
          <RotateCcw size={16} />
          Reset to defaults
        </button>
      </div>
    </BottomSheet>
  )
}

export function MobileChapterSheet(p: {
  isOpen: boolean
  onClose: () => void
  chapters: Chapter[]
  currentChapterId?: string
  readChapters: Set<string>
  onSelect: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const list = q
    ? p.chapters.filter((c) => `${c.number} ${c.title ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    : p.chapters
  const curNum = p.chapters.find((c) => c.id === p.currentChapterId)?.number
  return (
    <BottomSheet isOpen={p.isOpen} onClose={p.onClose} title="Chapters" maxHeight="80vh">
      <div className="mx-[18px] mb-2 flex min-h-[44px] items-center gap-2 rounded-lg bg-white/10 px-3 text-white/60">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search chapters..."
          aria-label="Search chapters"
          className="min-h-[44px] w-full bg-transparent text-sm text-white outline-none"
        />
      </div>
      {list.length === 0 && <p className="px-[18px] py-6 text-sm text-white/60">No chapters match.</p>}
      {list.map((c) => {
        const cur = c.id === p.currentChapterId
        const read = p.readChapters.has(c.id)
        const isNew = !read && !cur && curNum !== undefined && c.number > curNum
        return (
          <button
            key={c.id}
            type="button"
            aria-current={cur ? 'true' : undefined}
            onClick={() => p.onSelect(c.id)}
            className={`flex min-h-[56px] w-full items-center justify-between gap-3 border-b border-[var(--color-glass-border)] px-[18px] text-left last:border-b-0 active:bg-[var(--color-glass-bg-hover)] ${read && !cur ? 'opacity-60' : ''} ${cur ? 'bg-[var(--color-glass-bg)]' : ''}`}
          >
            <span className="min-w-0">
              <b className="block truncate text-[15px] font-semibold text-white">
                Ch. {c.number}
                {c.title ? ` - ${c.title}` : ''}
              </b>
              {c.releaseDate && <small className="block text-xs text-white/50">{c.releaseDate}</small>}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {(cur || isNew) && (
                <span className="rounded-full bg-[var(--color-accent-primary)] px-2 py-0.5 text-[11px] font-bold text-white">{cur ? 'Reading' : 'NEW'}</span>
              )}
              {read && <Check size={16} className="text-white/60" aria-label="Read" />}
            </span>
          </button>
        )
      })}
    </BottomSheet>
  )
}
