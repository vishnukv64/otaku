import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-[#141414] text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-5xl font-bold mb-4 text-[#e50914]">
          Otaku
        </h1>
        <p className="text-xl text-[#b3b3b3] mb-8">
          Cross-Platform Anime & Manga Viewer
        </p>
        <button
          onClick={() => setCount((count) => count + 1)}
          className="bg-[#e50914] hover:bg-[#f40612] text-white px-6 py-3 rounded transition-colors"
        >
          Count: {count}
        </button>
        <p className="mt-8 text-sm text-[#b3b3b3]">
          Phase 1, Week 1: Project Setup in Progress
        </p>
      </div>
    </div>
  )
}

export default App
