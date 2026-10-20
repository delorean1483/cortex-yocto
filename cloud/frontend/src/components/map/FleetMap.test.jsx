import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

const fakeMap = vi.hoisted(() => ({
  invalidateSize: vi.fn(), fitBounds: vi.fn(), setView: vi.fn(), getZoom: () => 4,
  getContainer: () => document.createElement('div'),
}))

// react-leaflet needs real layout; the map object is the contract under test.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children, icon }) => <div data-testid="marker" data-html={icon?.options?.html}>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  useMap: () => fakeMap,
  useMapEvents: () => null,
}))

import FleetMap from './FleetMap.jsx'

describe('FleetMap', () => {
  let observed
  beforeEach(() => {
    fakeMap.invalidateSize.mockClear()
    observed = null
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb }
      observe(el) { observed = { el, cb: this.cb } }
      disconnect() {}
    }
  })

  it('re-measures the map when its container resizes (Leaflet only measures once)', () => {
    render(<FleetMap pins={[]} selected={null} placing={null} onPick={() => {}} onOpen={() => {}} />)
    expect(observed).toBeTruthy()
    observed.cb([])
    expect(fakeMap.invalidateSize).toHaveBeenCalled()
  })

  it('lists Fault, Warning, Healthy and Offline in a legend', () => {
    render(<FleetMap pins={[]} selected={null} placing={null} onPick={() => {}} onOpen={() => {}} />)
    const legend = screen.getByLabelText('Map legend')
    for (const t of ['Fault', 'Warning', 'Healthy', 'Offline']) expect(within(legend).getByText(t)).toBeTruthy()
  })

  it('labels each pin "{unit} · {status}"', () => {
    const pins = [{ unit: 'APU-DEMO-03', lat: 1, lon: 2, tone: 'err', status: 'Fault', headline: '', source: 'demo' }]
    render(<FleetMap pins={pins} selected={null} placing={null} onPick={() => {}} onOpen={() => {}} />)
    const html = screen.getAllByTestId('marker')[0].getAttribute('data-html')
    expect(html).toContain('map-pin-label')
    expect(html).toContain('APU-DEMO-03 · Fault')
  })
})
