import { describe, expect, it } from 'vitest'
import { displayTitle } from './mediaHelpers'

describe('displayTitle', () => {
  it('prefers english, falls back to title', () => {
    expect(displayTitle({ title: 'Hagane no Renkinjutsushi', english_name: 'Fullmetal Alchemist' })).toBe('Fullmetal Alchemist')
    expect(displayTitle({ title: 'X', english_name: ' ' })).toBe('X')
    expect(displayTitle({ title: 'X', english_name: null })).toBe('X')
  })
})

describe('searchString', () => {
  it('turns router-parsed numbers back into strings and drops empties', async () => {
    const { searchString } = await import('./mediaHelpers')
    expect(searchString(21)).toBe('21')
    expect(searchString('21-1')).toBe('21-1')
    expect(searchString('')).toBeUndefined()
    expect(searchString(undefined)).toBeUndefined()
  })
})
