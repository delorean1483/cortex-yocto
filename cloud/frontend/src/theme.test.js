import { describe, it, expect } from 'vitest'
import { resolveInitialTheme, nextTheme } from './theme.js'

describe('resolveInitialTheme', () => {
  it('honors a stored explicit choice over the system preference', () => {
    expect(resolveInitialTheme('dark', false)).toBe('dark')
    expect(resolveInitialTheme('light', true)).toBe('light')
  })
  it('falls back to the system preference when nothing is stored', () => {
    expect(resolveInitialTheme(null, true)).toBe('dark')
    expect(resolveInitialTheme(null, false)).toBe('light')
    expect(resolveInitialTheme(undefined, false)).toBe('light')
  })
  it('ignores a garbage stored value and uses the system preference', () => {
    expect(resolveInitialTheme('purple', true)).toBe('dark')
    expect(resolveInitialTheme('', false)).toBe('light')
  })
})

describe('nextTheme', () => {
  it('toggles between light and dark', () => {
    expect(nextTheme('dark')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
  })
})
