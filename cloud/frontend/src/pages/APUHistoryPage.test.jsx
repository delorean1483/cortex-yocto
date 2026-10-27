import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// listUnits returns unit OBJECTS { unit, demo } (per the /fleet/units contract,
// api.js). The page must render the unit id string, never the object — rendering
// an object as a React child throws React error #31 and blanks the whole page.
vi.mock('../api/client.js', () => ({
  api: {
    listUnits: () => Promise.resolve({
      units: [{ unit: 'TRUCK-001', demo: false }, { unit: 'APU-DEMO-01', demo: true }],
    }),
    getFaults: () => Promise.resolve({ faults: globalThis.__faults || [] }),
    // Telemetry never settles unless a test sets __tele: a slow 30-day series
    // query must not hold the fault log hostage (it used to sit on skeletons forever).
    getTelemetry: () => (globalThis.__tele
      ? Promise.resolve({ telemetry: globalThis.__tele })
      : new Promise(() => {})),
  },
}))
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ selectedUnit: 'TRUCK-001', setSelectedUnit: vi.fn() }),
}))

import APUHistoryPage from './APUHistoryPage.jsx'

describe('APUHistoryPage', () => {
  it('renders unit options as id strings from {unit,demo} objects (no React #31 crash)', async () => {
    render(<MemoryRouter><APUHistoryPage /></MemoryRouter>)
    expect(await screen.findByRole('option', { name: /TRUCK-001/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /APU-DEMO-01/ })).toBeTruthy()
  })
  it('defaults to the last 24 hours (a 30-day scan is opt-in: it is heavy on InfluxDB)', async () => {
    render(<MemoryRouter><APUHistoryPage /></MemoryRouter>)
    await screen.findByRole('option', { name: /TRUCK-001/ })
    expect(screen.getByRole('radio', { name: '24 h' }).checked).toBe(true)
  })
  it('renders the fault log without waiting on the telemetry query', async () => {
    render(<MemoryRouter><APUHistoryPage /></MemoryRouter>)
    expect(await screen.findByText(/No fault events recorded/)).toBeTruthy()
  })
  it('shows a fault heading with count, no Unit column, and no "last 1d"', async () => {
    globalThis.__faults = [
      { ts: new Date(2026, 9, 20, 21, 37).getTime(), fault: '0x0001', state: 'active' },
      { ts: new Date(2026, 9, 20, 20, 0).getTime(), fault: '0x0000', state: 'cleared' },
    ]
    const { container } = render(<MemoryRouter><APUHistoryPage /></MemoryRouter>)
    expect(await screen.findByText('Fault events · 2 in the last 24 h')).toBeTruthy()
    const heads = [...container.querySelectorAll('th')].map(th => th.textContent)
    expect(heads).not.toContain('Unit')
    expect(heads).toContain('When')
    expect(container.textContent).not.toMatch(/last 1d/)
    expect(screen.getByText('Oct 20, 9:37 PM')).toBeTruthy()
    globalThis.__faults = []
  })
  it('labels the readings table as the newest readings, not the whole range', async () => {
    // The API returns the newest 50 snapshots in the range: ~4 minutes at a 5 s
    // report rate, even with 7 or 30 days picked. "50 points" read as the range.
    const now = Date.now()
    globalThis.__tele = Array.from({ length: 50 }, (_, i) => ({
      ts: now - i * 5000, batt_v: 12.1, rpm: 0, cabin_temp_f: 70, oil_ok: true, engine_hrs: 4,
    }))
    render(<MemoryRouter><APUHistoryPage /></MemoryRouter>)
    expect(await screen.findByText('Latest readings')).toBeTruthy()
    expect(screen.getByText('Newest 20')).toBeTruthy()
    expect(screen.queryByText(/50 points/)).toBeNull()
    globalThis.__tele = undefined
  })
  it('renders the subtitle with a real separator and range label', async () => {
    render(<MemoryRouter><APUHistoryPage /></MemoryRouter>)
    expect(await screen.findByText('TRUCK-001 · Last 24 h')).toBeTruthy()
  })
})
