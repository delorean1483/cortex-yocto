import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

const state = vi.hoisted(() => ({ faults: [], role: 'admin' }))
vi.mock('../api/client.js', () => ({
  api: {
    listUnits: () => Promise.resolve({ units: [{ unit: 'TRUCK-001', demo: false }] }),
    getFaults: () => Promise.resolve({ faults: state.faults }),
  },
}))
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ selectedUnit: 'TRUCK-001', setSelectedUnit: vi.fn(), role: state.role }),
}))

import AlertsPage from './AlertsPage.jsx'

const NOW = Date.now()

describe('AlertsPage', () => {
  beforeEach(() => { state.faults = []; state.role = 'admin' })

  it('all clear: a green banner and no fault log', async () => {
    render(<AlertsPage />)
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
    render(<AlertsPage />)
    expect(await screen.findByRole('heading', { name: '1 active fault' })).toBeTruthy()
    const active = screen.getByRole('region', { name: 'Active faults' })
    expect(within(active).getByText('Low oil pressure')).toBeTruthy()
    expect(within(active).getByText('Critical')).toBeTruthy()
    expect(within(active).queryByText('DC over-voltage')).toBeNull()
    const log = screen.getByRole('table', { name: 'Fault log' })
    expect(within(log).getAllByRole('row')).toHaveLength(4) // header + 3 events
  })

  it('the monitored-conditions reference is collapsible and hidden from end users', async () => {
    const { unmount } = render(<AlertsPage />)
    expect(await screen.findByText('What the controller monitors')).toBeTruthy()
    expect(screen.queryByText(/gobi-agent/)).toBeNull()
    unmount()
    state.role = 'eu'
    render(<AlertsPage />)
    await screen.findByRole('heading', { name: /No active faults/ })
    expect(screen.queryByText('What the controller monitors')).toBeNull()
  })
})
