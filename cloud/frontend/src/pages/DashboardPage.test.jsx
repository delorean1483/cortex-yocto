import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const FRESH = () => Date.now()
const state = vi.hoisted(() => ({ loading: false, latestPending: false, latest: {} }))

vi.mock('../data/hooks.js', () => ({
  useUnits: () => (state.loading
    ? { data: undefined, isLoading: true, error: null }
    : { data: [{ unit: 'APU-1', demo: false }, { unit: 'APU-DEMO-01', demo: true }],
        isLoading: false, error: null }),
  useUnitLatest: (unit) => (state.latestPending
    ? { data: undefined, isLoading: true }
    : { data: state.latest[unit], isLoading: false }),
}))

import DashboardPage from './DashboardPage.jsx'

const OK = { error_n: 0, error: 'none', batt_v: 13.2, oil_ok: true, mode: 'off', control_status: 'off', engine_status: 'off', rpm: 0 }

function renderPage() {
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}

describe('DashboardPage', () => {
  beforeEach(() => {
    state.loading = false
    state.latestPending = false
    state.latest = {
      'APU-1': { ...OK, error_n: 1, error: 'Low oil pressure', oil_ok: false, ts: FRESH() },
      'APU-DEMO-01': { ...OK, ts: FRESH() },
    }
  })

  it('renders a card per unit and badges the demo unit', () => {
    renderPage()
    expect(screen.getAllByText('APU-1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('APU-DEMO-01').length).toBeGreaterThan(0)
    expect(screen.getByText('demo')).toBeTruthy()
  })

  it('lists a faulted unit under Needs attention with its fault', () => {
    renderPage()
    const attn = screen.getByRole('region', { name: /needs attention/i })
    expect(within(attn).getByText(/APU-1/)).toBeTruthy()
    expect(within(attn).getByText(/Low oil pressure/)).toBeTruthy()
    expect(within(attn).queryByText(/APU-DEMO-01/)).toBeNull()
  })

  it('sorts the faulted unit first and labels it Fault', () => {
    state.latest = {
      'APU-1': { ...OK, ts: FRESH() },
      'APU-DEMO-01': { ...OK, error_n: 1, error: 'Low oil pressure', ts: FRESH() },
    }
    renderPage()
    const cards = screen.getAllByRole('link', { name: /^Open APU/ })
    expect(cards[0].getAttribute('aria-label')).toMatch(/APU-DEMO-01/)
    expect(within(cards[0]).getByText('Fault')).toBeTruthy()
  })

  it('treats a unit that stopped reporting as offline and needing attention', () => {
    state.latest['APU-1'] = { ...OK, ts: Date.now() - 2 * 3600000 }
    renderPage()
    const attn = screen.getByRole('region', { name: /needs attention/i })
    expect(within(attn).getByText(/Not reporting/)).toBeTruthy()
  })

  it('says the fleet is healthy only once every unit has reported', () => {
    state.latest['APU-1'] = { ...OK, ts: FRESH() }
    renderPage()
    expect(screen.getByText(/All 2 units healthy/)).toBeTruthy()
  })

  it('shows no counts or all-clear while the fleet is loading', () => {
    state.loading = true
    renderPage()
    expect(screen.queryByText(/healthy/)).toBeNull()
    expect(screen.queryByText(/^0/)).toBeNull()
  })

  it('shows no all-clear while unit telemetry is still loading', () => {
    state.latestPending = true
    renderPage()
    expect(screen.queryByText(/healthy/)).toBeNull()
  })
})
