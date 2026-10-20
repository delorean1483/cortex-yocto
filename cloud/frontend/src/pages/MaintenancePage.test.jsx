import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// listUnits returns { unit, demo } objects — the unit dropdown must render the
// unit id string, never the object (rendering an object throws React #31 and
// blanks the page, same class of bug as APUHistoryPage).
const state = vi.hoisted(() => ({ records: [], latest: { oil_hrs: 4, engine_hrs: 4, machine_hrs: 128 } }))
vi.mock('../api/client.js', () => ({
  api: {
    listUnits: () => Promise.resolve({
      units: [{ unit: 'TRUCK-001', demo: false }, { unit: 'APU-DEMO-01', demo: true }],
    }),
    getLatest: () => Promise.resolve({ latest: state.latest }),
    getMaintenance: () => Promise.resolve({ records: state.records }),
    addMaintenance: () => Promise.resolve({}),
  },
}))
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ selectedUnit: 'TRUCK-001', setSelectedUnit: vi.fn(), role: 'admin' }),
}))

import MaintenancePage from './MaintenancePage.jsx'

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}><MaintenancePage /></QueryClientProvider>)
}

describe('MaintenancePage', () => {
  it('renders unit options as id strings from {unit,demo} objects (no React #31 crash)', async () => {
    render()
    expect(await screen.findByRole('option', { name: /TRUCK-001/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /APU-DEMO-01/ })).toBeTruthy()
  })

  beforeEach(() => { state.records = []; state.latest = { oil_hrs: 4, engine_hrs: 4, machine_hrs: 128 } })

  it('empty: says nothing is logged yet and offers Add record', async () => {
    render()
    expect(await screen.findByText('No maintenance logged for TRUCK-001 yet')).toBeTruthy()
    // One Add button: the empty state's, not a second copy in the toolbar.
    expect(screen.getAllByRole('button', { name: /Add record/ })).toHaveLength(1)
  })

  it('lists records with type, technician and notes', async () => {
    state.records = [{ id: 'r1', ts: Date.now(), type: 'oil_change', technician: 'R. Holt', notes: 'Changed oil and filter' }]
    render()
    expect(await screen.findByText('Oil change')).toBeTruthy()
    expect(screen.getByText('R. Holt')).toBeTruthy()
    expect(screen.getByText('Changed oil and filter')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Add record/ })).toHaveLength(1)
  })

  it('the add form has labelled fields', async () => {
    render()
    await screen.findByText('No maintenance logged for TRUCK-001 yet')
    fireEvent.click(screen.getAllByRole('button', { name: /Add record/ })[0])
    expect(screen.getByRole('combobox', { name: 'Type' })).toBeTruthy()
    expect(screen.getByLabelText(/Technician/)).toBeTruthy()
    expect(screen.getByLabelText('Notes')).toBeTruthy()
  })

  it('service counters show oil, engine and machine hours', async () => {
    state.latest = { oil_hrs: 4, engine_hrs: 4, machine_hrs: 1280 }
    render()
    const oil = (await screen.findByText('Oil hours')).closest('.scard')
    expect(within(oil).getByText('4 h')).toBeTruthy()
    expect(within(oil).getByText('since last oil change')).toBeTruthy()
    const eng = screen.getByText('Engine hours').closest('.scard')
    expect(within(eng).getByText('4 h')).toBeTruthy()
    const mach = screen.getByText('Machine hours').closest('.scard')
    expect(within(mach).getByText('1,280 h')).toBeTruthy()
  })

  it('counters show a dash when latest is missing', async () => {
    state.latest = undefined
    render()
    const oil = (await screen.findByText('Oil hours')).closest('.scard')
    expect(within(oil).getByText('—')).toBeTruthy()
  })

  it('history is a table with Date, Type, Technician, Notes; tech field and empty notes handled', async () => {
    state.records = [
      { id: 'r1', ts: Date.now(), type: 'oil_change', tech: 'R. Holt', notes: '' },
      { id: 'r2', ts: Date.now() - 864e5, type: 'inspection', technician: 'L. Chen', notes: 'All good' },
    ]
    render()
    const table = await screen.findByRole('table')
    for (const h of ['Date', 'Type', 'Technician', 'Notes']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeTruthy()
    }
    expect(within(table).getByText('R. Holt')).toBeTruthy()
    expect(within(table).getByText('No notes')).toBeTruthy()
    expect(within(table).getByText('All good')).toBeTruthy()
  })

  it('type chips filter rows', async () => {
    state.records = [
      { id: 'r1', ts: Date.now(), type: 'oil_change', technician: 'R. Holt', notes: 'a' },
      { id: 'r2', ts: Date.now(), type: 'inspection', technician: 'L. Chen', notes: 'b' },
    ]
    render()
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Inspection')).toBeTruthy()
    const chips = screen.getByRole('group', { name: 'Type' })
    fireEvent.click(within(chips).getByRole('button', { name: 'Oil change' }))
    expect(within(table).queryByText('Inspection')).toBeNull()
    expect(within(table).getByText('Oil change')).toBeTruthy()
  })
})
