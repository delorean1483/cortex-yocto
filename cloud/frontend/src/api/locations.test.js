import { describe, it, expect } from 'vitest'
import { parseCoord, validateLatLon, orderMapRows } from './locations.js'

describe('parseCoord', () => {
  it('parses decimal strings', () => {
    expect(parseCoord('32.7767')).toBe(32.7767)
    expect(parseCoord(' -96.8 ')).toBe(-96.8)
  })
  it('rejects blanks, words and comma decimals', () => {
    expect(parseCoord('')).toBeNull()
    expect(parseCoord('   ')).toBeNull()
    expect(parseCoord('abc')).toBeNull()
    expect(parseCoord('32,77')).toBeNull()
    expect(parseCoord('1e3x')).toBeNull()
  })
})

describe('validateLatLon', () => {
  it('accepts in-range values and trims the label', () => {
    expect(validateLatLon('32.9', '-97.04', ' Yard ')).toEqual({
      ok: true, value: { lat: 32.9, lon: -97.04, label: 'Yard' }, errors: {},
    })
  })
  it('empty label becomes null', () => {
    expect(validateLatLon('1', '2', '').value.label).toBeNull()
  })
  it('reports each bad field', () => {
    const r = validateLatLon('abc', '200', 'x'.repeat(61))
    expect(r.ok).toBe(false)
    expect(r.errors.lat).toMatch(/Latitude/)
    expect(r.errors.lon).toMatch(/Longitude/)
    expect(r.errors.label).toMatch(/60/)
  })
  it('range edges', () => {
    expect(validateLatLon('90', '180', '').ok).toBe(true)
    expect(validateLatLon('-90.01', '0', '').errors.lat).toBeTruthy()
  })
})

describe('orderMapRows', () => {
  const row = (unit, tone, location) => ({ u: { unit }, view: tone ? { tone } : undefined, location })
  it('splits placed and unplaced, each fault-first', () => {
    const { placed, unplaced } = orderMapRows([
      row('A', 'ok', { lat: 1, lon: 1 }),
      row('B', 'ok', undefined),
      row('C', 'err', { lat: 2, lon: 2 }),
      row('D', 'off', undefined),
    ])
    expect(placed.map((r) => r.u.unit)).toEqual(['C', 'A'])
    expect(unplaced.map((r) => r.u.unit)).toEqual(['D', 'B'])
  })
})
