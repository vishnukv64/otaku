/**
 * Platform detection utilities for mobile/desktop UI branching.
 * Uses navigator.userAgent which is available synchronously in the Tauri WebView.
 */

export function isMobile(): boolean {
  return /Android|iPhone|iPad/i.test(navigator.userAgent)
}

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent)
}

export function isIOS(): boolean {
  return /iPhone|iPad/i.test(navigator.userAgent)
}

export function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth
}

export function isLandscape(): boolean {
  return window.innerWidth >= window.innerHeight
}
