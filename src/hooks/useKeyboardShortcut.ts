/**
 * useKeyboardShortcut Hook
 *
 * Handles global keyboard shortcuts
 */

import { useEffect } from 'react'

type KeyHandler = (event: KeyboardEvent) => void

interface KeyMap {
  [key: string]: KeyHandler
}

export function useKeyboardShortcut(keyMap: KeyMap, deps: React.DependencyList = []) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Build key combination string (e.g., "ctrl+k", "shift+/", "escape")
      const key = event.key.toLowerCase()
      const modifiers = []

      if (event.ctrlKey || event.metaKey) modifiers.push('ctrl')
      if (event.altKey) modifiers.push('alt')
      if (event.shiftKey) modifiers.push('shift')

      const combination = modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key

      // Check if we have a handler for this key combination
      const handler = keyMap[combination] || keyMap[key]

      if (handler) {
        // Don't trigger if user is typing in an input/textarea
        const target = event.target as HTMLElement
        const isInputField =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable

        // Allow escape key even in input fields
        if (!isInputField || key === 'escape') {
          handler(event)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, deps)
}
