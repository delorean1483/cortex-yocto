import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const state = vi.hoisted(() => ({ loading: false, latestPending: false }))

vi.mock('../data/hooks.js', () => ({
  useUnits: () => (state.loading
    ? { data: undefined, isLoading: true, error: null }
    : { data: [{ unit: 'APU-1', demo: false }, { unit: 'APU-DEMO-01', demo: true }],
        isLoading: false, error: null }),
  useUnitLatest: (unit) => (state.latestPending ? { data: undefined, isLoading: true } : {
    data: unit === 'APU-1'
      ? { error_n: 1, error: 'Low oil pressure', batt_v: 12.6, oil_ok: false, ts: Date.now() }
      : { error_n: 0, batt_v: 13.2, oil_ok: true, ts: Date.now() },
    isLoading: false,
  }),
}))

import DashboardPage from './DashboardPage.jsx'

function renderPage() {
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}

describe('DashboardPage', () => {
  beforeEach(() => { state.loading = false; state.latestPending = false })

  it('renders both unit ids', () => {
    renderPage()
    expect(screen.getByText('APU-1')).toBeTruthy()
    expect(screen.getByText('APU-DEMO-01')).toBeTruthy()
  })
  it('badges the demo unit', () => {
    renderPage()
    // exact 'demo' matches only the pill, not the unit name "APU-DEMO-01"
    expect(screen.getByText('demo')).toBeTruthy()
  })
  it('shows an error status dot for the faulted unit', () => {
    const { container } = renderPage()
    expect(container.querySelector('.s-err')).toBeTruthy()
  })
  it('does not claim "0 units" or "all clear" while the fleet is loading', () => {
    state.loading = true
    renderPage()
    expect(screen.queryByText('all clear')).toBeNull()
    expect(screen.queryByText(/of 0 total/)).toBeNull()
    expect(screen.queryByText('0')).toBeNull()
  })
  it('does not report "all clear" until every unit has reported telemetry', () => {
    state.latestPending = true
    renderPage()
    expect(screen.queryByText('all clear')).toBeNull()
  })
})
