import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const state = vi.hoisted(() => ({
  faults: [], role: 'maint', selectedUnit: 'TRUCK-001', setSelectedUnit: null,
  units: [{ unit: 'TRUCK-001', demo: false }],
  byUnit: {}, latest: {}, getFaults: null,
}))
vi.mock('../api/client.js', () => ({
  api: {
    listUnits: () => Promise.resolve({ units: state.units }),
    getFaults: (...a) => state.getFaults(...a),
    getLatest: (unit) => Promise.resolve({ latest: state.latest[unit] }),
  },
}))
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ selectedUnit: state.selectedUnit, setSelectedUnit: state.setSelectedUnit, role: state.role }),
}))

import AlertsPage from './AlertsPage.jsx'

const NOW = Date.now()

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}><MemoryRouter><AlertsPage /></MemoryRouter></QueryClientProvider>,
  )
}

describe('AlertsPage single unit (maint / eu)', () => {
  beforeEach(() => {
    state.faults = []; state.role = 'maint'; state.selectedUnit = 'TRUCK-001'
    state.setSelectedUnit = vi.fn()
    state.units = [{ unit: 'TRUCK-001', demo: false }]
    state.latest = {}
    state.getFaults = () => Promise.resolve({ faults: state.faults })
  })

  it('all clear: a green banner and no fault log', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: /No active faults/ })).toBeTruthy()
    expect(screen.getByText(/TRUCK-001 · last 7 days/)).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Fault log' })).toBeNull()
  })

  it('an uncleared fault is active; a cleared one only appears in the log', async () => {
    state.faults = [
      { ts: NOW - 4 * 60000, fault: '0x0020', state: 'active' },
      { ts: NOW - 3 * 3600000, fault: '0x0000', state: 'cleared' },
      { ts: NOW - 5 * 3600000, fault: '0x0004', state: 'active' },
    ]
    renderPage()
    expect(await screen.findByRole('heading', { name: '1 active fault' })).toBeTruthy()
    const active = screen.getByRole('region', { name: 'Active faults' })
    expect(within(active).getByText('Low oil pressure')).toBeTruthy()
    expect(within(active).getByText('Critical')).toBeTruthy()
    expect(within(active).queryByText('DC over-voltage')).toBeNull()
    const log = screen.getByRole('table', { name: 'Fault log' })
    expect(within(log).getAllByRole('row')).toHaveLength(4) // header + 3 events
  })

  it('the monitored-conditions reference is hidden from end users', async () => {
    state.role = 'eu'
    renderPage()
    await screen.findByRole('heading', { name: /No active faults/ })
    expect(screen.queryByText('What the controller monitors')).toBeNull()
  })
})

describe('AlertsPage all units (admin / fm)', () => {
  beforeEach(() => {
    state.role = 'admin'; state.selectedUnit = 'TRUCK-001'
    state.setSelectedUnit = vi.fn()
    state.units = [{ unit: 'A', demo: false }, { unit: 'B', demo: false }]
    state.latest = { A: { ts: NOW }, B: { ts: NOW } }
    state.getFaults = vi.fn((unit) => unit === 'B'
      ? Promise.reject(new Error('boom'))
      : Promise.resolve({ faults: [
          { ts: NOW - 18 * 60000, fault: '0x0020', state: 'active' },
          { ts: NOW - 4 * 3600000, fault: '0x0004', state: 'active' },
          { ts: NOW - 5 * 3600000, fault: '0x0000', state: 'cleared' },
        ] }))
  })

  it('defaults to All units and fans out one fault fetch per unit', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /Active faults/ })
    expect(screen.getByLabelText('Unit').value).toBe('__all__')
    expect(state.getFaults).toHaveBeenCalledWith('A', { start: '-7d', limit: '100' })
    expect(state.getFaults).toHaveBeenCalledWith('B', { start: '-7d', limit: '100' })
    expect(state.getFaults).toHaveBeenCalledTimes(2)
  })

  it('the heading counts faults across units, with no banner', async () => {
    renderPage()
    const h = await screen.findByRole('heading', { name: /Active faults/ })
    expect(h.textContent).toContain('Active faults')
    expect(screen.getByText('2 across 1 unit')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Fault status' })).toBeNull()
  })

  it('the active table has Unit/Fault/Severity/Raised and an Open unit link', async () => {
    renderPage()
    const table = await screen.findByRole('table', { name: 'Active faults' })
    const heads = within(table).getAllByRole('columnheader').map((c) => c.textContent)
    expect(heads.slice(0, 4)).toEqual(['Unit', 'Fault', 'Severity', 'Raised'])
    expect(within(table).getByText('Low oil pressure')).toBeTruthy()
    const link = within(table).getAllByRole('link', { name: /Open unit/ })[0]
    expect(link.getAttribute('href')).toBe('/units/A')
  })

  it('a failed unit gets a notice while the others still render', async () => {
    renderPage()
    expect(await screen.findByText("Couldn't load faults for B")).toBeTruthy()
    expect(within(screen.getByRole('table', { name: 'Active faults' })).getByText('Low oil pressure')).toBeTruthy()
  })

  it('severity chips filter the active table', async () => {
    renderPage()
    const table = await screen.findByRole('table', { name: 'Active faults' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Warning · 1' }))
    expect(within(screen.getByRole('table', { name: 'Active faults' })).getAllByRole('row')).toHaveLength(2)
    expect(screen.queryByText('Low oil pressure', { selector: 'td *' })).toBeNull()
  })

  it('the fault log has a Unit column', async () => {
    renderPage()
    const log = await screen.findByRole('table', { name: 'Fault log' })
    const heads = within(log).getAllByRole('columnheader').map((c) => c.textContent)
    expect(heads).toEqual(['When', 'Unit', 'Fault', 'State'])
  })

  it('shows "Unit offline" under Raised when that unit is stale', async () => {
    state.latest = { A: { ts: NOW - 3600000 }, B: { ts: NOW } }
    renderPage()
    expect(await screen.findAllByText('Unit offline')).toHaveLength(2)
  })

  it('picking a unit switches to single-unit mode and updates AuthContext', async () => {
    renderPage()
    await screen.findByRole('table', { name: 'Active faults' })
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'A' } })
    expect(state.setSelectedUnit).toHaveBeenCalledWith('A')
    await waitFor(() => expect(screen.getByRole('region', { name: 'Fault status' })).toBeTruthy())
  })

  it('the monitored-conditions reference stays for admins', async () => {
    renderPage()
    expect(await screen.findByText('What the controller monitors')).toBeTruthy()
  })
})
