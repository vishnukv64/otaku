/**
 * Phone long-press quick-actions sheet for any poster (mock: design/files/home.html).
 * `usePosterLongPress` returns handlers for the poster button; render <PosterQuickActions> once beside it.
 */
import { useRef, useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Play, BookmarkPlus, Info, Download, Share2, EyeOff } from 'lucide-react'
import { BottomSheet, SheetOption } from '@/components/ui/BottomSheet'
import { addToLibrary, setMediaFeedback } from '@/utils/tauri-commands'
import { notifySuccess, notifyError } from '@/utils/notify'
import { isMobile } from '@/utils/platform'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import type { SearchResult } from '@/types/extension'

export function usePosterLongPress() {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)
  const start = useRef({ x: 0, y: 0 })

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const handlers = isMobile()
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          fired.current = false
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
          timer.current = setTimeout(() => {
            fired.current = true
            navigator.vibrate?.(10)
            setOpen(true)
          }, 450)
        },
        onTouchMove: (e: React.TouchEvent) => {
          const t = e.touches[0]
          if (Math.abs(t.clientX - start.current.x) > 8 || Math.abs(t.clientY - start.current.y) > 8) cancel()
        },
        onTouchEnd: cancel,
        onTouchCancel: cancel,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        // Swallow the click that follows a long press.
        onClickCapture: (e: React.MouseEvent) => {
          if (fired.current) {
            fired.current = false
            e.stopPropagation()
            e.preventDefault()
          }
        },
      }
    : {}

  return { open, setOpen, handlers }
}

export function PosterQuickActions({
  media,
  isOpen,
  onClose,
  onDetails,
}: {
  media: SearchResult
  isOpen: boolean
  onClose: () => void
  onDetails?: () => void
}) {
  const navigate = useNavigate()
  const { isOnline } = useNetworkStatus()
  const isManga = media.media_type === 'manga'
  const run = (fn: () => void | Promise<void>) => () => {
    onClose()
    void fn()
  }

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: media.title, text: media.title })
      else {
        await navigator.clipboard.writeText(media.title)
        notifySuccess('Copied', `Copied "${media.title}"`)
      }
    } catch {
      /* share cancelled */
    }
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={media.title}>
      {!isManga && (
        <SheetOption
          icon={<Play size={20} />}
          disabled={!isOnline}
          onClick={run(() => void navigate({ to: '/watch', search: { malId: media.id } }))}
        >
          Play
        </SheetOption>
      )}
      <SheetOption
        icon={<BookmarkPlus size={20} />}
        onClick={run(async () => {
          try {
            await addToLibrary(media.id, isManga ? 'plan_to_read' : 'plan_to_watch')
            notifySuccess('Added', `Added "${media.title}" to your library`)
          } catch {
            notifyError('Failed', 'Could not add to library')
          }
        })}
      >
        Add to Library
      </SheetOption>
      <SheetOption icon={<Info size={20} />} onClick={run(() => onDetails?.())}>
        Details
      </SheetOption>
      {!isManga && (
        <SheetOption icon={<Download size={20} />} disabled={!isOnline} onClick={run(() => onDetails?.())}>
          Download episodes
        </SheetOption>
      )}
      <SheetOption icon={<Share2 size={20} />} onClick={run(share)}>
        Share
      </SheetOption>
      <SheetOption
        destructive
        icon={<EyeOff size={20} />}
        onClick={run(async () => {
          try {
            await setMediaFeedback(media.id, 'disliked')
            notifySuccess('Got it', `We'll show less like "${media.title}"`)
          } catch {
            notifyError('Failed', 'Could not save feedback')
          }
        })}
      >
        Not interested
      </SheetOption>
    </BottomSheet>
  )
}
