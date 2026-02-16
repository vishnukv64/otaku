/**
 * BulkActionBar Component
 *
 * Floating action bar for bulk operations on selected library items.
 * Shows when items are selected, allows changing status, adding/removing tags.
 */

import { useState } from 'react'
import { X, CheckSquare, Tags, Trash2, ChevronDown, Loader2 } from 'lucide-react'
import { ask } from '@tauri-apps/plugin-dialog'
import {
  getLibraryTags,
  bulkUpdateLibraryStatus,
  bulkAssignLibraryTag,
  bulkUnassignLibraryTag,
  bulkRemoveFromLibrary,
  type LibraryTag,
  type LibraryStatus,
} from '@/utils/tauri-commands'
import { notifySuccess, notifyError } from '@/utils/notify'

interface BulkActionBarProps {
  selectedIds: Set<string>
  mediaType: 'anime' | 'manga'
  onClearSelection: () => void
  onActionComplete: () => void
}

const ANIME_STATUSES: { id: LibraryStatus; label: string }[] = [
  { id: 'watching', label: 'Watching' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'plan_to_watch', label: 'Plan to Watch' },
]

const MANGA_STATUSES: { id: LibraryStatus; label: string }[] = [
  { id: 'reading', label: 'Reading' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'plan_to_read', label: 'Plan to Read' },
]

export function BulkActionBar({
  selectedIds,
  mediaType,
  onClearSelection,
  onActionComplete,
}: BulkActionBarProps) {
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showTagMenu, setShowTagMenu] = useState(false)
  const [tags, setTags] = useState<LibraryTag[]>([])
  const [loading, setLoading] = useState(false)
  const [actionType, setActionType] = useState<string | null>(null)

  const statuses = mediaType === 'manga' ? MANGA_STATUSES : ANIME_STATUSES
  const selectedCount = selectedIds.size

  const loadTags = async () => {
    try {
      const result = await getLibraryTags()
      setTags(result)
    } catch (error) {
      console.error('Failed to load tags:', error)
    }
  }

  const handleStatusChange = async (status: LibraryStatus) => {
    setLoading(true)
    setActionType('status')
    try {
      await bulkUpdateLibraryStatus(Array.from(selectedIds), status)
      notifySuccess('Status Updated', `Updated ${selectedCount} items to "${statuses.find(s => s.id === status)?.label}"`)
      onClearSelection()
      onActionComplete()
    } catch (error) {
      console.error('Failed to update status:', error)
      notifyError('Error', 'Failed to update status')
    } finally {
      setLoading(false)
      setActionType(null)
      setShowStatusMenu(false)
    }
  }

  const handleAddTag = async (tagId: number, tagName: string) => {
    setLoading(true)
    setActionType('tag')
    try {
      await bulkAssignLibraryTag(Array.from(selectedIds), tagId)
      notifySuccess('Tag Added', `Added "${tagName}" to ${selectedCount} items`)
      onActionComplete()
    } catch (error) {
      console.error('Failed to add tag:', error)
      notifyError('Error', 'Failed to add tag')
    } finally {
      setLoading(false)
      setActionType(null)
      setShowTagMenu(false)
    }
  }

  const handleRemoveTag = async (tagId: number, tagName: string) => {
    setLoading(true)
    setActionType('tag')
    try {
      await bulkUnassignLibraryTag(Array.from(selectedIds), tagId)
      notifySuccess('Tag Removed', `Removed "${tagName}" from ${selectedCount} items`)
      onActionComplete()
    } catch (error) {
      console.error('Failed to remove tag:', error)
      notifyError('Error', 'Failed to remove tag')
    } finally {
      setLoading(false)
      setActionType(null)
      setShowTagMenu(false)
    }
  }

  const handleRemoveFromLibrary = async () => {
    const confirmed = await ask(`Remove ${selectedCount} items from your library?`, { kind: 'warning' })
    if (!confirmed) return

    setLoading(true)
    setActionType('remove')
    try {
      await bulkRemoveFromLibrary(Array.from(selectedIds))
      notifySuccess('Removed', `Removed ${selectedCount} items from library`)
      onClearSelection()
      onActionComplete()
    } catch (error) {
      console.error('Failed to remove from library:', error)
      notifyError('Error', 'Failed to remove from library')
    } finally {
      setLoading(false)
      setActionType(null)
    }
  }

  if (selectedCount === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-2 px-4 py-3 bg-[var(--color-bg-secondary)] rounded-xl shadow-2xl border border-[var(--color-bg-hover)]">
        {/* Selection count */}
        <div className="flex items-center gap-2 pr-4 border-r border-[var(--color-bg-hover)]">
          <CheckSquare className="w-5 h-5 text-[var(--color-accent-primary)]" />
          <span className="font-medium">{selectedCount} selected</span>
        </div>

        {/* Change Status */}
        <div className="relative">
          <button
            onClick={() => {
              setShowStatusMenu(!showStatusMenu)
              setShowTagMenu(false)
            }}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50"
          >
            {loading && actionType === 'status' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            <span>Status</span>
          </button>

          {showStatusMenu && (
            <div className="absolute bottom-full left-0 mb-2 w-48 bg-[var(--color-bg-primary)] rounded-lg shadow-xl border border-[var(--color-bg-hover)] overflow-hidden">
              {statuses.map((status) => (
                <button
                  key={status.id}
                  onClick={() => handleStatusChange(status.id)}
                  className="w-full px-4 py-2.5 text-left hover:bg-[var(--color-bg-hover)] transition-colors text-sm"
                >
                  {status.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Add/Remove Tags */}
        <div className="relative">
          <button
            onClick={() => {
              if (!showTagMenu) loadTags()
              setShowTagMenu(!showTagMenu)
              setShowStatusMenu(false)
            }}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50"
          >
            {loading && actionType === 'tag' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Tags className="w-4 h-4" />
            )}
            <span>Tags</span>
          </button>

          {showTagMenu && (
            <div className="absolute bottom-full left-0 mb-2 w-56 bg-[var(--color-bg-primary)] rounded-lg shadow-xl border border-[var(--color-bg-hover)] overflow-hidden">
              {tags.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[var(--color-text-muted)]">
                  No tags created yet
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] border-b border-[var(--color-bg-hover)]">
                    Add Tag
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {tags.map((tag) => (
                      <button
                        key={`add-${tag.id}`}
                        onClick={() => handleAddTag(tag.id, tag.name)}
                        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-[var(--color-bg-hover)] transition-colors text-sm"
                      >
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </button>
                    ))}
                  </div>
                  <div className="px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] border-y border-[var(--color-bg-hover)]">
                    Remove Tag
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {tags.map((tag) => (
                      <button
                        key={`remove-${tag.id}`}
                        onClick={() => handleRemoveTag(tag.id, tag.name)}
                        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-[var(--color-bg-hover)] transition-colors text-sm text-red-400"
                      >
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Remove from Library */}
        <button
          onClick={handleRemoveFromLibrary}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
        >
          {loading && actionType === 'remove' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
          <span>Remove</span>
        </button>

        {/* Clear Selection */}
        <button
          onClick={onClearSelection}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50 ml-2"
          title="Clear selection"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
