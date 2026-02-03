/**
 * TagDropdown Component
 *
 * Dropdown filter for filtering library by tags.
 * Shows all tags with their item counts and allows selection.
 */

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Tags, Settings } from 'lucide-react'
import type { LibraryTagWithCount } from '@/utils/tauri-commands'

interface TagDropdownProps {
  tags: LibraryTagWithCount[]
  selectedTagId: number | null
  onSelectTag: (tagId: number | null) => void
  onManageTags: () => void
}

export function TagDropdown({
  tags,
  selectedTagId,
  onSelectTag,
  onManageTags,
}: TagDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Get selected tag info
  const selectedTag = selectedTagId
    ? tags.find(t => t.tag.id === selectedTagId)?.tag
    : null

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
          selectedTagId
            ? 'bg-[var(--color-accent-primary)] text-white'
            : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
        }`}
      >
        {selectedTag ? (
          <>
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: selectedTag.color }}
            />
            <span>{selectedTag.name}</span>
          </>
        ) : (
          <>
            <Tags className="w-4 h-4" />
            <span>All Tags</span>
          </>
        )}
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-56 bg-[var(--color-bg-secondary)] rounded-lg shadow-xl border border-[var(--color-bg-hover)] z-50 overflow-hidden">
          {/* All Tags option */}
          <button
            onClick={() => {
              onSelectTag(null)
              setIsOpen(false)
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
              selectedTagId === null
                ? 'bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-primary)]'
                : 'hover:bg-[var(--color-bg-hover)]'
            }`}
          >
            <Tags className="w-4 h-4" />
            <span className="flex-1">All Tags</span>
          </button>

          {tags.length > 0 && (
            <>
              <div className="border-t border-[var(--color-bg-hover)]" />

              {/* Tag list */}
              <div className="max-h-64 overflow-y-auto">
                {tags.map(({ tag, item_count }) => (
                  <button
                    key={tag.id}
                    onClick={() => {
                      onSelectTag(tag.id)
                      setIsOpen(false)
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      selectedTagId === tag.id
                        ? 'bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-primary)]'
                        : 'hover:bg-[var(--color-bg-hover)]'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="flex-1 truncate">{tag.name}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {item_count}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="border-t border-[var(--color-bg-hover)]" />

          {/* Manage Tags button */}
          <button
            onClick={() => {
              onManageTags()
              setIsOpen(false)
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <Settings className="w-4 h-4" />
            <span>Manage Tags</span>
          </button>
        </div>
      )}
    </div>
  )
}
