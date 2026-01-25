import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: SettingsScreen,
})

function SettingsScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-[var(--color-accent-primary)] mb-4">
          Settings
        </h1>
        <p className="text-[var(--color-text-secondary)]">
          App preferences and configuration (Coming soon)
        </p>
      </div>
    </div>
  )
}
