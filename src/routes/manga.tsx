import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/manga')({
  component: MangaScreen,
})

function MangaScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-[var(--color-accent-primary)] mb-4">
          Manga
        </h1>
        <p className="text-[var(--color-text-secondary)]">
          Browse and read manga (Coming in Phase 4)
        </p>
      </div>
    </div>
  )
}
