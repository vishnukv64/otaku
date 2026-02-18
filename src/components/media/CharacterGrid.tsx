import type { JikanCharacterEntry } from '@/utils/tauri-commands'

interface CharacterGridProps {
  characters: JikanCharacterEntry[]
  loading?: boolean
}

function getCharacterImage(character: JikanCharacterEntry): string | undefined {
  const imgs = character.character.images
  if (!imgs) return undefined
  return imgs.webp?.image_url || imgs.jpg?.image_url || undefined
}

function getVoiceActorImage(va: { person: { images?: { webp?: { image_url?: string }; jpg?: { image_url?: string } } } }): string | undefined {
  const imgs = va.person.images
  if (!imgs) return undefined
  return imgs.webp?.image_url || imgs.jpg?.image_url || undefined
}

export function CharacterGrid({ characters, loading }: CharacterGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="w-20 h-20 sm:w-24 sm:h-24 lg:w-28 lg:h-28 rounded-lg bg-[var(--color-bg-hover)] mx-auto" />
            <div className="h-3 bg-[var(--color-bg-hover)] rounded mt-2 w-3/4 mx-auto" />
          </div>
        ))}
      </div>
    )
  }

  if (characters.length === 0) {
    return (
      <p className="text-center py-8 text-[var(--color-text-secondary)]">
        No character data available
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
      {characters.map((entry) => {
        const imgUrl = getCharacterImage(entry)
        const primaryVa = entry.voice_actors?.find(va => va.language === 'Japanese') || entry.voice_actors?.[0]

        return (
          <div key={entry.character.mal_id} className="text-center">
            <div className="relative mx-auto w-20 h-20 sm:w-24 sm:h-24 lg:w-28 lg:h-28 rounded-lg overflow-hidden bg-[var(--color-bg-secondary)]">
              {imgUrl ? (
                <img
                  src={imgUrl}
                  alt={entry.character.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[var(--color-text-muted)] text-2xl">
                  ?
                </div>
              )}
              {entry.role && (
                <span className={`absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  entry.role === 'Main'
                    ? 'bg-[var(--color-accent-primary)] text-white'
                    : 'bg-black/60 text-white'
                }`}>
                  {entry.role}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm font-medium text-[var(--color-text-primary)] truncate sm:whitespace-normal sm:line-clamp-2">
              {entry.character.name}
            </p>
            {primaryVa && (
              <div className="hidden sm:flex items-center gap-1.5 justify-center mt-1">
                {getVoiceActorImage(primaryVa) && (
                  <img
                    src={getVoiceActorImage(primaryVa)!}
                    alt={primaryVa.person.name}
                    className="w-5 h-5 rounded-full object-cover"
                    loading="lazy"
                  />
                )}
                <p className="text-xs text-[var(--color-text-muted)] truncate">
                  {primaryVa.person.name}
                  {primaryVa.language && <span className="hidden lg:inline"> ({primaryVa.language})</span>}
                </p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
