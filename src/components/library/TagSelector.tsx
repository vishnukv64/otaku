/**
 * TagSelector Component
 *
 * Popover for assigning tags to a media item.
 * Shows checkbox list of all tags with quick-create option.
 */

import { useState, useEffect, useRef } from 'react'
import { Plus, Tags, Loader2, X, Check } from 'lucide-react'
import {
  getLibraryTags,
  getMediaTags,
  assignLibraryTag,
  unassignLibraryTag,
  createLibraryTag,
  type LibraryTag,
} from '@/utils/tauri-commands'
import { notifyError } from '@/utils/notify'

// Default color for quick-created tags
const DEFAULT_TAG_COLOR = '#6366f1'

interface TagSelectorProps {
  mediaId: string
  isOpen: boolean
  onClose: () => void
  onTagsChange?: () => void
  anchorRef?: React.RefObject<HTMLElement | null>
}

export function TagSelector({
  mediaId,
  isOpen,
  onClose,
  onTagsChange,
  anchorRef,
}: TagSelectorProps) {
  const [allTags, setAllTags] = useState<LibraryTag[]>([])
  const [assignedTagIds, setAssignedTagIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [togglingTag, setTogglingTag] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [creating, setCreating] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Load tags when popover opens
  useEffect(() => {
    if (isOpen) {
      loadTags()
    }
  }, [isOpen, mediaId])

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        anchorRef?.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose, anchorRef])

  const loadTags = async () => {
    setLoading(true)
    try {
      const [all, assigned] = await Promise.all([
        getLibraryTags(),
        getMediaTags(mediaId),
      ])
      setAllTags(all)
      setAssignedTagIds(new Set(assigned.map(t => t.id)))
    } catch (error) {
      console.error('Failed to load tags:', error)
      notifyError('Error', 'Failed to load tags')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleTag = async (tagId: number, isAssigned: boolean) => {
    setTogglingTag(tagId)
    try {
      if (isAssigned) {
        await unassignLibraryTag(mediaId, tagId)
        setAssignedTagIds(prev => {
          const next = new Set(prev)
          next.delete(tagId)
          return next
        })
      } else {
        await assignLibraryTag(mediaId, tagId)
        setAssignedTagIds(prev => new Set([...prev, tagId]))
      }
      onTagsChange?.()
    } catch (error) {
      console.error('Failed to toggle tag:', error)
      notifyError('Error', `Failed to ${isAssigned ? 'remove' : 'add'} tag`)
    } finally {
      setTogglingTag(null)
    }
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return

    setCreating(true)
    try {
      const newTag = await createLibraryTag(newTagName.trim(), DEFAULT_TAG_COLOR)
      // Assign the new tag to this media
      await assignLibraryTag(mediaId, newTag.id)
      setAllTags(prev => [...prev, newTag])
      setAssignedTagIds(prev => new Set([...prev, newTag.id]))
      setNewTagName('')
      setShowCreate(false)
      onTagsChange?.()
    } catch (error) {
      console.error('Failed to create tag:', error)
      notifyError('Error', 'Failed to create tag')
    } finally {
      setCreating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      ref={popoverRef}
      className="absolute left-0 top-full mt-2 w-64 bg-[var(--color-bg-secondary)] rounded-lg shadow-xl border border-[var(--color-bg-hover)] z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-bg-hover)]">
        <span className="text-sm font-medium flex items-center gap-2">
          <Tags className="w-4 h-4" />
          Tags
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--color-accent-primary)]" />
          </div>
        ) : allTags.length === 0 && !showCreate ? (
          <div className="py-4 px-3 text-center">
            <p className="text-sm text-[var(--color-text-muted)] mb-3">
              No tags yet
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="text-sm text-[var(--color-accent-primary)] hover:underline"
            >
              Create your first tag
            </button>
          </div>
        ) : (
          <div className="py-1">
            {allTags.map(tag => {
              const isAssigned = assignedTagIds.has(tag.id)
              const isToggling = togglingTag === tag.id

              return (
                <button
                  key={tag.id}
                  onClick={() => handleToggleTag(tag.id, isAssigned)}
                  disabled={isToggling}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50"
                >
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      isAssigned
                        ? 'border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]'
                        : 'border-[var(--color-text-muted)]'
                    }`}
                  >
                    {isToggling ? (
                      <Loader2 className="w-3 h-3 animate-spin text-white" />
                    ) : isAssigned ? (
                      <Check className="w-3 h-3 text-white" />
                    ) : null}
                  </div>
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="flex-1 text-sm truncate">{tag.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Create new tag */}
      <div className="border-t border-[var(--color-bg-hover)]">
        {showCreate ? (
          <div className="p-2 space-y-2">
            <input
              type="text"
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              placeholder="Tag name"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-hover)] border border-transparent focus:outline-none focus:border-[var(--color-accent-primary)] text-sm"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateTag()
                if (e.key === 'Escape') {
                  setShowCreate(false)
                  setNewTagName('')
                }
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCreate(false)
                  setNewTagName('')
                }}
                className="flex-1 py-1.5 rounded-lg text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTag}
                disabled={!newTagName.trim() || creating}
                className="flex-1 py-1.5 rounded-lg text-sm bg-[var(--color-accent-primary)] text-white hover:bg-[var(--color-accent-primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  'Create'
                )}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create new tag
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * TagChips Component
 *
 * Displays assigned tags as colored chips.
 * Used in media detail modals to show current tags.
 */
interface TagChipsProps {
  tags: LibraryTag[]
  onRemove?: (tagId: number) => void
  className?: string
}

export function TagChips({ tags, onRemove, className = '' }: TagChipsProps) {
  if (tags.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {tags.map(tag => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white"
          style={{ backgroundColor: tag.color }}
        >
          {tag.name}
          {onRemove && (
            <button
              onClick={e => {
                e.stopPropagation()
                onRemove(tag.id)
              }}
              className="p-0.5 rounded-full hover:bg-white/20 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
