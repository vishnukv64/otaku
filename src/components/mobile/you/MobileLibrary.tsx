/**
 * Phone Library (design/files/library.html). State and data loading stay in
 * routes/library.tsx; this renders it: segmented Anime|Manga, status chips,
 * tag chips, Sort/View sheet, grid/list, long-press selection, bulk bar, tag sheets.
 */
import { displayTitle } from '@/utils/mediaHelpers'
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Check, Download, Pencil, Plus, SlidersHorizontal, Tags, Trash2, Tv, BookOpen, X } from 'lucide-react'
import { BottomSheet, SheetOption } from '@/components/ui/BottomSheet'
import {
  assignLibraryTag,
  bulkRemoveFromLibrary,
  bulkUpdateLibraryStatus,
  createLibraryTag,
  deleteLibraryTag,
  unassignLibraryTag,
  updateLibraryTag,
  type DownloadedMangaWithMedia,
  type DownloadWithMedia,
  type LibraryEntryWithMedia,
  type LibraryStatus,
  type LibraryTagWithCount,
} from '@/utils/tauri-commands'
import { notifyError, notifySuccess } from '@/utils/notify'
import { useProxiedImage } from '@/hooks/useProxiedImage'
import { useSettingsStore } from '@/store/settingsStore'
import { ChipRow, ConfirmSheet, EmptyState, ErrorState, formatBytes, Segmented, Spinner, useLongPress } from './ui'

type Tab = LibraryStatus | 'all' | 'downloaded'
export type LibrarySort = 'added' | 'updated' | 'title' | 'score'
const SORTS: { id: LibrarySort; label: string }[] = [
  { id: 'added', label: 'Recently added' },
  { id: 'updated', label: 'Recently updated' },
  { id: 'title', label: 'Title A–Z' },
  { id: 'score', label: 'Score' },
]
const DENSITIES = ['compact', 'comfortable', 'spacious'] as const
const TAG_COLORS = ['#6366f1', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b']

/** Pure sort so it can be unit tested. */
export function sortLibrary(items: LibraryEntryWithMedia[], sort: LibrarySort): LibraryEntryWithMedia[] {
  const by: Record<LibrarySort, (a: LibraryEntryWithMedia, b: LibraryEntryWithMedia) => number> = {
    added: (a, b) => b.library_entry.added_at.localeCompare(a.library_entry.added_at),
    updated: (a, b) => b.library_entry.updated_at.localeCompare(a.library_entry.updated_at),
    title: (a, b) => displayTitle(a.media).localeCompare(displayTitle(b.media)),
    score: (a, b) => (b.library_entry.score ?? -1) - (a.library_entry.score ?? -1),
  }
  return [...items].sort(by[sort])
}

const statusLabel = (s: string) =>
  s === 'plan_to_watch' || s === 'plan_to_read' ? 'Plan' : s === 'on_hold' ? 'On Hold' : s.charAt(0).toUpperCase() + s.slice(1)

export interface MobileLibraryProps {
  mediaFilter: 'anime' | 'manga'
  setMediaFilter: (m: 'anime' | 'manga') => void
  tabs: { id: Tab; label: string }[]
  activeTab: Tab
  setActiveTab: (t: Tab) => void
  library: LibraryEntryWithMedia[]
  downloadedAnime: DownloadWithMedia[]
  downloadedManga: DownloadedMangaWithMedia[]
  loading: boolean
  error: string | null
  onRetry: () => void
  tags: LibraryTagWithCount[]
  selectedTagId: number | null
  onSelectTag: (id: number | null) => void
  reloadTags: () => Promise<void>
  reload: () => Promise<void>
  selectionMode: boolean
  setSelectionMode: (b: boolean) => void
  selectedItems: Set<string>
  toggleItem: (id: string) => void
  selectAll: () => void
  clearSelection: () => void
  onOpen: (e: LibraryEntryWithMedia) => void
  onOpenDownloaded: (e: DownloadWithMedia) => void
  onOpenDownloadedManga: (e: DownloadedMangaWithMedia) => void
}

function Cover({ url, title, className = '' }: { url?: string | null; title: string; className?: string }) {
  const { src } = useProxiedImage(url || '')
  return src ? (
    <img src={src} alt={title} loading="lazy" className={`h-full w-full object-cover ${className}`} />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-[var(--color-bg-secondary)] p-1 text-center text-[10px] text-[var(--color-text-muted)]">{title}</div>
  )
}

function Item({
  title,
  cover,
  badge,
  sub,
  right,
  list,
  selected,
  selecting,
  onClick,
  onLong,
}: {
  title: string
  cover?: string | null
  badge?: string
  sub?: string
  right?: string
  list: boolean
  selected: boolean
  selecting: boolean
  onClick: () => void
  onLong?: () => void
}) {
  const lp = useLongPress(() => onLong?.())
  const check = selecting && (
    <span className={`absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 ${selected ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]' : 'border-white/70 bg-black/50'}`}>
      {selected && <Check size={14} className="text-white" aria-hidden="true" />}
    </span>
  )
  const ring = selected ? 'ring-2 ring-[var(--color-accent-primary)]' : ''
  if (list)
    return (
      <button type="button" onClick={onClick} {...(onLong ? lp : {})} aria-pressed={selecting ? selected : undefined} className={`flex min-h-[72px] w-full items-center gap-3 rounded-[var(--radius-lg)] p-2 text-left active:bg-[var(--color-glass-bg-hover)] ${selected ? 'bg-[var(--color-glass-bg)]' : ''}`}>
        <span className={`relative h-[68px] w-12 shrink-0 overflow-hidden rounded-md ${ring}`}>
          <Cover url={cover} title={title} />
          {check}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] font-medium text-white">{title}</span>
          {sub && <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">{sub}</span>}
        </span>
        {(badge || right) && <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">{badge ?? right}</span>}
      </button>
    )
  return (
    <button type="button" onClick={onClick} {...(onLong ? lp : {})} aria-pressed={selecting ? selected : undefined} className="min-w-0 text-left">
      <span className={`relative block aspect-[2/3] overflow-hidden rounded-[var(--radius-md)] ${ring}`}>
        <Cover url={cover} title={title} />
        {badge && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">{badge}</span>}
        {right && <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">{right}</span>}
        {check}
      </span>
      <span className="mt-1 line-clamp-2 text-[12.5px] leading-tight text-[var(--color-text-secondary)]">{title}</span>
    </button>
  )
}

export function MobileLibrary(p: MobileLibraryProps) {
  const navigate = useNavigate()
  const density = useSettingsStore((s) => s.gridDensity)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [sort, setSort] = useState<LibrarySort>('added')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [sheet, setSheet] = useState<null | 'sort' | 'tagFilter' | 'tagManager' | 'status' | 'bulkTags' | 'confirmRemove'>(null)

  const downloaded = p.activeTab === 'downloaded'
  const items = useMemo(() => sortLibrary(p.library, sort), [p.library, sort])
  const cols = { compact: 'grid-cols-3 gap-2', comfortable: 'grid-cols-2 gap-3', spacious: 'grid-cols-2 gap-4' }[density]
  const tabCount = (id: Tab) =>
    id === 'downloaded' ? (p.mediaFilter === 'manga' ? p.downloadedManga.length : p.downloadedAnime.length) : id === 'all' ? p.library.length : p.library.filter((e) => e.library_entry.status === id).length
  const tabLabel = p.tabs.find((t) => t.id === p.activeTab)?.label ?? ''
  const selectedTag = p.tags.find((t) => t.tag.id === p.selectedTagId)

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn()
      notifySuccess('Library', ok)
      await p.reload()
      await p.reloadTags()
    } catch (e) {
      notifyError('Error', e instanceof Error ? e.message : 'Action failed')
    }
  }
  const ids = [...p.selectedItems]

  const body = () => {
    if (p.loading) return <Spinner label="Loading your library…" />
    if (p.error) return <ErrorState message={p.error} onRetry={p.onRetry} />
    if (downloaded) {
      const anime = p.mediaFilter === 'anime'
      const n = anime ? p.downloadedAnime.length : p.downloadedManga.length
      if (!n)
        return (
          <EmptyState
            icon={<Download size={48} aria-hidden="true" />}
            title={anime ? 'No Downloaded Anime' : 'No Downloaded Manga'}
            text={anime ? "Download episodes from anime details to watch them offline. They'll appear here." : "Download chapters from manga details to read them offline. They'll appear here."}
          />
        )
      return (
        <div className={view === 'grid' ? `grid ${cols}` : 'flex flex-col'}>
          {anime
            ? p.downloadedAnime.map((a) => <Item key={a.media_id} title={a.title} cover={a.cover_url} badge={`${a.episode_count} ep`} right={formatBytes(a.total_size)} sub={`${a.episode_count} episodes · ${formatBytes(a.total_size)}`} list={view === 'list'} selected={false} selecting={false} onClick={() => p.onOpenDownloaded(a)} />)
            : p.downloadedManga.map((m) => <Item key={m.media_id} title={m.title} cover={m.cover_url} badge={`${m.chapter_count} ch`} right={formatBytes(m.total_size)} sub={`${m.chapter_count} chapters · ${formatBytes(m.total_size)}`} list={view === 'list'} selected={false} selecting={false} onClick={() => p.onOpenDownloadedManga(m)} />)}
        </div>
      )
    }
    if (!items.length) {
      const anime = p.mediaFilter === 'anime'
      if (p.library.length === 0 && p.activeTab === 'all' && p.selectedTagId === null)
        return <EmptyState icon={anime ? <Tv size={48} aria-hidden="true" /> : <BookOpen size={48} aria-hidden="true" />} title="Your library is empty" text="Add titles from Browse and they'll show up here." action={{ label: 'Browse', onClick: () => void navigate({ to: p.mediaFilter === 'manga' ? '/manga' : '/anime' }) }} />
      return (
        <EmptyState
          icon={anime ? <Tv size={48} aria-hidden="true" /> : <BookOpen size={48} aria-hidden="true" />}
          title={`No ${anime ? 'Anime' : 'Manga'} in This List`}
          text={selectedTag ? `Nothing tagged “${selectedTag.tag.name}” here.` : `Your ${tabLabel.toLowerCase()} list is empty.`}
        />
      )
    }
    return (
      <div className={view === 'grid' ? `grid ${cols}` : 'flex flex-col'}>
        {items.map((e) => (
          <Item
            key={e.library_entry.media_id}
            title={displayTitle(e.media)}
            cover={e.media.cover_url}
            badge={statusLabel(e.library_entry.status)}
            right={e.library_entry.favorite ? '★' : undefined}
            sub={[e.library_entry.score ? `★ ${e.library_entry.score}` : '', e.media.status ?? ''].filter(Boolean).join(' · ')}
            list={view === 'list'}
            selected={p.selectedItems.has(e.media.id)}
            selecting={p.selectionMode}
            onClick={() => (p.selectionMode ? p.toggleItem(e.media.id) : p.onOpen(e))}
            onLong={() => {
              if (!p.selectionMode) {
                p.setSelectionMode(true)
                p.toggleItem(e.media.id)
              }
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="px-4 pb-28 pt-2">
      {p.selectionMode ? (
        <div className="mb-3 flex items-center gap-3">
          <button type="button" aria-label="Cancel selection" onClick={p.clearSelection} className="flex h-11 w-11 items-center justify-center rounded-full text-white"><X size={22} /></button>
          <span className="flex-1 font-display text-lg font-semibold text-white">{p.selectedItems.size} selected</span>
          <button type="button" onClick={p.selectAll} className="min-h-[44px] px-2 text-sm font-semibold text-[var(--color-accent-light)]">Select all</button>
        </div>
      ) : (
        <>
          <Segmented className="mb-3" value={p.mediaFilter} onChange={p.setMediaFilter} options={[{ id: 'anime', label: <><Tv size={14} />Anime</> }, { id: 'manga', label: <><BookOpen size={14} />Manga</> }]} />
          <ChipRow value={p.activeTab} onChange={p.setActiveTab} options={p.tabs.map((t) => ({ id: t.id, label: t.label, count: p.loading ? 0 : tabCount(t.id) }))} />
          <div className="mt-3 flex items-center gap-2">
            <div className="scrollbar-hide -mr-1 flex flex-1 gap-2 overflow-x-auto">
              <button type="button" onClick={() => setSheet('tagFilter')} className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm ${selectedTag ? 'border-[var(--color-accent-primary)] text-white' : 'border-[var(--color-glass-border)] text-[var(--color-text-secondary)]'}`}>
                <Tags size={15} aria-hidden="true" />{selectedTag ? selectedTag.tag.name : 'Tags'}
              </button>
              {selectedTag && <button type="button" onClick={() => p.onSelectTag(null)} className="min-h-[40px] shrink-0 px-2 text-sm text-[var(--color-text-muted)]">Clear</button>}
            </div>
            <button type="button" aria-label="Sort and view" onClick={() => setSheet('sort')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-glass-border)] text-white"><SlidersHorizontal size={18} /></button>
          </div>
          {!p.loading && !p.error && !downloaded && p.library.length > 0 && <p className="mt-2 text-xs text-[var(--color-text-muted)]">{p.library.length} {p.library.length === 1 ? 'item' : 'items'} · long-press to select</p>}
        </>
      )}
      <div className="mt-3">{body()}</div>

      {p.selectionMode && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-[var(--color-glass-border)] bg-[var(--color-bg-secondary)] px-3 pt-2" style={{ paddingBottom: 'calc(var(--sab, 0px) + 8px)' }}>
          {[
            { label: 'Status', icon: <Check size={18} />, on: () => setSheet('status') },
            { label: 'Tags', icon: <Tags size={18} />, on: () => setSheet('bulkTags') },
            { label: 'Remove', icon: <Trash2 size={18} />, on: () => setSheet('confirmRemove') },
          ].map((a) => (
            <button key={a.label} type="button" disabled={!ids.length} onClick={a.on} className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-md)] text-xs text-white disabled:opacity-40">{a.icon}{a.label}</button>
          ))}
        </div>
      )}

      <BottomSheet isOpen={sheet === 'sort'} onClose={() => setSheet(null)} title="Sort & view">
        <p className="px-[18px] pb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Sort by</p>
        {SORTS.map((s) => <SheetOption key={s.id} checked={sort === s.id} onClick={() => setSort(s.id)}>{s.label}</SheetOption>)}
        <p className="px-[18px] pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">View</p>
        <SheetOption checked={view === 'grid'} onClick={() => setView('grid')}>Grid</SheetOption>
        <SheetOption checked={view === 'list'} onClick={() => setView('list')}>List</SheetOption>
        <p className="px-[18px] pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Density</p>
        {DENSITIES.map((d) => <SheetOption key={d} checked={density === d} onClick={() => updateSettings({ gridDensity: d })}>{d[0].toUpperCase() + d.slice(1)}</SheetOption>)}
      </BottomSheet>

      <BottomSheet isOpen={sheet === 'tagFilter'} onClose={() => setSheet(null)} title="Filter by tag">
        <SheetOption checked={p.selectedTagId === null} onClick={() => { p.onSelectTag(null); setSheet(null) }}>All tags</SheetOption>
        {p.tags.map((t) => (
          <SheetOption key={t.tag.id} checked={p.selectedTagId === t.tag.id} detail={t.item_count} icon={<span className="h-3 w-3 rounded-full" style={{ background: t.tag.color }} />} onClick={() => { p.onSelectTag(t.tag.id); setSheet(null) }}>{t.tag.name}</SheetOption>
        ))}
        <SheetOption icon={<Pencil size={18} />} onClick={() => setSheet('tagManager')}>Manage tags</SheetOption>
      </BottomSheet>

      <TagManagerSheet isOpen={sheet === 'tagManager'} onClose={() => setSheet(null)} tags={p.tags} onChange={p.reloadTags} />

      <BottomSheet isOpen={sheet === 'status'} onClose={() => setSheet(null)} title={`Move ${ids.length} to…`}>
        {p.tabs.filter((t) => t.id !== 'all' && t.id !== 'downloaded').map((t) => (
          <SheetOption key={t.id} onClick={() => { setSheet(null); void run(() => bulkUpdateLibraryStatus(ids, t.id as LibraryStatus), `Moved ${ids.length} to ${t.label}`).then(p.clearSelection) }}>{t.label}</SheetOption>
        ))}
      </BottomSheet>

      <BottomSheet isOpen={sheet === 'bulkTags'} onClose={() => setSheet(null)} title={`Tag ${ids.length} items`}>
        {p.tags.length === 0 && <p className="px-[18px] pb-4 text-sm text-[var(--color-text-secondary)]">No tags yet.</p>}
        {p.tags.map((t) => (
          <div key={t.tag.id} className="flex items-center gap-2 border-b border-[var(--color-glass-border)] px-[18px] py-2 last:border-b-0">
            <span className="h-3 w-3 rounded-full" style={{ background: t.tag.color }} />
            <span className="flex-1 text-[15px] text-white">{t.tag.name}</span>
            <button type="button" onClick={() => void run(() => Promise.all(ids.map((i) => assignLibraryTag(i, t.tag.id))).then(() => undefined), `Added “${t.tag.name}”`)} className="min-h-[44px] px-3 text-sm font-semibold text-[var(--color-accent-light)]">Add</button>
            <button type="button" onClick={() => void run(() => Promise.all(ids.map((i) => unassignLibraryTag(i, t.tag.id))).then(() => undefined), `Removed “${t.tag.name}”`)} className="min-h-[44px] px-3 text-sm text-[var(--color-text-secondary)]">Remove</button>
          </div>
        ))}
        <SheetOption icon={<Plus size={18} />} onClick={() => setSheet('tagManager')}>New tag</SheetOption>
      </BottomSheet>

      <ConfirmSheet isOpen={sheet === 'confirmRemove'} onClose={() => setSheet(null)} title={`Remove ${ids.length} from library?`} text="They'll be removed from your library. Downloads and history are kept." confirmLabel="Remove" onConfirm={() => void run(() => bulkRemoveFromLibrary(ids), `Removed ${ids.length}`).then(p.clearSelection)} />
    </div>
  )
}

function TagManagerSheet({ isOpen, onClose, tags, onChange }: { isOpen: boolean; onClose: () => void; tags: LibraryTagWithCount[]; onChange: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(TAG_COLORS[0])
  const [editing, setEditing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<LibraryTagWithCount | null>(null)
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await onChange()
    } catch (e) {
      notifyError('Error', e instanceof Error ? e.message : 'Tag action failed')
    }
  }
  const save = () =>
    guard(async () => {
      if (!name.trim()) return
      if (editing === null) await createLibraryTag(name.trim(), color)
      else await updateLibraryTag(editing, name.trim(), color)
      setName('')
      setEditing(null)
    })
  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose} title="Manage tags">
        {tags.map((t) => (
          <div key={t.tag.id} className="flex items-center gap-1 border-b border-[var(--color-glass-border)] pl-[18px] pr-2 last:border-b-0">
            <span className="mr-2 h-3 w-3 rounded-full" style={{ background: t.tag.color }} />
            <span className="min-h-[52px] flex-1 content-center text-[15px] text-white">{t.tag.name} <span className="text-xs text-[var(--color-text-muted)]">{t.item_count}</span></span>
            <button type="button" aria-label={`Edit ${t.tag.name}`} onClick={() => { setEditing(t.tag.id); setName(t.tag.name); setColor(t.tag.color) }} className="flex h-11 w-11 items-center justify-center text-[var(--color-text-secondary)]"><Pencil size={17} /></button>
            <button type="button" aria-label={`Delete ${t.tag.name}`} onClick={() => setDeleting(t)} className="flex h-11 w-11 items-center justify-center text-[var(--color-accent-light)]"><Trash2 size={17} /></button>
          </div>
        ))}
        <div className="px-[18px] pb-3 pt-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={editing === null ? 'New tag name' : 'Rename tag'} maxLength={30} className="min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--color-glass-border)] bg-[var(--color-glass-bg)] px-3 text-[15px] text-white" />
          <div className="mt-3 flex flex-wrap gap-2">
            {TAG_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={`h-9 w-9 rounded-full ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[var(--color-bg-secondary)]' : ''}`} style={{ background: c }} />
            ))}
          </div>
          <button type="button" disabled={!name.trim()} onClick={() => void save()} className="mt-3 min-h-[48px] w-full rounded-[var(--radius-lg)] bg-[var(--color-accent-primary)] text-[15px] font-semibold text-white disabled:opacity-40">{editing === null ? 'Create tag' : 'Save tag'}</button>
        </div>
      </BottomSheet>
      <ConfirmSheet isOpen={!!deleting} onClose={() => setDeleting(null)} title={`Delete “${deleting?.tag.name ?? ''}”?`} text="It's removed from every title it's on." confirmLabel="Delete tag" onConfirm={() => deleting && void guard(() => deleteLibraryTag(deleting.tag.id))} />
    </>
  )
}
