import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconMapPin, IconMapPinOff } from '@tabler/icons-react'
import {
  useUnits, useLocations, useSetLocation, useClearLocation, useFleetLatest,
} from '../data/hooks.js'
import { unitView } from '../api/contract.js'
import { validateLatLon, orderMapRows, LABEL_MAX } from '../api/locations.js'
import { useCan } from '../components/RoleGate.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import FleetMap from '../components/map/FleetMap.jsx'

const round = (n) => String(Math.round(n * 1e5) / 1e5)

function UnitRow({ r, canEdit, onShow, onEdit, onRemove }) {
  const demo = r.location?.source === 'demo' || r.u.demo
  return (
    <div className="map-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="map-row-unit">{r.u.unit}</span>
          {r.u.demo && <span className="badge badge-sm t-off">demo</span>}
          {r.view && <span className={`badge badge-sm t-${r.view.tone}`}>{r.view.status}</span>}
        </div>
        {r.location?.label && <div className="map-row-sub">{r.location.label}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {r.location && <button className="btn btn-sm" onClick={() => onShow(r.u.unit)}>Show</button>}
        {canEdit && !demo && (
          <button className="btn btn-sm" aria-label={`Set location for ${r.u.unit}`} onClick={() => onEdit(r)}>
            {r.location ? 'Move' : 'Set location'}
          </button>
        )}
        {canEdit && !demo && r.location && (
          <button className="btn btn-sm btn-red" aria-label={`Remove location for ${r.u.unit}`} onClick={() => onRemove(r.u.unit)}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

export default function FleetMapPage() {
  const navigate = useNavigate()
  const { data: units, isLoading: unitsLoading } = useUnits()
  const { data: locations, error: locError, refetch } = useLocations()
  const setLoc = useSetLocation()
  const clearLoc = useClearLocation()
  const { allowed: canEdit } = useCan('location')
  const list = units || []
  const { byUnit, pending } = useFleetLatest(list.map((u) => u.unit))

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t) }, [])

  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null) // { unit, lat, lon, label, errors, apiError }
  const [removing, setRemoving] = useState(null)
  const [syncWarn, setSyncWarn] = useState('') // location saved but not delivered to the unit

  const locByUnit = Object.fromEntries((locations || []).map((l) => [l.unit, l]))
  const rows = list.map((u) => ({
    u,
    tele: byUnit[u.unit],
    view: pending[u.unit] ? undefined : unitView(byUnit[u.unit], now),
    location: locByUnit[u.unit],
  }))
  const { placed, unplaced } = orderMapRows(rows)
  const pins = placed.map((r) => ({
    unit: r.u.unit,
    lat: r.location.lat,
    lon: r.location.lon,
    tone: r.view?.tone || 'off',
    status: r.view?.status || 'Loading',
    headline: r.view?.headline || '',
    label: r.location.label,
    source: r.location.source,
  }))

  const startEdit = (r) => setEditing({
    unit: r.u.unit,
    lat: r.location ? round(r.location.lat) : '',
    lon: r.location ? round(r.location.lon) : '',
    label: r.location?.label || '',
    errors: {},
    apiError: '',
  })
  const onPick = (lat, lon) => setEditing((e) => (e ? { ...e, lat: round(lat), lon: round(lon), errors: {} } : e))
  const save = () => {
    const v = validateLatLon(editing.lat, editing.lon, editing.label)
    if (!v.ok) { setEditing({ ...editing, errors: v.errors }); return }
    setLoc.mutate({ unit: editing.unit, ...v.value }, {
      onSuccess: (res) => {
        setSyncWarn(res?.unit_synced === false
          ? `${editing.unit}'s location is saved, but it couldn't be sent to the unit yet — it needs to be online and on firmware 1.2.61 or newer. Save it again after that.`
          : '')
        setSelected(editing.unit); setEditing(null)
      },
      onError: (e) => setEditing((cur) => cur && { ...cur, apiError: e.message }),
    })
  }

  const placingLat = editing ? Number(editing.lat) : null
  const placingLon = editing ? Number(editing.lon) : null
  const placing = editing ? {
    unit: editing.unit,
    lat: editing.lat !== '' && Number.isFinite(placingLat) ? placingLat : null,
    lon: editing.lon !== '' && Number.isFinite(placingLon) ? placingLon : null,
  } : null

  return (
    <>
      <p className="map-note">
        <IconMapPin size={16} aria-hidden="true" />
        Assigned locations — units don't report GPS yet.
      </p>

      {syncWarn && (
        <div className="notice" role="status" style={{ color: 'var(--warn)' }}>
          {syncWarn}
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSyncWarn('')}>Dismiss</button>
        </div>
      )}

      {locError && (
        <div className="notice" style={{ color: 'var(--err)' }}>
          Couldn't load locations: {locError.message}
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => refetch()}>Retry</button>
        </div>
      )}

      <div className="map-layout">
        <div className="map-wrap">
          {editing && <div className="map-hint">Click the map to place {editing.unit}, or enter coordinates.</div>}
          <FleetMap pins={pins} selected={selected} placing={placing} onPick={onPick}
            onOpen={(unit) => navigate('/units/' + encodeURIComponent(unit))} />
        </div>

        <aside className="map-side">
          {editing && (
            <section className="group" aria-labelledby="loc-edit-h">
              <h2 id="loc-edit-h" className="group-hd" style={{ margin: 0 }}>Place {editing.unit}</h2>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                The unit uses this location for its weather forecast and local time zone.
              </p>
              <div className="field">
                <label htmlFor="loc-lat">Latitude</label>
                <input id="loc-lat" className="control" inputMode="decimal" value={editing.lat}
                  onChange={(e) => setEditing({ ...editing, lat: e.target.value, errors: {} })} />
                {editing.errors.lat && <span className="msg-err">{editing.errors.lat}</span>}
              </div>
              <div className="field">
                <label htmlFor="loc-lon">Longitude</label>
                <input id="loc-lon" className="control" inputMode="decimal" value={editing.lon}
                  onChange={(e) => setEditing({ ...editing, lon: e.target.value, errors: {} })} />
                {editing.errors.lon && <span className="msg-err">{editing.errors.lon}</span>}
              </div>
              <div className="field">
                <label htmlFor="loc-label">Label (optional)</label>
                <input id="loc-label" className="control" maxLength={LABEL_MAX} value={editing.label}
                  placeholder="e.g. Dallas yard"
                  onChange={(e) => setEditing({ ...editing, label: e.target.value, errors: {} })} />
                {editing.errors.label && <span className="msg-err">{editing.errors.label}</span>}
              </div>
              {editing.apiError && <div className="msg-err" role="alert">{editing.apiError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={save} disabled={setLoc.isPending}>Save location</button>
                <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </section>
          )}

          {placed.length > 0 && (
            <section className="panel" aria-label="On the map">
              <h2 className="map-side-h">On the map</h2>
              {placed.map((r) => (
                <UnitRow key={r.u.unit} r={r} canEdit={canEdit} onShow={setSelected} onEdit={startEdit} onRemove={setRemoving} />
              ))}
            </section>
          )}

          {unplaced.length > 0 && (
            <section className="panel" aria-label="Not placed yet">
              <h2 className="map-side-h"><IconMapPinOff size={16} aria-hidden="true" /> Not placed yet</h2>
              {unplaced.map((r) => (
                <UnitRow key={r.u.unit} r={r} canEdit={canEdit} onShow={setSelected} onEdit={startEdit} onRemove={setRemoving} />
              ))}
            </section>
          )}

          {!unitsLoading && list.length === 0 && <div className="notice">No units yet.</div>}
        </aside>
      </div>

      <ConfirmDialog
        open={!!removing}
        title={`Remove location for ${removing}?`}
        body="The unit will move to Not placed yet. You can set a new location any time."
        confirmLabel="Remove"
        danger
        pending={clearLoc.isPending}
        onConfirm={() => clearLoc.mutate(removing, { onSettled: () => setRemoving(null) })}
        onCancel={() => setRemoving(null)}
      />
    </>
  )
}
