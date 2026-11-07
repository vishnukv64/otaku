import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import './index.css'
import { invoke } from '@tauri-apps/api/core'
import { isIOS } from '@/utils/platform'

// Import the generated route tree
import { routeTree } from './routeTree.gen'

if (isIOS()) {
  // WKWebView ignores user-scalable=no; block its native pinch/zoom gestures.
  // The reader's own pinch zoom uses touch events, which this leaves alone.
  for (const ev of ['gesturestart', 'gesturechange'] as const) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
  }
  // The app is portrait-only; the player widens this while it is open.
  void invoke('set_orientation', { mode: 'app' }).catch(() => {})
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
