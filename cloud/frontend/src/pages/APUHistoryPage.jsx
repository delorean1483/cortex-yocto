import { useState, useEffect } from 'react'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useNavigate } from 'react-router-dom'
import UnitPicker from '../components/UnitPicker.jsx'
import { faultInfo, faultStateView, rangeLabel, shortWhen } from '../api/contract.js'

const RANGES = [
  { value: '-1d', label: '24 h' },
  { value: '-7d', label: '7 days' },
  { value: '-30d', label: '30 days' },
]

export default function APUHistoryPage() {
  const { selectedUnit, setSelectedUnit } = useAuth()
  const navigate = useNavigate()
  const [units, setUnits]   = useState([])
  const [faults, setFaults] = useState(null)
  const [tele, setTele]     = useState(null)
  // 24 h by default: a 30-day telemetry scan is heavy on InfluxDB, so it's opt-in.
  const [range, setRange]   = useState('-1d')
  const [error, setError]   = useState('')

  useEffect(() => {
    api.listUnits().then(d => {
      const list = d.units || []
      setUnits(list)
      // list items are { unit, demo } objects — select the unit id string.
      if (!selectedUnit && list.length > 0) setSelectedUnit(list[0].unit)
    }).catch(() => {})
  }, [])

  // Faults and telemetry load independently: the 30-day telemetry scan can be
  // slow, and it must not hold the fault log on skeletons. `live` drops
  // responses from a previous unit/range selection.
  useEffect(() => {
    if (!selectedUnit) return
    let live = true
    setFaults(null); setTele(null); setError('')
    api.getFaults(selectedUnit, { start: range, limit: '100' })
      .then(fd => { if (live) setFaults(fd.faults || []) })
      .catch(err => { if (live) setError(err.message) })
    api.getTelemetry(selectedUnit, { start: range, limit: '50' })
      .then(td => { if (live) setTele(td.telemetry || []) })
      .catch(() => { if (live) setTele([]) })
    return () => { live = false }
  }, [selectedUnit, range])

  // Merge faults + telemetry state-change events into one timeline
  const events = faults ? faults.map(f => ({
    ts: f.ts,
    type: 'fault',
    detail: f.description || f.fault,
    state: f.state,
    fault: f.fault,
  })).sort((a, b) => b.ts - a.ts) : []

  return (
    <>
      <div className="toolbar">
        <UnitPicker units={units} value={selectedUnit} onChange={setSelectedUnit} />
        <div className="seg" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => (
            <label key={r.value}>
              <input type="radio" name="history-range" value={r.value}
                checked={range === r.value} onChange={() => setRange(r.value)} />
              {r.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="sec-hd">
          <span className="sec-title">
            {faults && events.length > 0
              ? `Fault events · ${events.length} in the ${rangeLabel(range).toLowerCase()}`
              : 'Fault events'}
          </span>
          <span className="sec-sub">{selectedUnit || '—'} · {rangeLabel(range)}</span>
        </div>

        {error && <div className="notice" style={{ color: 'var(--err)' }}>⚠ {error}</div>}

        {!faults && !error && (
          <>{[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 36, marginBottom: 5 }} />)}</>
        )}

        {faults && events.length === 0 && (
          <div className="notice">No fault events recorded for {selectedUnit} in this time range.</div>
        )}

        {events.length > 0 && (
          <table className="dtbl">
            <thead>
              <tr><th className="w-190">When</th><th>Event</th><th>State</th></tr>
            </thead>
            <tbody>
              {events.slice(0, 100).map((ev, i) => {
                const info = faultInfo(ev)
                const sv = faultStateView(ev, info)
                return (
                  <tr key={i}>
                    <td className="nowrap">{shortWhen(ev.ts)}</td>
                    <td>
                      {sv.label === 'Cleared' && info.code === '0x0000' ? 'All faults cleared' : info.name}
                      <span className="code">{info.code}</span>
                    </td>
                    <td><span className={`badge badge-sm t-${sv.tone}`}>{sv.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Newest readings only (the API's newest 50 in range is a few minutes);
          trends over the range are on the Telemetry tab. */}
      {tele && tele.length > 0 && (
        <div>
          <div className="sec-hd">
            <span className="sec-title">Latest readings</span>
            <span className="sec-sub">Newest {Math.min(tele.length, 20)}</span>
            <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }}
              onClick={() => navigate('/units/' + encodeURIComponent(selectedUnit) + '?tab=telemetry')}>
              Open Telemetry tab
            </button>
          </div>
          <table className="dtbl">
            <thead>
              <tr><th>Time</th><th className="num">Battery</th><th className="num">RPM</th><th className="num">Cabin</th><th className="num">Oil</th><th className="num">Engine hours</th></tr>
            </thead>
            <tbody>
              {tele.slice(0, 20).map((t, i) => (
                <tr key={i}>
                  <td className="nowrap">{shortWhen(t.ts)}</td>
                  <td className="num">{t.batt_v == null ? '—' : `${t.batt_v.toFixed(2)} V`}</td>
                  <td className="num">{t.rpm ?? '—'}</td>
                  <td className="num">{t.cabin_temp_f == null ? '—' : `${t.cabin_temp_f.toFixed(0)}°F`}</td>
                  <td className="num">{t.oil_ok == null ? '—' : (t.oil_ok ? 'OK' : 'Low')}</td>
                  <td className="num">{t.engine_hrs == null ? '—' : `${t.engine_hrs.toFixed(0)} h`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
