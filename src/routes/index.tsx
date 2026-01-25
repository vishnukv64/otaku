import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomeScreen,
})

function HomeScreen() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4">
      <div className="text-center max-w-2xl">
        <h1 className="text-5xl font-bold text-[var(--color-accent-primary)] mb-6">
          Welcome to Otaku
        </h1>
        <p className="text-xl text-[var(--color-text-secondary)] mb-8">
          Your cross-platform anime and manga viewer with a Netflix-like experience
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <div className="bg-[var(--color-bg-secondary)] p-6 rounded-lg">
            <h3 className="text-lg font-semibold mb-2">🎬 Phase 1, Week 2</h3>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Building Core UI Shell
            </p>
          </div>
          <div className="bg-[var(--color-bg-secondary)] p-6 rounded-lg">
            <h3 className="text-lg font-semibold mb-2">✅ Progress</h3>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Routing & Navigation Complete
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
