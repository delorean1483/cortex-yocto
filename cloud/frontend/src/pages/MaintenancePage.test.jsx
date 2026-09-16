import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// listUnits returns { unit, demo } objects — the unit dropdown must render the
// unit id string, never the object (rendering an object throws React #31 and
// blanks the page, same class of bug as APUHistoryPage).
vi.mock('../api/client.js', () => ({
  api: {
    listUnits: () => Promise.resolve({
      units: [{ unit: 'TRUCK-001', demo: false }, { unit: 'APU-DEMO-01', demo: true }],
    }),
    getMaintenance: () => Promise.resolve({ records: [] }),
    addMaintenance: () => Promise.resolve({}),
  },
}))
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ selectedUnit: 'TRUCK-001', setSelectedUnit: vi.fn(), role: 'admin' }),
}))

import MaintenancePage from './MaintenancePage.jsx'

describe('MaintenancePage', () => {
  it('renders unit options as id strings from {unit,demo} objects (no React #31 crash)', async () => {
    render(<MaintenancePage />)
    expect(await screen.findByRole('option', { name: /TRUCK-001/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /APU-DEMO-01/ })).toBeTruthy()
  })
})
