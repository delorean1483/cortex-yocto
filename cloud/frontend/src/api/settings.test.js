import { describe, it, expect } from 'vitest'
import { INTERVAL_CHOICES, intervalStatus, PENDING_TIMEOUT_MS } from './settings.js'

describe('settings', () => {
  it('offers 5, 10, 15 and 20 seconds', () => expect(INTERVAL_CHOICES).toEqual([5, 10, 15, 20]))

  it('idle when nothing was requested', () => {
    expect(intervalStatus({ reported: 10, requested: null, sentAt: null, now: 0 })).toBe('idle')
  })
  it('pending until the unit reports the requested value', () => {
    expect(intervalStatus({ reported: 10, requested: 15, sentAt: 1000, now: 5000 })).toBe('pending')
  })
  it('confirmed once reported matches', () => {
    expect(intervalStatus({ reported: 15, requested: 15, sentAt: 1000, now: 5000 })).toBe('confirmed')
  })
  it('unconfirmed after the 2-minute timeout', () => {
    expect(PENDING_TIMEOUT_MS).toBe(120000)
    expect(intervalStatus({ reported: 10, requested: 15, sentAt: 0, now: 120001 })).toBe('unconfirmed')
    expect(intervalStatus({ reported: 10, requested: 15, sentAt: 0, now: 119999 })).toBe('pending')
  })
  it('no reported value yet counts as pending, then unconfirmed', () => {
    expect(intervalStatus({ reported: undefined, requested: 5, sentAt: 0, now: 1 })).toBe('pending')
    expect(intervalStatus({ reported: undefined, requested: 5, sentAt: 0, now: 200000 })).toBe('unconfirmed')
  })
})
