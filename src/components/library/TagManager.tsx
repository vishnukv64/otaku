/**
 * TagManager Component
 *
 * Modal for managing library tags (create, edit, delete).
 * Shows all tags with inline editing for name and color.
 */

import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Check, Loader2 } from 'lucide-react'
import {
  getLibraryTagsWithCounts,
  createLibraryTag,
  updateLibraryTag,
  deleteLibraryTag,
  type LibraryTagWithCount,
} from '@/utils/tauri-commands'
import { notifySuccess, notifyError } from '@/utils/notify'

// Predefined color palette
const TAG_COLORS = [
  '#6366f1', // Indigo (default)
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#64748b', // Gray
]

interface TagManagerProps {
  isOpen: boolean
  onClose: () => void
  onTagsChange?: () => void
}

export function TagManager({ isOpen, onClose, onTagsChange }: TagManagerProps) {
  const [tags, setTags] = useState<LibraryTagWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0])
  const [creating, setCreating] = useState(false)
  const [editingTag, setEditingTag] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [deletingTag, setDeletingTag] = useState<number | null>(null)

  // Load tags when modal opens
  useEffect(() => {
    if (isOpen) {
      loadTags()
    }
  }, [isOpen])

  const loadTags = async () => {
    setLoading(true)
    try {
      const result = await getLibraryTagsWithCounts()
      setTags(result)
    } catch (error) {
      console.error('Failed to load tags:', error)
      notifyError('Error', 'Failed to load tags')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return

    setCreating(true)
    try {
      await createLibraryTag(newTagName.trim(), newTagColor)
      setNewTagName('')
      setNewTagColor(TAG_COLORS[0])
      await loadTags()
      onTagsChange?.()
      notifySuccess('Tag Created', `Created tag "${newTagName.trim()}"`)
    } catch (error) {
      console.error('Failed to create tag:', error)
      notifyError('Error', 'Failed to create tag')
    } finally {
      setCreating(false)
    }
  }

  const handleStartEdit = (tag: LibraryTagWithCount['tag']) => {
    setEditingTag(tag.id)
    setEditName(tag.name)
    setEditColor(tag.color)
  }

  const handleSaveEdit = async () => {
    if (!editingTag || !editName.trim()) return

    try {
      await updateLibraryTag(editingTag, editName.trim(), editColor)
      setEditingTag(null)
      await loadTags()
      onTagsChange?.()
      notifySuccess('Tag Updated', `Updated tag "${editName.trim()}"`)
    } catch (error) {
      console.error('Failed to update tag:', error)
      notifyError('Error', 'Failed to update tag')
    }
  }

  const handleCancelEdit = () => {
    setEditingTag(null)
    setEditName('')
    setEditColor('')
  }

  const handleDeleteTag = async (tagId: number, tagName: string) => {
    setDeletingTag(tagId)
    try {
      await deleteLibraryTag(tagId)
      await loadTags()
      onTagsChange?.()
      notifySuccess('Tag Deleted', `Deleted tag "${tagName}"`)
    } catch (error) {
      console.error('Failed to delete tag:', error)
      notifyError('Error', 'Failed to delete tag')
    } finally {
      setDeletingTag(null)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="bg-[var(--color-bg-primary)] rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-bg-hover)]">
          <h2 className="text-lg font-semibold">Manage Tags</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Create new tag */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">
              Create New Tag
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                placeholder="Tag name"
                className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-bg-hover)] focus:outline-none focus:border-[var(--color-accent-primary)] text-sm"
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateTag()
                }}
              />
              <button
                onClick={handleCreateTag}
                disabled={!newTagName.trim() || creating}
                className="px-3 py-2 rounded-lg bg-[var(--color-accent-primary)] text-white font-medium hover:bg-[var(--color-accent-primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Color picker for new tag */}
            <div className="flex gap-2">
              {TAG_COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => setNewTagColor(color)}
                  className={`w-6 h-6 rounded-full transition-transform ${
                    newTagColor === color ? 'ring-2 ring-offset-2 ring-offset-[var(--color-bg-primary)] ring-white scale-110' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Existing tags */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">
              Your Tags ({tags.length})
            </label>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-primary)]" />
              </div>
            ) : tags.length === 0 ? (
              <p className="text-center py-8 text-[var(--color-text-muted)]">
                No tags yet. Create one above!
              </p>
            ) : (
              <div className="space-y-2">
                {tags.map(({ tag, item_count }) => (
                  <div
                    key={tag.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-bg-secondary)]"
                  >
                    {editingTag === tag.id ? (
                      <>
                        {/* Editing mode */}
                        <div className="flex flex-wrap gap-1.5">
                          {TAG_COLORS.map(color => (
                            <button
                              key={color}
                              onClick={() => setEditColor(color)}
                              className={`w-5 h-5 rounded-full transition-transform ${
                                editColor === color ? 'ring-2 ring-offset-1 ring-offset-[var(--color-bg-secondary)] ring-white scale-110' : ''
                              }`}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                        <input
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          className="flex-1 px-2 py-1 rounded bg-[var(--color-bg-hover)] border border-transparent focus:outline-none focus:border-[var(--color-accent-primary)] text-sm"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                        />
                        <button
                          onClick={handleSaveEdit}
                          className="p-1.5 rounded-lg text-green-500 hover:bg-green-500/10 transition-colors"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Display mode */}
                        <span
                          className="w-4 h-4 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <button
                          onClick={() => handleStartEdit(tag)}
                          className="flex-1 text-left hover:text-[var(--color-accent-primary)] transition-colors"
                        >
                          {tag.name}
                        </button>
                        <span className="text-xs text-[var(--color-text-muted)] px-2">
                          {item_count} {item_count === 1 ? 'item' : 'items'}
                        </span>
                        <button
                          onClick={() => handleDeleteTag(tag.id, tag.name)}
                          disabled={deletingTag === tag.id}
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                          {deletingTag === tag.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--color-bg-hover)]">
          <button
            onClick={onClose}
            className="w-full py-2 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
