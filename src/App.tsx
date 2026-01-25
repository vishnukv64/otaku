import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-5xl font-bold mb-4 text-[var(--color-accent-primary)]">
          Otaku
        </h1>
        <p className="text-xl text-[var(--color-text-secondary)] mb-8">
          Cross-Platform Anime & Manga Viewer
        </p>
        <button
          onClick={() => setCount((count) => count + 1)}
          className="bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-hover)] text-white px-6 py-3 rounded transition-colors"
        >
          Count: {count}
        </button>
        <p className="mt-8 text-sm text-[var(--color-text-secondary)]">
          Phase 1, Week 1: Project Setup Complete ✅
        </p>
      </div>
    </div>
  )
}

export default App
