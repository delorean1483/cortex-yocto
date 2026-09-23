import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Neutral continental-US view when no unit has a location yet.
const US_CENTER = [39.5, -98.35]
const US_ZOOM = 4

// A glyph as well as a color, so status isn't conveyed by color alone.
const TONE_GLYPH = { err: '!', warn: '!', ok: '✓', off: '–' }

function pinIcon(tone, extra = '') {
  return L.divIcon({
    className: '',
    html: `<span class="map-pin t-${tone} ${extra}" aria-hidden="true">${TONE_GLYPH[tone] || ''}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  })
}

// Fit all pins once, then pan to whichever unit gets selected.
function Viewport({ pins, selected }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || pins.length === 0) return
    fitted.current = true
    if (pins.length === 1) map.setView([pins[0].lat, pins[0].lon], 10)
    else map.fitBounds(pins.map((p) => [p.lat, p.lon]), { padding: [40, 40] })
  }, [pins, map])
  useEffect(() => {
    const p = pins.find((x) => x.unit === selected)
    if (p) map.setView([p.lat, p.lon], Math.max(map.getZoom(), 9))
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// Leaflet measures its container once; re-measure whenever it resizes (layout
// settling, the sidebar switching modes, a tablet rotating) or tiles only cover
// the old size.
function ResizeWatcher() {
  const map = useMap()
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

function ClickToPlace({ active, onPick }) {
  useMapEvents({ click(e) { if (active) onPick(e.latlng.lat, e.latlng.lng) } })
  return null
}

export default function FleetMap({ pins, selected, placing, onPick, onOpen }) {
  const placingReady = placing && placing.lat != null && placing.lon != null
  return (
    <MapContainer center={US_CENTER} zoom={US_ZOOM} className={`fleet-map${placing ? ' is-placing' : ''}`} scrollWheelZoom>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      <ResizeWatcher />
      <Viewport pins={pins} selected={selected} />
      <ClickToPlace active={!!placing} onPick={onPick} />
      {pins.filter((p) => !(placing && p.unit === placing.unit)).map((p) => (
        <Marker key={p.unit} position={[p.lat, p.lon]} icon={pinIcon(p.tone)} title={`${p.unit}: ${p.status}`}>
          <Popup>
            <div className="map-pop">
              <div className="map-pop-unit">{p.unit}</div>
              <div className={`badge badge-sm t-${p.tone}`}>{p.status}</div>
              <div className="map-pop-line">{p.headline}</div>
              {p.label && <div className="map-pop-line">{p.label}</div>}
              <div className="map-pop-src">{p.source === 'demo' ? 'Demo location' : 'Assigned location'}</div>
              <button className="btn btn-sm btn-primary" onClick={() => onOpen(p.unit)}>Open unit</button>
            </div>
          </Popup>
        </Marker>
      ))}
      {placingReady && (
        <Marker
          position={[placing.lat, placing.lon]}
          icon={pinIcon('ok', 'placing')}
          draggable
          eventHandlers={{ dragend: (e) => { const ll = e.target.getLatLng(); onPick(ll.lat, ll.lng) } }}
          title={`New location for ${placing.unit}`}
        />
      )}
    </MapContainer>
  )
}
