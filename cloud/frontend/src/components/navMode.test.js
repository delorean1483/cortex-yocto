import { describe, it, expect } from 'vitest'
import { navMode } from './navMode.js'

describe('navMode', () => {
  it('phones get the drawer', () => {
    expect(navMode(390)).toBe('drawer')
    expect(navMode(767)).toBe('drawer')
  })
  it('tablets and small laptops get the icon rail', () => {
    expect(navMode(768)).toBe('rail')
    expect(navMode(1024)).toBe('rail')
    expect(navMode(1199)).toBe('rail')
  })
  it('desktops keep the full sidebar', () => {
    expect(navMode(1200)).toBe('full')
    expect(navMode(1440)).toBe('full')
  })
})
