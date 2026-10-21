import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useParams, useNavigate } from 'react-router-dom'

const FRESH = () => Date.now()
const state = vi.hoisted(() => ({ loading: false, latestPending: false, latest: {}, noFleet: false }))

vi.mock('../data/hooks.js', () => ({
  useUnits: () => (state.loading
    ? { data: undefined, isLoading: true, error: null }
    : { data: [{ unit: 'APU-1', demo: false, ...(state.noFleet ? {} : { fleet_id: 'NORTH-FLEET' }) },
                { unit: 'APU-DEMO-01', demo: true }],
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
    const attn = screen.getByRole('region', { name: /^needs attention$/i })
    expect(within(attn).getByText(/APU-1/)).toBeTruthy()
    expect(within(attn).getByText(/Low oil pressure/)).toBeTruthy()
    expect(within(attn).queryByText(/APU-DEMO-01/)).toBeNull()
    expect(within(attn).getByText('1 unit')).toBeTruthy()
    const normal = screen.getByRole('region', { name: /^running normally$/i })
    expect(within(normal).getByText(/APU-DEMO-01/)).toBeTruthy()
  })

  it('has no separate attention panel, and the heading carries no count', () => {
    renderPage()
    expect(screen.getAllByRole('heading', { name: 'Needs attention' })).toHaveLength(1)
    expect(screen.queryByText('Open unit')).toBeNull()
  })

  it('shows four count tiles', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /^Fault\s*1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Warning\s*0/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Offline\s*0/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Healthy\s*1/ })).toBeTruthy()
  })

  it('filters by tile and clears on a second click', () => {
    renderPage()
    const tile = screen.getByRole('button', { name: /^Fault/ })
    fireEvent.click(tile)
    expect(tile.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('link', { name: 'Open APU-DEMO-01' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Open APU-1' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: /running normally/i })).toBeNull()
    fireEvent.click(tile)
    expect(tile.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('link', { name: 'Open APU-DEMO-01' })).toBeTruthy()
  })

  it('shows an empty state with Clear filter when nothing matches', () => {
    renderPage()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by unit or fleet' }), { target: { value: 'zzz' } })
    expect(screen.getByText('No units match this filter')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(screen.getByRole('link', { name: 'Open APU-1' })).toBeTruthy()
  })

  it('shows the fleet after the unit name only when present', () => {
    renderPage()
    expect(within(screen.getByRole('link', { name: 'Open APU-1' })).getByText('NORTH-FLEET')).toBeTruthy()
    expect(screen.getAllByText('NORTH-FLEET')).toHaveLength(1)
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
    const attn = screen.getByRole('region', { name: /^needs attention$/i })
    expect(within(attn).getByText('APU-1')).toBeTruthy()
    expect(within(attn).getByText('Offline')).toBeTruthy()
  })

  it('shows engine speeds of 1,000 rpm and up (thousands separator must not break the value)', () => {
    state.latest['APU-DEMO-01'] = { ...OK, engine_status: 'running', rpm: 1850, batt_v: 13.9, ts: FRESH() }
    renderPage()
    const card = screen.getByRole('link', { name: 'Open APU-DEMO-01' })
    expect(within(card).getByText('1,850')).toBeTruthy()
  })
  it('counts every unit healthy only once every unit has reported', () => {
    state.latest['APU-1'] = { ...OK, ts: FRESH() }
    renderPage()
    expect(screen.getByRole('button', { name: /^Healthy\s*2/ })).toBeTruthy()
    expect(screen.queryByRole('region', { name: /needs attention/i })).toBeNull()
  })

  it('shows no counts or all-clear while the fleet is loading', () => {
    state.loading = true
    renderPage()
    expect(screen.getByRole('button', { name: /^Healthy\s*—/ })).toBeTruthy()
    expect(screen.queryByText(/^0/)).toBeNull()
  })

  it('shows no all-clear while unit telemetry is still loading', () => {
    state.latestPending = true
    renderPage()
    expect(screen.getByRole('button', { name: /^Healthy\s*—/ })).toBeTruthy()
  })
})

describe('DashboardPage table view', () => {
  beforeEach(() => {
    localStorage.clear()
    state.loading = false
    state.latestPending = false
    state.noFleet = false
    state.latest = {
      'APU-1': { ...OK, error_n: 1, error: 'Low oil pressure', oil_ok: false, ts: FRESH() },
      'APU-DEMO-01': { ...OK, engine_status: 'running', mode: 'climate', rpm: 1850, batt_v: 13.9, fan_speed: 65, cabin_temp_f: 74, ts: FRESH() },
    }
  })

  const viewGroup = () => screen.getByRole('group', { name: 'View' })
  const showTable = () => fireEvent.click(within(viewGroup()).getByRole('button', { name: 'Table' }))
  const bodyRows = () => within(screen.getByRole('table', { name: 'Units' })).getAllByRole('row').slice(1)

  it('defaults to cards and switches to a table of units', () => {
    renderPage()
    expect(within(viewGroup()).getByRole('button', { name: 'Cards' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('table', { name: 'Units' })).toBeNull()
    showTable()
    expect(within(viewGroup()).getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('table', { name: 'Units' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open APU-1' })).toBeNull()
  })

  it('lists every unit once, faults first, with the spec columns', () => {
    renderPage()
    showTable()
    const headers = within(screen.getByRole('table', { name: 'Units' })).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.slice(0, 9)).toEqual(['Status', 'Unit', 'Fleet', 'Status detail', 'Battery', 'Cabin', 'RPM', 'Fan', 'Last report'])
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('APU-1')).toBeTruthy()
    expect(within(rows[0]).getByText('Fault')).toBeTruthy()
    expect(within(rows[0]).getByText('Low oil pressure')).toBeTruthy()
    expect(within(rows[0]).getByText('NORTH-FLEET')).toBeTruthy()
    expect(within(rows[1]).getByText('APU-DEMO-01')).toBeTruthy()
    expect(within(rows[1]).getByText('demo')).toBeTruthy()
    expect(within(rows[1]).getByText('13.9 V').className).toContain('num')
    expect(within(rows[1]).getByText('1,850')).toBeTruthy()
    expect(within(rows[1]).getByText('65%')).toBeTruthy()
    expect(within(rows[1]).getByText('just now')).toBeTruthy()
    expect(screen.getByText('2 units · sorted by needs attention · click a row to open the unit')).toBeTruthy()
  })

  it('tints fault rows', () => {
    renderPage()
    showTable()
    expect(bodyRows()[0].className).toContain('row-err')
    expect(bodyRows()[1].className).not.toContain('row-err')
  })

  it('opens the unit when a row is clicked', () => {
    function UnitStub() { return <div>unit page {useParams().id}</div> }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/units/:id" element={<UnitStub />} />
        </Routes>
      </MemoryRouter>,
    )
    showTable()
    fireEvent.click(bodyRows()[1])
    expect(screen.getByText('unit page APU-DEMO-01')).toBeTruthy()
  })

  it('names each unit with a keyboard-reachable link', () => {
    renderPage()
    showTable()
    expect(within(bodyRows()[0]).getByRole('link', { name: 'APU-1' }).getAttribute('href')).toBe('/units/APU-1')
  })

  it('hides the Fleet column when no unit reports a fleet', () => {
    state.noFleet = true
    renderPage()
    showTable()
    const headers = within(screen.getByRole('table', { name: 'Units' })).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).not.toContain('Fleet')
  })

  it('shows an offline unit as not reporting with its last report age', () => {
    state.latest['APU-1'] = { ...OK, ts: Date.now() - 2 * 3600000 }
    renderPage()
    showTable()
    const row = bodyRows()[0]
    expect(within(row).getByText('Not reporting')).toBeTruthy()
    expect(within(row).getByText('2 h ago')).toBeTruthy()
  })

  it('applies the count-tile filter to the table', () => {
    renderPage()
    showTable()
    fireEvent.click(screen.getByRole('button', { name: /^Fault/ }))
    expect(bodyRows()).toHaveLength(1)
    expect(within(bodyRows()[0]).getByText('APU-1')).toBeTruthy()
  })

  // Unit page stub with a Back button, so a doubled history push is observable:
  // one Back must return to the dashboard.
  function renderWithHistory() {
    function UnitStub() {
      const navigate = useNavigate()
      return <div>unit page {useParams().id}<button type="button" onClick={() => navigate(-1)}>Back</button></div>
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/units/:id" element={<UnitStub />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('clicking the unit link pushes one history entry (one Back returns to the dashboard)', () => {
    renderWithHistory()
    showTable()
    fireEvent.click(within(bodyRows()[0]).getByRole('link', { name: 'APU-1' }))
    expect(screen.getByText('unit page APU-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('table', { name: 'Units' })).toBeTruthy()
  })

  it('leaves the dashboard alone on a modifier-click (the link opens a new tab instead)', () => {
    renderWithHistory()
    showTable()
    fireEvent.click(bodyRows()[1], { metaKey: true })
    fireEvent.click(bodyRows()[1], { ctrlKey: true })
    expect(screen.queryByText(/unit page/)).toBeNull()
    expect(screen.getByRole('table', { name: 'Units' })).toBeTruthy()
  })

  it('does not navigate when the click ends a text selection', () => {
    renderWithHistory()
    showTable()
    const spy = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Low oil' })
    fireEvent.click(bodyRows()[0])
    spy.mockRestore()
    expect(screen.queryByText(/unit page/)).toBeNull()
  })

  it('dims the last-known readings of a unit that stopped reporting', () => {
    state.latest['APU-1'] = { ...OK, batt_v: 11.6, ts: Date.now() - 2 * 3600000 }
    renderPage()
    showTable()
    expect(within(bodyRows()[0]).getByText('11.6 V').className).toContain('utbl-stale')
    expect(within(bodyRows()[1]).getByText('13.9 V').className).not.toContain('utbl-stale')
  })

  it('falls back to cards when browser storage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    renderPage()
    spy.mockRestore()
    expect(within(viewGroup()).getByRole('button', { name: 'Cards' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('remembers the chosen view', () => {
    localStorage.setItem('eco_dash_view', 'table')
    renderPage()
    expect(screen.getByRole('table', { name: 'Units' })).toBeTruthy()
    fireEvent.click(within(viewGroup()).getByRole('button', { name: 'Cards' }))
    expect(localStorage.getItem('eco_dash_view')).toBe('cards')
  })
})
