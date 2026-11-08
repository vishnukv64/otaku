import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Search, SearchX, X } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useProxiedImage } from '@/hooks/useProxiedImage'
import { searchAnime } from '@/utils/tauri-commands'
import { matchTitles, rankMatches, setProviderMatch, type ProviderMatch } from '@/utils/providerMatch'
import type { MediaDetails, SearchResult } from '@/types/extension'

interface Props {
  open: boolean
  onClose: () => void
  /** Phone: bottom sheet. Desktop: centered modal. */
  variant: 'sheet' | 'modal'
  details: MediaDetails
  mediaId: string | number
  extId: string
  providerLabel: string
  onPicked: (match: ProviderMatch) => void
  /** Offered on the no-results state. */
  onTryAnother?: () => void
}

type Status = 'loading' | 'ready' | 'error'

function audioPill(locales?: string[]) {
  if (!locales?.length) return ''
  const dub = locales.some((l) => l !== 'ja-JP')
  return locales.includes('ja-JP') ? (dub ? 'Sub · Dub' : 'Sub') : dub ? 'Dub' : ''
}

function Poster({ url }: { url?: string }) {
  const { src } = useProxiedImage(url || '')
  return (
    <div className="h-[74px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-[var(--color-bg-secondary)]">
      {src && <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />}
    </div>
  )
}

function Row({ r, checked, onSelect }: { r: SearchResult; checked: boolean; onSelect: () => void }) {
  const pills = [
    r.media_type?.toUpperCase(),
    r.year ? String(r.year) : '',
    r.available_episodes ? `${r.available_episodes} eps` : '',
    audioPill(r.audio_locales),
  ].filter(Boolean)
  const alt = r.title_synonyms?.[0]
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex min-h-24 w-full items-center gap-3 border-b border-[var(--color-glass-border)] px-4 py-2.5 text-left ${
        checked ? 'bg-[rgba(229,9,20,0.08)]' : ''
      }`}
    >
      <Poster url={r.cover_url} />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[15px] font-semibold leading-tight text-[var(--color-text-primary)]">{r.title}</div>
        {alt && alt !== r.title && <div className="mt-0.5 truncate text-[12.5px] text-[var(--color-text-secondary)]">{alt}</div>}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {pills.map((p) => (
            <span key={p} className="chip">{p}</span>
          ))}
        </div>
      </div>
      <span
        aria-hidden="true"
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${
          checked ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]' : 'border-[var(--color-glass-border-hover)]'
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
    </button>
  )
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Searching">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-2.5">
          <div className="h-[74px] w-[52px] rounded-lg bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-3/4 rounded bg-white/10" />
            <div className="h-3 w-1/2 rounded bg-white/10" />
            <div className="h-4 w-1/3 rounded bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  )
}

function Notice({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 text-[var(--color-text-muted)]">{icon}</div>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{text}</p>
      <div className="mt-4">{children}</div>
    </div>
  )
}

export function ProviderMatchPicker({
  open,
  onClose,
  variant,
  details,
  mediaId,
  extId,
  providerLabel,
  onPicked,
  onTryAnother,
}: Props) {
  const titles = matchTitles(details)
  const [query, setQuery] = useState(titles[0] ?? '')
  const [status, setStatus] = useState<Status>('loading')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const seq = useRef(0)
  // Chips/typing set `query`; a debounced copy drives the search.
  const [debounced, setDebounced] = useState(query)
  const detailsRef = useRef(details)
  detailsRef.current = details

  useEffect(() => {
    if (!open) return
    const first = matchTitles(detailsRef.current)[0] ?? ''
    setQuery(first)
    setDebounced(first)
    setSelected(null)
  }, [open])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const q = debounced.trim()
    if (!open || !q) {
      setResults([])
      setStatus('ready')
      return
    }
    const mine = ++seq.current
    setStatus('loading')
    searchAnime(extId, q, 1)
      .then((res) => {
        if (mine !== seq.current) return
        const list = res.results ?? []
        setResults(list)
        setSelected(rankMatches(detailsRef.current, list).preselectId)
        setStatus('ready')
      })
      .catch(() => {
        if (mine === seq.current) setStatus('error')
      })
  }, [open, debounced, extId, retryKey])

  const confirm = useCallback(async () => {
    const r = results.find((x) => x.id === selected)
    if (!r) return
    setSaving(true)
    try {
      const match = { id: r.id, title: r.title }
      await setProviderMatch(extId, mediaId, match)
      onPicked(match)
      onClose()
    } finally {
      setSaving(false)
    }
  }, [results, selected, extId, mediaId, onPicked, onClose])

  const { best, others } = rankMatches(details, results)
  const row = (r: SearchResult) => <Row key={r.id} r={r} checked={selected === r.id} onSelect={() => setSelected(r.id)} />
  const label = (text: string) => (
    <div className="px-4 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{text}</div>
  )

  const body = (
    <>
      <label className="mx-4 mb-2.5 mt-0.5 flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-glass-border-hover)] bg-[var(--color-surface)] px-3">
        <Search size={16} className="text-[var(--color-text-muted)]" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={`Search ${providerLabel}`}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
        />
        {query && (
          <button type="button" aria-label="Clear" onClick={() => setQuery('')} className="flex h-8 w-8 items-center justify-center">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </label>
      {titles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2.5">
          {titles.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setQuery(t)
                setDebounced(t)
              }}
              aria-pressed={query === t}
              className={`min-h-9 max-w-full truncate rounded-full border px-3.5 text-[13px] ${
                query === t ? 'border-white bg-white font-semibold text-black' : 'border-[var(--color-glass-border-hover)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {status === 'loading' && <Skeleton />}
      {status === 'error' && (
        <Notice
          icon={<AlertCircle size={36} aria-hidden="true" />}
          title={`Couldn't reach ${providerLabel}`}
          text="Check your connection and try again."
        >
          <button className="btn btn-primary min-h-11 px-5" onClick={() => setRetryKey((k) => k + 1)}>
            Retry
          </button>
        </Notice>
      )}
      {status === 'ready' && results.length === 0 && (
        <Notice
          icon={<SearchX size={36} aria-hidden="true" />}
          title={`No results on ${providerLabel}`}
          text="Try another title above, or edit the search. Some shows are not on this provider."
        >
          {onTryAnother && (
            <button
              className="btn min-h-11 px-5"
              onClick={() => {
                onClose()
                onTryAnother()
              }}
            >
              Try another provider
            </button>
          )}
        </Notice>
      )}
      {status === 'ready' && results.length > 0 && (
        <div role="radiogroup" aria-label={`${providerLabel} results`}>
          {best && label('Best match')}
          {best && row(best)}
          {others.length > 0 && label(best ? 'Other results' : 'Results')}
          {others.map(row)}
        </div>
      )}
      <p className="px-4 pb-1 pt-2.5 text-[12.5px] text-[var(--color-text-muted)]">
        Otaku remembers your pick for this show on this device.
      </p>
    </>
  )

  const footer = (
    <div className="flex gap-2.5 border-t border-[var(--color-glass-border)] px-4 pb-3 pt-3">
      <button className="btn min-h-11 flex-1" onClick={onClose}>
        Cancel
      </button>
      <button
        className="btn btn-primary min-h-11 flex-1"
        disabled={!selected || status !== 'ready' || saving}
        onClick={confirm}
      >
        Use this show
      </button>
    </div>
  )

  const title = `Find on ${providerLabel}`
  if (variant === 'sheet') {
    return (
      <BottomSheet isOpen={open} onClose={onClose} title={title} footer={footer}>
        {body}
      </BottomSheet>
    )
  }
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-[var(--color-panel)] shadow-2xl"
      >
        <div className="flex items-center justify-between py-1.5 pl-[18px] pr-2">
          <h3 className="font-display text-lg font-bold">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="inline-flex h-11 w-11 items-center justify-center rounded-full">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
        {footer}
      </div>
    </div>,
    document.body
  )
}
