import { useState } from 'react'
import type { JikanCharacterEntry } from '@/utils/tauri-commands'

const CHARS_PER_PAGE = 24

interface CharacterGridProps {
  characters: JikanCharacterEntry[]
  loading?: boolean
}

function getCharacterImage(character: JikanCharacterEntry): string | undefined {
  const imgs = character.character.images
  if (!imgs) return undefined
  return imgs.webp?.image_url || imgs.jpg?.image_url || undefined
}

export function CharacterGrid({ characters, loading }: CharacterGridProps) {
  const [page, setPage] = useState(1)
  const visibleCharacters = characters.slice(0, page * CHARS_PER_PAGE)
  const hasMore = visibleCharacters.length < characters.length

  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="animate-pulse text-center">
            <div className="aspect-[2/3] rounded-xl bg-[var(--color-surface)]" />
            <div className="h-3 bg-[var(--color-surface)] rounded mt-2 w-3/4 mx-auto" />
          </div>
        ))}
      </div>
    )
  }

  if (characters.length === 0) {
    return (
      <p className="text-center py-8 text-[var(--color-text-muted)]">
        No character data available
      </p>
    )
  }

  return (
    <div>
      {characters.length > CHARS_PER_PAGE && (
        <p className="text-sm text-[var(--color-text-muted)] mb-3">
          Showing {visibleCharacters.length} of {characters.length} characters
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
        {visibleCharacters.map((entry) => {
          const imgUrl = getCharacterImage(entry)

          return (
            <div key={entry.character.mal_id} className="text-center group/char cursor-pointer">
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-[var(--color-card)] border-2 border-[var(--color-glass-border)] group-hover/char:border-[var(--color-accent-mid)] transition-all duration-150">
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt={entry.character.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--color-text-dim)] text-2xl">
                    ?
                  </div>
                )}
              </div>
              <p className="mt-2 text-[0.8125rem] font-semibold text-white truncate sm:whitespace-normal sm:line-clamp-2">
                {entry.character.name}
              </p>
              {entry.role && (
                <p className="text-[0.7rem] text-[var(--color-text-muted)]">
                  {entry.role}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {hasMore && (
        <div className="flex justify-center mt-6">
          <button
            onClick={() => setPage(p => p + 1)}
            className="px-5 py-2 rounded-full text-sm font-medium bg-[var(--color-glass-bg)] border border-[var(--color-glass-border)] text-[var(--color-text-secondary)] hover:text-white hover:border-[var(--color-accent-primary)] transition-all"
          >
            Load More Characters
          </button>
        </div>
      )}
    </div>
  )
}
