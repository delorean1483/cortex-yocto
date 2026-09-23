import { describe, it, expect } from 'vitest'
import { canWrite } from './permissions.js'

describe('canWrite (frontend mirror)', () => {
  it('admin/fm all', () => {
    for (const a of ['heater', 'apu', 'ota', 'apu_ota']) {
      expect(canWrite('admin', a)).toBe(true)
      expect(canWrite('fm', a)).toBe(true)
    }
  })
  it('maint heater only (no apu/ota/apu_ota)', () => {
    expect(canWrite('maint', 'heater')).toBe(true)
    expect(canWrite('maint', 'apu')).toBe(false)
    expect(canWrite('maint', 'ota')).toBe(false)
    expect(canWrite('maint', 'apu_ota')).toBe(false)
  })
  it('eu none', () => {
    for (const a of ['heater', 'apu', 'ota', 'apu_ota']) expect(canWrite('eu', a)).toBe(false)
  })
})

describe('location permission', () => {
  it('admin and fm can set locations; maint and eu cannot', () => {
    expect(canWrite('admin', 'location')).toBe(true)
    expect(canWrite('fm', 'location')).toBe(true)
    expect(canWrite('maint', 'location')).toBe(false)
    expect(canWrite('eu', 'location')).toBe(false)
  })
})
