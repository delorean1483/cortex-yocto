import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const state = vi.hoisted(() => ({
  role: 'admin',
  locations: [],
  setMutate: null,
  clearMutate: null,
  mapProps: null,
}))

vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ role: state.role }) }))

vi.mock('../data/hooks.js', () => ({
  useUnits: () => ({ data: [{ unit: 'TRUCK-001', demo: false }, { unit: 'APU-DEMO-01', demo: true }], isLoading: false }),
  useLocations: () => ({ data: state.locations, isLoading: false, error: null, refetch: vi.fn() }),
  useFleetLatest: () => ({
    byUnit: {
      'TRUCK-001': { ts: Date.now(), error_n: 0, error: 'none', batt_v: 12.6, oil_ok: true, mode: 'off', control_status: 'off', engine_status: 'off', rpm: 0 },
      'APU-DEMO-01': { ts: Date.now(), error_n: 1, error: 'Low oil pressure', batt_v: 13, oil_ok: false, mode: 'off', control_status: 'off', engine_status: 'off', rpm: 0 },
    },
    pending: {},
  }),
  useSetLocation: () => ({ mutate: state.setMutate, isPending: false }),
  useClearLocation: () => ({ mutate: state.clearMutate, isPending: false }),
}))

// Leaflet needs real layout; the page is tested against a stand-in map that
// records its props and lets the test "click" a map position.
vi.mock('../components/map/FleetMap.jsx', () => ({
  default: (props) => {
    state.mapProps = props
    return (
      <div data-testid="map">
        {props.pins.map((p) => <span key={p.unit} data-testid="pin">{p.unit}</span>)}
        <button onClick={() => props.onPick(40.1, -95.2)}>test-pick</button>
      </div>
    )
  },
}))

import FleetMapPage from './FleetMapPage.jsx'

const DEMO_LOC = { unit: 'APU-DEMO-01', lat: 32.77, lon: -96.79, label: 'Dallas, TX (demo)', source: 'demo' }
const renderPage = () => render(<MemoryRouter><FleetMapPage /></MemoryRouter>)

describe('FleetMapPage', () => {
  beforeEach(() => {
    state.role = 'admin'
    state.locations = [DEMO_LOC]
    state.setMutate = vi.fn()
    state.clearMutate = vi.fn()
    state.mapProps = null
  })

  it('says locations are assigned, not GPS', () => {
    renderPage()
    expect(screen.getByText("Assigned locations — units don't report GPS yet.")).toBeTruthy()
  })

  it('lists placed units on the map and the rest under "Not placed yet"', () => {
    renderPage()
    const placed = screen.getByRole('region', { name: 'On the map' })
    const unplaced = screen.getByRole('region', { name: 'Not placed yet' })
    expect(within(placed).getByText('APU-DEMO-01')).toBeTruthy()
    expect(within(unplaced).getByText('TRUCK-001')).toBeTruthy()
    expect(screen.getAllByTestId('pin').map((p) => p.textContent)).toEqual(['APU-DEMO-01'])
    expect(state.mapProps.pins[0]).toMatchObject({ unit: 'APU-DEMO-01', tone: 'err', source: 'demo' })
  })

  it('no locations at all: empty map, every unit under "Not placed yet"', () => {
    state.locations = []
    renderPage()
    expect(state.mapProps.pins).toEqual([])
    expect(screen.queryByRole('region', { name: 'On the map' })).toBeNull()
    const unplaced = screen.getByRole('region', { name: 'Not placed yet' })
    expect(within(unplaced).getByText('TRUCK-001')).toBeTruthy()
    expect(within(unplaced).getByText('APU-DEMO-01')).toBeTruthy()
  })

  it('sets a location from typed coordinates', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set location for TRUCK-001' }))
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '32.9' } })
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-97.04' } })
    fireEvent.change(screen.getByLabelText('Label (optional)'), { target: { value: 'Yard' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }))
    expect(state.setMutate).toHaveBeenCalledTimes(1)
    expect(state.setMutate.mock.calls[0][0]).toEqual({ unit: 'TRUCK-001', lat: 32.9, lon: -97.04, label: 'Yard' })
  })

  it('explains the location drives the unit\'s weather and time zone', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set location for TRUCK-001' }))
    expect(screen.getByText(/weather forecast and local time zone/)).toBeTruthy()
  })

  it('warns when the location was saved but could not be sent to the unit', () => {
    state.setMutate = vi.fn((_vars, opts) => opts.onSuccess({ unit_synced: false }))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set location for TRUCK-001' }))
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '32.9' } })
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-97.04' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }))
    expect(screen.getByRole('status').textContent).toMatch(/couldn't be sent to the unit/)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('no warning when the unit was updated', () => {
    state.setMutate = vi.fn((_vars, opts) => opts.onSuccess({ unit_synced: true }))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set location for TRUCK-001' }))
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '32.9' } })
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-97.04' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('clicking the map fills the coordinates', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set location for TRUCK-001' }))
    fireEvent.click(screen.getByText('test-pick'))
    expect(screen.getByLabelText('Latitude').value).toBe('40.1')
    expect(screen.getByLabelText('Longitude').value).toBe('-95.2')
    expect(state.mapProps.placing).toMatchObject({ unit: 'TRUCK-001', lat: 40.1, lon: -95.2 })
  })

  it('invalid coordinates show field errors and are not sent', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Set location for TRUCK-001' }))
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '32,77' } })
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }))
    expect(screen.getByText(/Latitude must be/)).toBeTruthy()
    expect(screen.getByText(/Longitude must be/)).toBeTruthy()
    expect(state.setMutate).not.toHaveBeenCalled()
  })

  it('removes a placed location after confirmation', () => {
    state.locations = [DEMO_LOC, { unit: 'TRUCK-001', lat: 33, lon: -97, label: null, source: 'assigned' }]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove location for TRUCK-001' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(state.clearMutate.mock.calls[0][0]).toBe('TRUCK-001')
  })

  it('demo units never get edit controls, even for admins', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Set location for TRUCK-001' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /location for APU-DEMO-01/ })).toBeNull()
  })

  it('read-only roles (maint, eu) get no edit controls', () => {
    for (const role of ['maint', 'eu']) {
      state.role = role
      const { unmount } = renderPage()
      expect(screen.queryAllByRole('button', { name: /Set location for|Remove location for/ })).toHaveLength(0)
      unmount()
    }
  })
})
