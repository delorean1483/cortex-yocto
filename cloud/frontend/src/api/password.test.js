import { describe, it, expect } from 'vitest'
import { passwordProblem, generatePassword, PASSWORD_HINT } from './password.js'

describe('passwordProblem', () => {
  it('passes a password that meets every rule', () => {
    expect(passwordProblem('Abcdefgh123!')).toBeNull()
    expect(passwordProblem('Fleet truck 42 rolls#')).toBeNull()
  })

  it('names everything that is missing', () => {
    expect(passwordProblem('abc')).toBe('Needs 12+ characters, an uppercase letter, a number and a symbol.')
    expect(passwordProblem('Abcdefghijk1')).toBe('Needs a symbol.')
    expect(passwordProblem('')).toContain('12+ characters')
    expect(passwordProblem(undefined)).toContain('12+ characters')
  })

  it('rejects a leading or trailing space (Cognito does)', () => {
    expect(passwordProblem(' Abcdefgh123!')).toMatch(/space/)
    expect(passwordProblem('Abcdefgh123! ')).toMatch(/space/)
  })

  it('has a one-line hint for forms', () => {
    expect(PASSWORD_HINT).toMatch(/12 characters/)
  })
})

describe('generatePassword', () => {
  it('always meets the rules, 16 characters, nothing easy to misread', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword()
      expect(pw).toHaveLength(16)
      expect(passwordProblem(pw)).toBeNull()
      expect(pw).not.toMatch(/[0O1lI]/)
    }
  })

  it('gives a different password each time', () => {
    expect(new Set(Array.from({ length: 20 }, () => generatePassword())).size).toBe(20)
  })
})
