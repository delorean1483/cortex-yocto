import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// listUnits returns { unit, demo } objects — the unit dropdown must render the
// unit id string, never the object (rendering an object throws React #31 and
// blanks the page, same class of bug as APUHistoryPage).
const state = vi.hoisted(() => ({ records: [] }))
vi.mock('../api/client.js', () => ({
  api: {
    listUnits: () => Promise.resolve({
      units: [{ unit: 'TRUCK-001', demo: false }, { unit: 'APU-DEMO-01', demo: true }],
    }),
    getMaintenance: () => Promise.resolve({ records: state.records }),
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

  beforeEach(() => { state.records = [] })

  it('empty: says nothing is logged yet and offers Add record', async () => {
    render(<MaintenancePage />)
    expect(await screen.findByText('No maintenance logged for TRUCK-001 yet')).toBeTruthy()
    // One Add button: the empty state's, not a second copy in the toolbar.
    expect(screen.getAllByRole('button', { name: /Add record/ })).toHaveLength(1)
  })

  it('lists records with type, technician and notes', async () => {
    state.records = [{ id: 'r1', ts: Date.now(), type: 'oil_change', technician: 'R. Holt', notes: 'Changed oil and filter' }]
    render(<MaintenancePage />)
    expect(await screen.findByText('Oil change')).toBeTruthy()
    expect(screen.getByText('R. Holt')).toBeTruthy()
    expect(screen.getByText('Changed oil and filter')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Add record/ })).toHaveLength(1)
  })

  it('the add form has labelled fields', async () => {
    render(<MaintenancePage />)
    await screen.findByText('No maintenance logged for TRUCK-001 yet')
    fireEvent.click(screen.getAllByRole('button', { name: /Add record/ })[0])
    expect(screen.getByLabelText('Type')).toBeTruthy()
    expect(screen.getByLabelText(/Technician/)).toBeTruthy()
    expect(screen.getByLabelText('Notes')).toBeTruthy()
  })
})
