/**
 * Phone manga detail (mock: design/files/manga.html "Manga detail").
 * Same inputs and data logic as MangaDetailModal; rendered as a pushed full screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowDownUp,
  BookOpen,
  Check,
  CheckCircle,
  ChevronDown,
  Download,
  Heart,
  Loader2,
  Lock,
  BellRing,
  BookmarkCheck,
  CircleCheckBig,
  CheckCheck,
  Circle,
  Clock,
  Plus,
  RefreshCw,
  Tag,
  ShieldOff,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react'
import {
  getMangaDetails,
  saveMediaDetails,
  addToLibrary,
  removeFromLibrary,
  isInLibrary,
  getLibraryEntry,
  toggleFavorite,
  getLatestReadingProgressForMedia,
  getBatchReadingProgress,
  saveReadingProgress,
  getChapterImages,
  startChapterDownload,
  isChapterDownloaded,
  deleteChapterDownload,
  initializeReleaseTrackingV2,
  getMediaTags,
  unassignLibraryTag,
  setMediaFeedback,
  getMediaFeedback,
  removeMediaFeedback,
  type MediaEntry,
  type LibraryStatus,
  type LibraryTag,
} from '@/utils/tauri-commands'
import { savePendingReturn } from '@/utils/return-media'
import { resolveJikanToMangakakalot } from '@/utils/manga-extensions'
import { TagSelector, TagChips } from '@/components/library'
import { Description } from '@/components/ui/Description'
import { BottomSheet, SheetOption } from '@/components/ui/BottomSheet'
import { DetailTabBar } from '@/components/media/DetailTabBar'
import { useSettingsStore } from '@/store/settingsStore'
import { useMediaStatusContext } from '@/contexts/MediaStatusContext'
import { useChapterDownloadEvents } from '@/hooks/useChapterDownloadEvents'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { useProxiedImage } from '@/hooks/useProxiedImage'
import { isNsfwContent } from '@/utils/nsfw-filter'
import { notifySuccess, notifyError, notifyInfo } from '@/utils/notify'
import type { SearchResult, MangaDetails, Chapter } from '@/types/extension'
import { PushedScreen } from './PushedScreen'
import { isRecentlyReleased, rangeSelection, timeAgo } from './helpers'

const PER_PAGE = 50
const isMalId = (id: string) => /^\d+$/.test(id)

const STATUS_LABEL: Record<string, string> = {
  reading: 'Reading',
  plan_to_read: 'Plan to Read',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
  watching: 'Watching',
  plan_to_watch: 'Plan to Watch',
}
const MANGA_STATUSES: LibraryStatus[] = ['reading', 'plan_to_read', 'completed', 'on_hold', 'dropped']

interface Props {
  manga: SearchResult | null
  extensionId?: string
  onClose: () => void
}

type Sheet = null | 'library' | 'range' | 'tags' | 'confirmDelete' | 'menu'

export function MobileMangaDetail({ manga, extensionId = '', onClose }: Props) {
  const navigate = useNavigate()
  const maxConcurrent = useSettingsStore((s) => s.maxConcurrentDownloads)
  const nsfwFilter = useSettingsStore((s) => s.nsfwFilter)
  const downloadLocation = useSettingsStore((s) => s.downloadLocation)
  const { getStatus, refresh: refreshMediaStatus } = useMediaStatusContext()
  const { isOnline } = useNetworkStatus()

  const [details, setDetails] = useState<MangaDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [inLibrary, setInLibrary] = useState(false)
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(null)
  const [isFavorite, setIsFavorite] = useState(false)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [isTracked, setIsTracked] = useState(false)
  const [progress, setProgress] = useState<{ chapterId: string; chapterNumber: number; page: number } | null>(null)
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())
  const [readSet, setReadSet] = useState<Set<string>>(new Set())
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [nsfwBlocked, setNsfwBlocked] = useState(false)
  const [tab, setTab] = useState('chapters')
  const [feedback, setFeedback] = useState<'liked' | 'disliked' | null>(null)
  const [resolvedId, setResolvedId] = useState<string | null>(manga?.id || null)
  const [chaptersLoading, setChaptersLoading] = useState(false)
  const [tags, setTags] = useState<LibraryTag[]>([])
  const [showTagSelector, setShowTagSelector] = useState(false)
  const tagButtonRef = useRef<HTMLButtonElement>(null)

  const [sheet, setSheet] = useState<Sheet>(null)
  const [rowChapter, setRowChapter] = useState<Chapter | null>(null)
  const [newestFirst, setNewestFirst] = useState(true)
  const [page, setPage] = useState(0)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  const { src: coverSrc } = useProxiedImage(details?.cover_url || manga?.cover_url || '')
  const { downloadingChapters } = useChapterDownloadEvents({
    mediaId: manga?.id,
    onComplete: (d) => setDownloaded((prev) => new Set(prev).add(d.chapter_id)),
  })

  const needsLegacyResolution = manga ? isMalId(manga.id) : false
  useEffect(() => {
    if (!manga) return
    if (!needsLegacyResolution) return setResolvedId(manga.id)
    if (!extensionId) return setResolvedId(null)
    setChaptersLoading(true)
    resolveJikanToMangakakalot(extensionId, manga.title)
      .then((r) => setResolvedId(r?.id || null))
      .catch(() => setResolvedId(null))
      .finally(() => setChaptersLoading(false))
  }, [manga, extensionId, needsLegacyResolution])

  useEffect(() => {
    if (!manga) return
    setTab('chapters')
    setFeedback(null)
    let cancelled = false
    const load = async () => {
      if (!extensionId || !resolvedId) {
        setError('Could not find this manga in Mangakakalot')
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const result = await getMangaDetails(extensionId, resolvedId, !nsfwFilter)
        if (cancelled) return
        setDetails(result)
        setNsfwBlocked(
          nsfwFilter ? isNsfwContent(result.genres, `${result.title || ''} ${result.description || ''}`) : false
        )
        try {
          await saveMediaDetails(toMediaEntry(manga.id, extensionId, result, result.chapters.length))
        } catch {
          /* non-fatal */
        }
        try {
          const inLib = await isInLibrary(manga.id)
          setInLibrary(inLib)
          const st = getStatus(manga.id)
          setIsFavorite(st.isFavorite)
          setIsTracked(st.isTracked)
          setLibraryStatus(st.libraryStatus || null)
          if (inLib) {
            getMediaTags(manga.id).then(setTags).catch(() => {})
            getMediaFeedback(manga.id).then((f) => setFeedback(f?.sentiment ?? null)).catch(() => {})
          }
        } catch {
          /* ignore */
        }
        try {
          const p = await getLatestReadingProgressForMedia(manga.id)
          if (p) setProgress({ chapterId: p.chapter_id, chapterNumber: p.chapter_number, page: p.current_page })
        } catch {
          /* ignore */
        }
        try {
          const h = await getBatchReadingProgress(manga.id)
          setReadSet(new Set(h.filter((x) => x.completed).map((x) => x.chapter_id)))
        } catch {
          /* ignore */
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load manga details')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [manga, extensionId, resolvedId, nsfwFilter, getStatus, reloadKey])

  const chapters = useMemo(() => details?.chapters ?? [], [details])
  const sorted = useMemo(
    () => [...chapters].sort((a, b) => (newestFirst ? b.number - a.number : a.number - b.number)),
    [chapters, newestFirst]
  )
  const lastNumber = useMemo(() => chapters.reduce((m, c) => Math.max(m, c.number), 0), [chapters])

  useEffect(() => {
    if (!manga || chapters.length === 0) return
    let cancelled = false
    ;(async () => {
      const set = new Set<string>()
      for (const c of chapters) {
        try {
          if (await isChapterDownloaded(manga.id, c.id)) set.add(c.id)
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setDownloaded(set)
    })()
    return () => {
      cancelled = true
    }
  }, [manga, chapters])

  // Jump to the page holding the latest read chapter.
  useEffect(() => {
    if (!progress) return
    const i = sorted.findIndex((c) => c.id === progress.chapterId)
    if (i >= 0) setPage(Math.floor(i / PER_PAGE))
  }, [progress, sorted])

  if (!manga) return null

  const title = details?.english_name || details?.title || manga.title
  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE))
  const pageItems = sorted.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const visible = isOnline ? pageItems : sorted.filter((c) => downloaded.has(c.id))

  // ---- actions (same commands as MangaDetailModal) ----
  const readChapter = (chapterId?: string) => {
    if (!details) return
    savePendingReturn('manga', { ...manga, _returnExtensionId: extensionId || undefined })
    navigate({
      to: '/read',
      search: { extensionId, mangaId: resolvedId || manga.id, chapterId: chapterId || details.chapters[0]?.id },
    })
  }

  const loadTags = () => getMediaTags(manga.id).then(setTags).catch(() => {})
  const removeTag = async (tagId: number) => {
    try {
      await unassignLibraryTag(manga.id, tagId)
      setTags((p) => p.filter((t) => t.id !== tagId))
    } catch {
      notifyError('Error', 'Failed to remove tag')
    }
  }

  const trackLatest = async (status: string | undefined) => {
    if (!details || chapters.length === 0) return
    try {
      const latest = chapters.reduce((m, c) => (c.number > m.number ? c : m))
      await initializeReleaseTrackingV2(manga.id, extensionId, 'manga', chapters.length, latest.number, latest.id, status)
    } catch (e) {
      console.error('Failed to initialize release tracking:', e)
    }
  }

  const saveEntry = async () => {
    if (!details) return
    try {
      await saveMediaDetails(toMediaEntry(manga.id, extensionId, details, chapters.length || details.chapters.length))
    } catch (e) {
      console.error('Failed to save media details:', e)
    }
  }

  const meta = () => {
    const cover = details?.cover_url || manga.cover_url
    return { metadata: { media_id: manga.id, ...(cover ? { thumbnail: cover, image: cover } : {}) } }
  }

  const addToLib = async (status: LibraryStatus) => {
    if (!details) return
    setLibraryLoading(true)
    try {
      await saveEntry()
      await addToLibrary(manga.id, status)
      setInLibrary(true)
      setLibraryStatus(status)
      notifySuccess(details.title, `Added to "${STATUS_LABEL[status]}" list`, meta())
      await trackLatest(details.status)
      refreshMediaStatus()
    } catch (e) {
      notifyError('Library Error', `Failed to add "${details.title}" to library`)
      console.error(e)
    } finally {
      setLibraryLoading(false)
    }
  }

  const removeFromLib = async () => {
    if (!details) return
    setLibraryLoading(true)
    try {
      await removeFromLibrary(manga.id)
      setInLibrary(false)
      setLibraryStatus(null)
      setIsFavorite(false)
      notifySuccess(details.title, 'Removed from your library')
      refreshMediaStatus()
    } catch (e) {
      notifyError('Library Error', `Failed to remove "${details.title}" from library`)
      console.error(e)
    } finally {
      setLibraryLoading(false)
    }
  }

  const favorite = async () => {
    if (!details) return
    try {
      await saveEntry()
      if (!(await getLibraryEntry(manga.id))) {
        await addToLibrary(manga.id, 'plan_to_read')
        setInLibrary(true)
        setLibraryStatus('plan_to_read')
        await trackLatest(details.status)
      }
      const fav = await toggleFavorite(manga.id)
      setIsFavorite(fav)
      notifySuccess(details.title, fav ? 'Added to your favorites' : 'Removed from your favorites', meta())
      refreshMediaStatus()
    } catch (e) {
      notifyError('Favorites Error', `Failed to update favorites for "${details.title}"`)
      console.error(e)
    }
  }

  const sendFeedback = async (sentiment: 'liked' | 'disliked') => {
    const prev = feedback
    if (feedback === sentiment) {
      setFeedback(null)
      try {
        await removeMediaFeedback(manga.id)
      } catch {
        setFeedback(prev)
      }
      return
    }
    setFeedback(sentiment)
    try {
      await setMediaFeedback(manga.id, sentiment)
      notifySuccess('Feedback', 'Noted! This helps recommendations')
    } catch {
      setFeedback(prev)
    }
  }

  const toggleRead = async (c: Chapter) => {
    try {
      if (readSet.has(c.id)) {
        await saveReadingProgress(manga.id, c.id, c.number, 0, undefined, false)
        setReadSet((p) => {
          const n = new Set(p)
          n.delete(c.id)
          return n
        })
        if (progress?.chapterId === c.id) setProgress(null)
      } else {
        await saveReadingProgress(manga.id, c.id, c.number, 1, undefined, true)
        setReadSet((p) => new Set(p).add(c.id))
        if (!progress || c.number >= progress.chapterNumber)
          setProgress({ chapterId: c.id, chapterNumber: c.number, page: 1 })
      }
    } catch (e) {
      console.error('Failed to toggle chapter read state:', e)
    }
  }

  const downloadOne = async (c: Chapter): Promise<boolean> => {
    if (!details) return false
    try {
      const imgs = await getChapterImages(extensionId, c.id)
      if (!imgs.images?.length) throw new Error('No images found')
      await startChapterDownload(
        manga.id,
        details.title,
        c.id,
        c.number,
        imgs.images.map((i) => i.url),
        downloadLocation || undefined
      )
      return true
    } catch (e) {
      console.error('Download failed:', e)
      return false
    }
  }

  const downloadMany = async (list: Chapter[]) => {
    if (!details || downloadingAll) return
    if (list.length === 0) return notifyInfo(details.title, 'All chapters are already downloaded')
    setDownloadingAll(true)
    let ok = 0
    let fail = 0
    const n = maxConcurrent || 3
    for (let i = 0; i < list.length; i += n) {
      const res = await Promise.all(list.slice(i, i + n).map(downloadOne))
      res.forEach((r) => (r ? ok++ : fail++))
    }
    setDownloadingAll(false)
    const s = (k: number) => `${k} chapter${k > 1 ? 's' : ''}`
    if (fail === 0) notifySuccess(details.title, `Successfully downloaded ${s(ok)}`)
    else notifyError(details.title, `Downloaded ${s(ok)}, ${fail} failed`)
  }

  const downloadSingle = async (c: Chapter) => {
    if (!(await downloadOne(c)) && details)
      notifyError('Download Failed', `Failed to download "${details.title}" Chapter ${c.number}`)
  }

  const deleteDownload = async (c: Chapter) => {
    if (!details) return
    try {
      await deleteChapterDownload(manga.id, c.id)
      setDownloaded((p) => {
        const n = new Set(p)
        n.delete(c.id)
        return n
      })
      notifySuccess(details.title, `Chapter ${c.number} download deleted`)
    } catch (e) {
      console.error('Delete failed:', e)
      notifyError('Delete Failed', `Failed to delete "${details.title}" Chapter ${c.number} download`)
    }
  }

  // ---- selection ----
  const toggleSelect = (id: string) =>
    setSelected((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const exitSelect = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const startPress = (id: string) => {
    longPressed.current = false
    pressTimer.current = setTimeout(() => {
      longPressed.current = true
      setSelecting(true)
      setSelected((p) => new Set(p).add(id))
    }, 450)
  }
  const endPress = () => pressTimer.current && clearTimeout(pressTimer.current)
  const rowTap = (c: Chapter) => {
    if (longPressed.current) return (longPressed.current = false)
    if (selecting) return toggleSelect(c.id)
    if (!isOnline && !downloaded.has(c.id)) return
    readChapter(c.id)
  }

  const range = rangeSelection(
    chapters,
    Number(rangeFrom || 0),
    Number(rangeTo || 0),
    downloaded
  )
  const allDownloaded = chapters.length > 0 && downloaded.size >= chapters.length
  const smartStatus: LibraryStatus | null =
    libraryStatus && progress && chapters.length > 0 && progress.chapterNumber < lastNumber && libraryStatus !== 'dropped'
      ? 'reading'
      : libraryStatus

  // ---- states ----
  if (loading || chaptersLoading) {
    return (
      <PushedScreen onClose={onClose} shareTitle={manga.title}>
        <div className="animate-pulse" aria-busy="true" aria-label="Loading">
          <div className="h-[300px] bg-[var(--color-bg-secondary)]" />
          <div className="space-y-3 p-4">
            <div className="h-11 rounded-xl bg-[var(--color-bg-secondary)]" />
            <div className="h-8 w-2/3 rounded bg-[var(--color-bg-secondary)]" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-[var(--color-bg-secondary)]" />
            ))}
          </div>
        </div>
      </PushedScreen>
    )
  }

  if (error) {
    return (
      <PushedScreen onClose={onClose}>
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-8 text-center">
          <AlertCircle className="h-12 w-12 text-red-500" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Couldn’t load this manga</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">{!isOnline ? 'You’re offline.' : error}</p>
          <div className="mt-2 flex gap-3">
            <button className="btn btn-primary min-h-11 px-5" onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </button>
            <button className="btn min-h-11 px-5" onClick={onClose}>
              Go back
            </button>
          </div>
        </div>
      </PushedScreen>
    )
  }

  if (nsfwBlocked || !details) {
    return (
      <PushedScreen onClose={onClose}>
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20">
            <ShieldOff className="h-8 w-8 text-red-500" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-bold text-white">Content Blocked</h2>
          <p className="text-[var(--color-text-secondary)]">
            This manga contains adult content and has been blocked by your NSFW filter settings.
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            You can disable the NSFW filter in Settings to view this content.
          </p>
          <button className="btn btn-primary mt-2 min-h-11 px-5" onClick={() => navigate({ to: '/settings' })}>
            Open Settings
          </button>
        </div>
      </PushedScreen>
    )
  }

  const pillBtn = (on: boolean) =>
    `inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] ${
      on
        ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)] text-white'
        : 'border-[var(--color-glass-border-hover)] text-[var(--color-text)]'
    }`
  const label = 'text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--color-text-muted)]'
  const statusCh = details.status && details.status.toLowerCase() !== 'unknown' ? details.status : ''

  return (
    <PushedScreen onClose={onClose} shareTitle={title} onMenu={() => setSheet('menu')}>
      {/* Header: poster + title block (mock .dh) */}
      <div className="flex gap-3.5 px-4 pb-0 pt-14">
        <div className="h-[156px] w-[104px] shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface)] shadow-lg">
          {coverSrc && <img src={coverSrc} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0">
          <h1 className="mb-1.5 line-clamp-3 font-['Space_Grotesk',sans-serif] text-[21px] leading-[1.15] text-white">{title}</h1>
          {details.authors && details.authors.length > 0 && (
            <p className="mb-2 text-[12.5px] text-[var(--color-text-muted)]">{details.authors.join(', ')}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {statusCh && (
              <span className={`chip ${statusCh.toLowerCase().includes('publishing') ? 'chip-green' : ''}`}>{statusCh}</span>
            )}
            {details.rating ? <span className="chip chip-gold">★ {details.rating.toFixed(1)}</span> : null}
            {details.type && <span className="chip">{details.type}</span>}
            {details.year ? <span className="chip">{details.year}</span> : null}
          </div>
        </div>
      </div>

      {/* Actions (mock .acts) */}
      <div className="px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-2">
          {progress ? (
            <button
              onClick={() => readChapter(progress.chapterId)}
              className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent-primary)] px-[18px] text-[15px] font-semibold text-white active:bg-[var(--color-accent-hover)]"
            >
              <BookOpen size={18} aria-hidden="true" />
              <span className="truncate">Continue Ch. {progress.chapterNumber} (p.{progress.page})</span>
            </button>
          ) : (
            <button
              onClick={() => readChapter()}
              disabled={chaptersLoading || chapters.length === 0}
              className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent-primary)] px-[18px] text-[15px] font-semibold text-white disabled:opacity-40"
            >
              <BookOpen size={18} aria-hidden="true" />
              {chaptersLoading ? 'Loading...' : 'Start Reading'}
            </button>
          )}
          <button
            onClick={() => setSheet('library')}
            disabled={libraryLoading}
            className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-glass-border-hover)] px-3 text-[15px] font-semibold text-[var(--color-text-primary)]"
          >
            {libraryLoading ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : inLibrary ? (
              <BookmarkCheck size={16} aria-hidden="true" />
            ) : (
              <Plus size={16} aria-hidden="true" />
            )}
            {inLibrary && smartStatus ? STATUS_LABEL[smartStatus] : 'Add to Library'}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center gap-2 pt-2">
          {inLibrary && (
            <>
              <button
                onClick={() => sendFeedback('liked')}
                aria-pressed={feedback === 'liked'}
                className={pillBtn(feedback === 'liked')}
              >
                <ThumbsUp size={16} aria-hidden="true" /> Like
              </button>
              <button
                onClick={() => sendFeedback('disliked')}
                aria-pressed={feedback === 'disliked'}
                className={pillBtn(feedback === 'disliked')}
              >
                <ThumbsDown size={16} aria-hidden="true" /> Dislike
              </button>
              <button ref={tagButtonRef} onClick={() => setShowTagSelector((v) => !v)} className={pillBtn(false)}>
                <Tag size={16} aria-hidden="true" />
                {tags.length > 0 ? 'Tags' : 'Add Tags'}
              </button>
            </>
          )}
          <span className="ml-auto flex">
            <button
              onClick={favorite}
              aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              className={`flex h-11 w-11 items-center justify-center rounded-full ${
                isFavorite ? 'text-[var(--color-accent-primary)]' : 'text-[var(--color-text-primary)]'
              }`}
            >
              <Heart size={20} className={isFavorite ? 'fill-current' : ''} aria-hidden="true" />
            </button>
            {isTracked && (
              <span role="img" aria-label="Tracking new chapter releases" className="flex h-11 w-11 items-center justify-center">
                <BellRing size={20} aria-hidden="true" />
              </span>
            )}
          </span>
        </div>
        {inLibrary && tags.length > 0 && <div className="mt-2"><TagChips tags={tags} onRemove={removeTag} /></div>}
        <TagSelector
          mediaId={manga.id}
          isOpen={showTagSelector}
          onClose={() => setShowTagSelector(false)}
          onTagsChange={loadTags}
          anchorRef={tagButtonRef}
        />
      </div>

      {!isOnline && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
          <WifiOff size={16} aria-hidden="true" />
          You’re offline. Only downloaded chapters are available.
        </div>
      )}

      <div className="mt-3 px-4 pb-28">
        <DetailTabBar
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'chapters', label: 'Chapters', count: chapters.length || undefined },
          ]}
          activeTab={tab}
          onTabChange={setTab}
        />

        {tab === 'overview' && (
          <div className="mt-4">
            {details.description && (
              <Description
                content={details.description}
                className="mb-5 text-[0.9375rem] leading-[1.75] text-[var(--color-text-secondary)]"
              />
            )}
            {details.genres.length > 0 && (
              <div className="mb-5 flex flex-wrap gap-2">
                {details.genres.map((g) => (
                  <span key={g} className="chip">{g}</span>
                ))}
              </div>
            )}
            {details.background && (
              <div className="mb-5 rounded-lg border border-[var(--color-glass-border)] bg-[var(--color-bg-secondary)] p-4">
                <div className={`${label} mb-1`}>Background</div>
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{details.background}</p>
              </div>
            )}
            <h3 className={`${label} mb-2`}>Details</h3>
            <dl className="mb-5 divide-y divide-[var(--color-glass-border)] rounded-xl border border-[var(--color-glass-border)] bg-[var(--color-bg-secondary)] text-sm">
              {(
                [
                  ['Status', statusCh],
                  [
                    'Chapters',
                    chapters.length > 0 || details.totalChapters
                      ? `${chapters.length > 0 ? chapters.length : details.totalChapters}${
                          details.totalChapters && chapters.length > 0 && chapters.length !== details.totalChapters
                            ? ` / ${details.totalChapters}`
                            : ''
                        }`
                      : '',
                  ],
                  ['Volumes', details.volumes ? String(details.volumes) : ''],
                  ['Author', details.authors?.join(', ') ?? ''],
                  ['Serialization', details.serializations?.join(', ') ?? ''],
                  ['Released', details.year ? String(details.year) : ''],
                  ['English', details.english_name ?? ''],
                  ['Native', details.native_name ?? ''],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 px-3.5 py-2.5">
                    <dt className="text-[var(--color-text-muted)]">{k}</dt>
                    <dd className="text-right font-medium capitalize-none">{v}</dd>
                  </div>
                ))}
            </dl>
            {((details.demographics?.length ?? 0) > 0 || (details.themes?.length ?? 0) > 0) && (
              <div className="flex flex-wrap gap-2">
                {details.demographics?.map((d) => (
                  <span key={d} className="chip chip-accent">{d}</span>
                ))}
                {details.themes?.map((t) => (
                  <span key={t} className="chip">{t}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'chapters' && (
          <div className="mt-4">
            {chapters.length === 0 ? (
              <div className="py-10 text-center">
                <p className="font-medium">No chapters found</p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">This title has no readable chapters yet.</p>
                <button className="btn mt-4 min-h-11 px-5" onClick={() => setReloadKey((k) => k + 1)}>
                  Reload
                </button>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="mr-auto text-base font-semibold">
                    {isOnline ? `Chapters (${chapters.length})` : `Downloaded (${visible.length})`}
                  </h2>
                  <button
                    onClick={() => setNewestFirst((v) => !v)}
                    className="glass flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm"
                  >
                    <ArrowDownUp size={14} aria-hidden="true" />
                    {newestFirst ? 'Newest' : 'Oldest'}
                  </button>
                  {isOnline && (
                    <button onClick={() => setSheet('range')} className="glass min-h-11 rounded-xl px-3 text-sm">
                      Range
                    </button>
                  )}
                  <button
                    onClick={() => (selecting ? exitSelect() : setSelecting(true))}
                    className="glass min-h-11 rounded-xl px-3 text-sm"
                  >
                    {selecting ? 'Done' : 'Select'}
                  </button>
                </div>
                {isOnline && (
                  <button
                    onClick={() => downloadMany(chapters.filter((c) => !downloaded.has(c.id)))}
                    disabled={downloadingAll || allDownloaded}
                    className={`mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-white ${
                      allDownloaded
                        ? 'bg-green-600'
                        : downloadingAll
                          ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]'
                          : 'bg-[var(--color-accent-primary)]'
                    }`}
                  >
                    {downloadingAll ? (
                      <>
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Downloading…
                      </>
                    ) : allDownloaded ? (
                      <>
                        <CheckCircle size={16} aria-hidden="true" /> All Downloaded
                      </>
                    ) : (
                      <>
                        <Download size={16} aria-hidden="true" /> Download All ({chapters.length - downloaded.size})
                      </>
                    )}
                  </button>
                )}

                <ul className="-mx-4">
                  {visible.map((c) => {
                    const dl = downloadingChapters.get(c.id)
                    const isDl = downloaded.has(c.id)
                    const isRead = readSet.has(c.id)
                    const isCurrent = progress?.chapterId === c.id
                    const isNew =
                      c.number > (progress?.chapterNumber ?? 0) &&
                      isRecentlyReleased(c.number, lastNumber, c.releaseDate, details.last_update_end, details.broadcast_interval)
                    const sub = dl
                      ? dl.status === 'failed'
                        ? 'Failed · tap to retry'
                        : dl.status === 'queued'
                          ? 'Queued'
                          : `Downloading ${dl.downloaded_images}/${dl.total_images} images`
                      : isCurrent
                        ? `Reading · page ${progress?.page}`
                        : !isOnline && !isDl
                          ? 'Not downloaded'
                          : timeAgo(c.releaseDate)
                    const locked = !isOnline && !isDl
                    const sel = selected.has(c.id)
                    const muted = isRead && !isCurrent
                    return (
                      <li
                        key={c.id}
                        className={`relative mx-4 mb-2 flex min-h-16 items-center gap-2.5 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] py-2 pl-3.5 pr-1 ${
                          sel ? 'bg-[rgba(229,9,20,0.12)] outline outline-1 outline-[rgba(229,9,20,0.45)]' : ''
                        } ${locked ? 'opacity-40' : ''} ${isCurrent ? 'shadow-[inset_3px_0_0_var(--color-accent-primary)]' : ''}`}
                      >
                        {selecting && (
                          <span
                            aria-hidden="true"
                            className={`-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center ${
                              sel ? 'text-[var(--color-accent-primary)]' : 'text-[var(--color-text-muted)]'
                            }`}
                          >
                            {sel ? <CheckCircle size={20} /> : <Circle size={20} />}
                          </span>
                        )}
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          onClick={() => rowTap(c)}
                          onPointerDown={() => startPress(c.id)}
                          onPointerUp={endPress}
                          onPointerLeave={endPress}
                          onContextMenu={(e) => e.preventDefault()}
                        >
                          <span
                            className={`min-w-[46px] font-mono text-[12.5px] font-semibold ${
                              muted ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'
                            }`}
                          >
                            Ch. {c.number}
                          </span>
                          <span className="min-w-0 flex-1">
                            <b
                              className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[14.5px] font-medium ${
                                muted ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'
                              }`}
                            >
                              {isNew && (
                                <span className="shrink-0 rounded bg-[var(--color-green)] px-1.5 py-px text-xs font-extrabold tracking-[0.04em] text-[#04210d]">
                                  NEW
                                </span>
                              )}
                              <span className="min-w-0 truncate">{c.title}</span>
                            </b>
                            <small
                              className={`mt-0.5 block text-xs ${
                                dl?.status === 'failed' ? 'text-red-400' : 'text-[var(--color-text-muted)]'
                              }`}
                            >
                              {sub}
                            </small>
                            {dl?.status === 'downloading' && (
                              <span className="mt-1.5 block h-1 w-[120px] overflow-hidden rounded bg-white/10">
                                <span
                                  className="block h-full bg-[var(--color-accent-primary)]"
                                  style={{ width: `${dl.percentage}%` }}
                                />
                              </span>
                            )}
                          </span>
                        </button>
                        {!selecting && (
                          <button
                            disabled={locked || (!!dl && dl.status !== 'failed')}
                            aria-label={
                              locked
                                ? 'Unavailable offline'
                                : isDl
                                  ? 'Delete download'
                                  : dl?.status === 'failed'
                                    ? 'Retry download'
                                    : dl?.status === 'queued'
                                      ? 'Queued'
                                      : dl
                                        ? `Downloading ${dl.downloaded_images} of ${dl.total_images} pages`
                                        : 'Download chapter'
                            }
                            className={`flex h-11 w-11 shrink-0 items-center justify-center ${
                              isDl
                                ? 'text-[var(--color-green)]'
                                : dl && dl.status !== 'queued'
                                  ? 'text-[var(--color-accent-light)]'
                                  : 'text-[var(--color-text-secondary)]'
                            }`}
                            onClick={() => {
                              if (isDl) {
                                setRowChapter(c)
                                setSheet('confirmDelete')
                              } else void downloadSingle(c)
                            }}
                          >
                            {locked ? (
                              <Lock size={18} aria-hidden="true" />
                            ) : isDl ? (
                              <CircleCheckBig size={20} aria-hidden="true" />
                            ) : dl?.status === 'failed' ? (
                              <RefreshCw size={18} aria-hidden="true" />
                            ) : dl?.status === 'queued' ? (
                              <Clock size={18} aria-hidden="true" />
                            ) : dl ? (
                              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                            ) : (
                              <Download size={18} aria-hidden="true" />
                            )}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {!isOnline && chapters.length > visible.length && (
                  <p className="mx-0 mb-2 px-3 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
                    {chapters.length - visible.length} other chapters need a connection.
                  </p>
                )}

                {isOnline && totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <button
                      className="glass min-h-11 rounded-xl px-4 text-sm disabled:opacity-30"
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      Prev
                    </button>
                    <span className="text-sm tabular-nums text-[var(--color-text-secondary)]">
                      Page {page + 1} / {totalPages}
                    </span>
                    <button
                      className="glass min-h-11 rounded-xl px-4 text-sm disabled:opacity-30"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Bulk bar (mock .selbar) */}
      {selecting && (
        <div
          className="fixed inset-x-3 z-[210] flex items-center gap-2 rounded-[var(--radius-xl)] border border-[var(--color-glass-border-hover)] bg-[var(--color-panel)] py-2.5 pl-4 pr-2.5 shadow-lg"
          style={{ bottom: 'calc(var(--sab) + 12px)' }}
        >
          <b className="flex-1 text-sm leading-tight text-white">{selected.size} selected</b>
          <button
            disabled={selected.size === 0 || !isOnline}
            className="flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent-primary)] px-3 text-sm font-semibold text-white disabled:opacity-40"
            onClick={() => {
              const list = chapters.filter((c) => selected.has(c.id) && !downloaded.has(c.id))
              exitSelect()
              downloadMany(list)
            }}
          >
            <Download size={16} aria-hidden="true" /> Download
          </button>
          <button
            aria-label="Mark as read"
            disabled={selected.size === 0}
            className="flex h-11 w-11 items-center justify-center disabled:opacity-40"
            onClick={() => {
              chapters.filter((c) => selected.has(c.id) && !readSet.has(c.id)).forEach((c) => void toggleRead(c))
              exitSelect()
            }}
          >
            <CheckCheck size={18} aria-hidden="true" />
          </button>
          <button aria-label="Cancel selection" className="flex h-11 w-11 items-center justify-center" onClick={exitSelect}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Sheets */}
      <BottomSheet isOpen={sheet === 'library'} onClose={() => setSheet(null)} title={inLibrary ? 'Library' : 'Add to Library'}>
        {MANGA_STATUSES.map((s) => (
          <SheetOption
            key={s}
            checked={inLibrary ? smartStatus === s : undefined}
            onClick={() => {
              setSheet(null)
              if (inLibrary && libraryStatus === s) return
              void addToLib(s)
            }}
          >
            {STATUS_LABEL[s]}
          </SheetOption>
        ))}
        {inLibrary && (
          <SheetOption
            destructive
            icon={<Trash2 size={18} />}
            onClick={() => {
              setSheet(null)
              void removeFromLib()
            }}
          >
            Remove from Library
          </SheetOption>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={sheet === 'range'}
        onClose={() => setSheet(null)}
        title="Download chapters"
        footer={
          <>
            <button className="btn min-h-11 flex-1" onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary min-h-11 flex-1 disabled:opacity-40"
              disabled={range.toDownload.length === 0}
              onClick={() => {
                setSheet(null)
                void downloadMany(range.toDownload)
              }}
            >
              Download {range.toDownload.length}
            </button>
          </>
        }
      >
        <div className="space-y-3 px-4 py-3">
          <p className="text-sm text-[var(--color-text-muted)]">
            Download a span of chapters; already-downloaded ones are skipped.
          </p>
          {(
            [
              ['From Ch.', rangeFrom, setRangeFrom],
              ['To Ch.', rangeTo, setRangeTo],
            ] as const
          ).map(([lbl, val, set]) => (
            <label key={lbl} className="flex items-center justify-between gap-4 text-sm">
              {lbl}
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={val}
                onChange={(e) => set(e.target.value)}
                className="h-11 w-28 rounded-lg border border-[var(--color-glass-border)] bg-[var(--color-bg-secondary)] px-3 text-right"
              />
            </label>
          ))}
          <p className="text-sm text-[var(--color-text-secondary)]">
            {range.inRange} chapters · {range.skipped} already downloaded, {range.toDownload.length} will download
          </p>
        </div>
      </BottomSheet>

      <BottomSheet
        isOpen={sheet === 'confirmDelete'}
        onClose={() => setSheet(null)}
        title={rowChapter ? `Delete Chapter ${rowChapter.number}?` : ''}
        footer={
          <>
            <button className="btn min-h-11 flex-1" onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button
              className="btn min-h-11 flex-1 bg-[var(--color-accent-primary)] text-white"
              onClick={() => {
                setSheet(null)
                if (rowChapter) void deleteDownload(rowChapter)
              }}
            >
              Delete download
            </button>
          </>
        }
      >
        <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          Remove the saved pages for {details.title} Chapter {rowChapter?.number} from this phone. You can download them
          again later.
        </p>
      </BottomSheet>

      <BottomSheet isOpen={sheet === 'menu'} onClose={() => setSheet(null)} title={title}>
        <SheetOption
          icon={<Check size={18} />}
          onClick={() => {
            setSheet(null)
            setTab('chapters')
            setSelecting(true)
          }}
        >
          Select chapters
        </SheetOption>
        <SheetOption
          icon={<Loader2 size={18} />}
          onClick={() => {
            setSheet(null)
            setReloadKey((k) => k + 1)
          }}
        >
          Reload
        </SheetOption>
      </BottomSheet>
    </PushedScreen>
  )
}

function toMediaEntry(id: string, extensionId: string, d: MangaDetails, count: number): MediaEntry {
  const now = new Date().toISOString()
  return {
    id,
    extension_id: extensionId,
    title: d.title,
    english_name: d.english_name,
    native_name: d.native_name,
    description: d.description,
    cover_url: d.cover_url,
    banner_url: d.cover_url,
    trailer_url: undefined,
    media_type: 'manga',
    content_type: d.type,
    status: d.status,
    year: d.year,
    rating: d.rating,
    episode_count: count,
    episode_duration: undefined,
    season_quarter: undefined,
    season_year: undefined,
    aired_start_year: undefined,
    aired_start_month: undefined,
    aired_start_date: undefined,
    genres: d.genres ? JSON.stringify(d.genres) : undefined,
    created_at: now,
    updated_at: now,
  }
}
