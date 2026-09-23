import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// listUnits returns unit OBJECTS { unit, demo } (per the /fleet/units contract,
// api.js). The page must render the unit id string, never the object — rendering
// an object as a React child throws React error #31 and blanks the whole page.
vi.mock('../api/client.js', () => ({
  api: {
    listUnits: () => Promise.resolve({
      units: [{ unit: 'TRUCK-001', demo: false }, { unit: 'APU-DEMO-01', demo: true }],
    }),
    getFaults: () => Promise.resolve({ faults: [] }),
    // Telemetry never settles: a slow 30-day series query must not hold the
    // fault log hostage (it used to sit on skeletons forever).
    getTelemetry: () => new Promise(() => {}),
  },
}))
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ selectedUnit: 'TRUCK-001', setSelectedUnit: vi.fn() }),
}))

import APUHistoryPage from './APUHistoryPage.jsx'

describe('APUHistoryPage', () => {
  it('renders unit options as id strings from {unit,demo} objects (no React #31 crash)', async () => {
    render(<APUHistoryPage />)
    expect(await screen.findByRole('option', { name: /TRUCK-001/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /APU-DEMO-01/ })).toBeTruthy()
  })
  it('renders the fault log without waiting on the telemetry query', async () => {
    render(<APUHistoryPage />)
    expect(await screen.findByText(/No fault events recorded/)).toBeTruthy()
  })
})
