import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const fakeMap = vi.hoisted(() => ({
  invalidateSize: vi.fn(), fitBounds: vi.fn(), setView: vi.fn(), getZoom: () => 4,
  getContainer: () => document.createElement('div'),
}))

// react-leaflet needs real layout; the map object is the contract under test.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }) => <div>{children}</div>,
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
})
