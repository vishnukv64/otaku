import { describe, expect, it } from 'vitest'
import { displayTitle } from './mediaHelpers'

describe('displayTitle', () => {
  it('prefers english, falls back to title', () => {
    expect(displayTitle({ title: 'Hagane no Renkinjutsushi', english_name: 'Fullmetal Alchemist' })).toBe('Fullmetal Alchemist')
    expect(displayTitle({ title: 'X', english_name: ' ' })).toBe('X')
    expect(displayTitle({ title: 'X', english_name: null })).toBe('X')
  })
})
