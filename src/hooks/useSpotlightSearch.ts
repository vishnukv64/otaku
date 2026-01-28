/**
 * Hook to manage spotlight search state globally
 */

import { useState, useCallback } from 'react'
import { useKeyboardShortcut } from './useKeyboardShortcut'

export function useSpotlightSearch() {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])

  // Global keyboard shortcut for Cmd+K
  useKeyboardShortcut(
    {
      'ctrl+k': (e) => {
        e.preventDefault()
        toggle()
      },
    },
    [toggle],
    { allowInInputs: true }
  )

  return { isOpen, open, close, toggle }
}
