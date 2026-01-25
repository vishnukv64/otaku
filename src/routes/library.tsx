import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library')({
  component: LibraryScreen,
})

function LibraryScreen() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-6xl mb-6">📚</div>
        <h1 className="text-4xl font-bold text-[var(--color-accent-primary)] mb-4">
          My Library
        </h1>
        <p className="text-lg text-[var(--color-text-secondary)] mb-2">
          Your personal collection and watch history
        </p>
        <p className="text-sm text-[var(--color-text-muted)]">
          Coming in Phase 2
        </p>
      </div>
    </div>
  )
}
