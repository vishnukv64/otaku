import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import './index.css'
import { invoke } from '@tauri-apps/api/core'
import { isIOS, isMobile } from '@/utils/platform'

// Import the generated route tree
import { routeTree } from './routeTree.gen'

if (isMobile()) {
  // No page pinch/double-tap zoom on phones; custom pinch handlers still get touch events.
  document.documentElement.style.touchAction = 'pan-x pan-y'
}

if (isIOS()) {
  // WKWebView ignores user-scalable=no; block its native pinch/zoom gestures.
  // The reader's own pinch zoom uses touch events, which this leaves alone.
  for (const ev of ['gesturestart', 'gesturechange'] as const) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
  }
  // The app is portrait-only; the player widens this while it is open.
  // Again after first paint: at module load the native root view controller may not
  // exist yet, and the mask only takes effect once the swizzle is installed.
  const portrait = () => void invoke('set_orientation', { mode: 'app' }).catch(() => {})
  portrait()
  window.addEventListener('load', () => setTimeout(portrait, 500), { once: true })
}

// Create a new router instance
const router = createRouter({ routeTree })

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
