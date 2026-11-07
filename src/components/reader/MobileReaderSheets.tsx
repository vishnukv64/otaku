/**
 * Phone reader sheets (mock: design/files/reader.html): Settings (every readerStore
 * setting) and Chapter list, both as BottomSheets.
 */
import { useState } from 'react'
import { BottomSheet, SheetOption } from '@/components/ui/BottomSheet'
import { ReaderDouble, ReaderPagedLtr, ReaderPagedRtl, ReaderWebtoon } from '@/components/ui/OtakuIcons'
import { useReaderStore, type FitMode, type ReadingMode } from '@/store/readerStore'
import type { Chapter } from '@/types/extension'

const chip = (on: boolean) =>
  `min-h-[44px] flex-1 rounded-lg px-3 text-sm ${
    on ? 'bg-[var(--color-accent-primary)] text-white' : 'bg-white/10 text-white/80'
  }`

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-[18px] py-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">{label}</div>
      {children}
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[48px] items-center justify-between px-[18px] text-sm text-white">
      {label}
      <input
        type="checkbox"
        role="switch"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 accent-[var(--color-accent-primary)]"
      />
    </label>
  )
}

function Slider(p: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3 px-[18px] py-2 text-sm text-white">
      <span className="w-28 shrink-0">{p.label}</span>
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
      <span className="w-12 text-right tabular-nums">
        {p.value}
        {p.suffix}
      </span>
    </div>
  )
}

const MODES: { mode: ReadingMode; dir?: 'ltr' | 'rtl'; label: string; Icon: typeof ReaderDouble }[] = [
  { mode: 'single', dir: 'ltr', label: 'Paged', Icon: ReaderPagedLtr },
  { mode: 'single', dir: 'rtl', label: 'Paged RTL', Icon: ReaderPagedRtl },
  { mode: 'double', label: 'Double', Icon: ReaderDouble },
  { mode: 'webtoon', label: 'Webtoon', Icon: ReaderWebtoon },
]
const BACKGROUNDS = ['#000000', '#1a1a1a', '#ffffff', '#f4ecd8']
const FITS: { value: FitMode; label: string }[] = [
  { value: 'width', label: 'Width' },
  { value: 'height', label: 'Height' },
  { value: 'original', label: 'Original' },
  { value: 'contain', label: 'Fit' },
]

export function MobileReaderSettings({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { settings: s, updateSettings: u, setReadingMode, setReadingDirection, setFitMode, setZoom } =
    useReaderStore()
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Reader settings">
      <Group label="Reading mode">
        <div className="flex gap-2">
          {MODES.map(({ mode, dir, label, Icon }) => {
            const on = s.readingMode === mode && (!dir || s.readingDirection === dir)
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setReadingMode(mode)
                  if (dir) setReadingDirection(dir)
                }}
                className={`${chip(on)} flex flex-col items-center justify-center gap-1 py-2 text-xs`}
              >
                <Icon size={22} />
                {label}
              </button>
            )
          })}
        </div>
      </Group>
      <Group label="Reading direction">
        <div className="flex gap-2">
          {(['ltr', 'rtl'] as const).map((d) => (
            <button key={d} type="button" className={chip(s.readingDirection === d)} onClick={() => setReadingDirection(d)}>
              {d === 'ltr' ? 'Left to right' : 'Right to left'}
            </button>
          ))}
        </div>
      </Group>
      <Group label="Page fit">
        <div className="flex gap-2">
          {FITS.map((f) => (
            <button key={f.value} type="button" className={chip(s.fitMode === f.value)} onClick={() => setFitMode(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      </Group>
      <Group label="Background">
        <div className="flex gap-3">
          {BACKGROUNDS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Background ${c}`}
              aria-pressed={s.backgroundColor === c}
              onClick={() => u({ backgroundColor: c })}
              className={`h-11 w-11 rounded-full border-2 ${s.backgroundColor === c ? 'border-[var(--color-accent-primary)]' : 'border-white/20'}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </Group>
      <Slider label="Zoom" value={s.zoom} min={s.minZoom} max={s.maxZoom} step={0.1} suffix="×" onChange={setZoom} />
      <Slider label="Brightness" value={Math.round(s.brightness * 100)} min={20} max={100} step={5} suffix="%" onChange={(v) => u({ brightness: v / 100 })} />
      <Slider label="Preload pages" value={s.preloadPages} min={1} max={10} step={1} onChange={(v) => u({ preloadPages: v })} />
      <Slider label="Mark read at" value={s.markReadThreshold} min={50} max={100} step={5} suffix="%" onChange={(v) => u({ markReadThreshold: v })} />
      <Toggle label="Page numbers" value={s.showPageNumbers} onChange={(v) => u({ showPageNumbers: v })} />
      <Toggle label="Progress bar" value={s.showProgressBar} onChange={(v) => u({ showProgressBar: v })} />
      <Toggle label="Auto-advance chapter" value={s.autoAdvanceChapter} onChange={(v) => u({ autoAdvanceChapter: v })} />
      <Toggle label="Tap to turn pages" value={s.tapToNavigate} onChange={(v) => u({ tapToNavigate: v })} />
      <Toggle label="Swipe to turn pages" value={s.swipeToNavigate} onChange={(v) => u({ swipeToNavigate: v })} />
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
  return (
    <BottomSheet isOpen={p.isOpen} onClose={p.onClose} title="Chapters">
      <div className="px-[18px] pb-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search chapters"
          aria-label="Search chapters"
          className="min-h-[44px] w-full rounded-lg bg-white/10 px-3 text-sm text-white outline-none"
        />
      </div>
      {list.length === 0 && <p className="px-[18px] py-6 text-sm text-white/60">No chapters match.</p>}
      {list.map((c) => (
        <SheetOption
          key={c.id}
          checked={c.id === p.currentChapterId}
          detail={p.readChapters.has(c.id) ? 'Read' : undefined}
          onClick={() => p.onSelect(c.id)}
        >
          Ch. {c.number}
          {c.title ? ` · ${c.title}` : ''}
        </SheetOption>
      ))}
    </BottomSheet>
  )
}
