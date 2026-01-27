/// <reference types="vite/client" />

// Vitest matchers - extend with testing library matchers
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

declare module 'vitest' {
  // Extend Assertion with testing library matchers
  interface Assertion<T = unknown>
    extends TestingLibraryMatchers<typeof expect.stringContaining, T> {
    _brand: 'Assertion'
  }
  // Extend AsymmetricMatchersContaining with testing library matchers
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers {
    _brand: 'AsymmetricMatchersContaining'
  }
}
