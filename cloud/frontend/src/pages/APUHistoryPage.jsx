import { useState, useEffect } from 'react'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'

function eventType(f) {
  if (!f.fault || f.fault === '0x0000' || f.fault === 0) {
    if (f.state === 'cleared') return { label: 'Cleared', cls: 'p-g' }
    return { label: 'Normal', cls: 'p-n' }
  }
  if (f.state === 'active')  return { label: 'Fault',   cls: 'p-r' }
  if (f.state === 'cleared') return { label: 'Cleared',  cls: 'p-g' }
  return { label: 'Fault', cls: 'p-r' }
}

export default function APUHistoryPage() {
  const { selectedUnit, setSelectedUnit } = useAuth()
  const [units, setUnits]   = useState([])
  const [faults, setFaults] = useState(null)
  const [tele, setTele]     = useState(null)
  const [range, setRange]   = useState('-30d')
  const [error, setError]   = useState('')

  useEffect(() => {
    api.listUnits().then(d => {
      const list = d.units || []
      setUnits(list)
      if (!selectedUnit && list.length > 0) setSelectedUnit(list[0])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedUnit) return
    setFaults(null); setTele(null); setError('')
    Promise.all([
      api.getFaults(selectedUnit, { start: range, limit: '100' }),
      api.getTelemetry(selectedUnit, { start: range, limit: '50' }),
    ]).then(([fd, td]) => {
      setFaults(fd.faults || [])
      setTele(td.telemetry || [])
    }).catch(err => setError(err.message))
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select
          value={selectedUnit || ''}
          onChange={e => setSelectedUnit(e.target.value)}
          style={{ fontSize: 13, border: '0.5px solid var(--color-border-secondary)', borderRadius: 6, padding: '5px 10px', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', cursor: 'pointer' }}
        >
          {!selectedUnit && <option value="">— select unit —</option>}
          {units.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select
          value={range}
          onChange={e => setRange(e.target.value)}
          style={{ fontSize: 12, border: '0.5px solid var(--color-border-secondary)', borderRadius: 6, padding: '5px 8px', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', cursor: 'pointer' }}
        >
          <option value="-1d">Last 24 h</option>
          <option value="-7d">Last 7 days</option>
          <option value="-30d">Last 30 days</option>
        </select>
      </div>

      <div>
        <div className="sec-hd">
          <span className="sec-title">Event log</span>
          <span className="sec-sub">{selectedUnit || '—'} · {range.replace('-','last ')}</span>
        </div>

        {error && <div className="notice" style={{ color: '#E24B4A' }}>⚠ {error}</div>}

        {!faults && !error && (
          <>{[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 36, marginBottom: 5 }} />)}</>
        )}

        {faults && events.length === 0 && (
          <div className="notice">No fault events recorded for {selectedUnit} in this time range.</div>
        )}

        {events.length > 0 && (
          <table className="dtbl">
            <thead>
              <tr><th>Timestamp</th><th>Unit</th><th>Event</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {events.slice(0, 100).map((ev, i) => {
                const et = eventType(ev)
                return (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {new Date(ev.ts).toLocaleString()}
                    </td>
                    <td>{selectedUnit}</td>
                    <td><span className={`pill ${et.cls}`}>{et.label}</span></td>
                    <td style={{ fontSize: 11.5, color: 'var(--color-text-secondary)' }}>{ev.detail}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Telemetry summary */}
      {tele && tele.length > 0 && (
        <div>
          <div className="sec-hd">
            <span className="sec-title">Telemetry samples</span>
            <span className="sec-sub">{tele.length} points</span>
          </div>
          <table className="dtbl">
            <thead>
              <tr><th>Time</th><th>DC V</th><th>SOC %</th><th>Oil PSI</th><th>Coolant °C</th><th>Runtime h</th></tr>
            </thead>
            <tbody>
              {tele.slice(0, 20).map((t, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(t.ts).toLocaleString()}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{t.dc_v?.toFixed(1) ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{t.batt_soc?.toFixed(0) ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{t.oil_psi?.toFixed(1) ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{t.coolant_t?.toFixed(0) ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{t.runtime_hrs?.toFixed(0) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
