import { useState, useEffect } from 'react'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'

const SEVERITY_MAP = {
  0x0001: { label: 'DC under-voltage',  cls: 'a-warn' },
  0x0002: { label: 'DC under-voltage',  cls: 'a-warn' },
  0x0004: { label: 'DC over-voltage',   cls: 'a-warn' },
  0x0008: { label: 'Over-current',       cls: 'a-crit' },
  0x0010: { label: 'Coolant over-temp',  cls: 'a-crit' },
  0x0020: { label: 'Low oil pressure',   cls: 'a-crit' },
  0x0040: { label: 'Comm timeout',       cls: 'a-warn' },
  0x0080: { label: 'Sensor fault',       cls: 'a-warn' },
}

function faultClass(fault) {
  if (!fault || fault === '0x0000' || fault === 0) return null
  const code = typeof fault === 'string' ? parseInt(fault, 16) : fault
  for (const [mask, info] of Object.entries(SEVERITY_MAP)) {
    if (code & Number(mask)) return info.cls
  }
  return 'a-warn'
}

function faultLabel(fault) {
  if (!fault || fault === '0x0000' || fault === 0) return 'Normal'
  const code = typeof fault === 'string' ? parseInt(fault, 16) : fault
  const labels = []
  for (const [mask, info] of Object.entries(SEVERITY_MAP)) {
    if (code & Number(mask)) labels.push(info.label)
  }
  return labels.join(', ') || `0x${code.toString(16).padStart(4, '0').toUpperCase()}`
}

function fmtAge(ts) {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

export default function AlertsPage() {
  const { selectedUnit, setSelectedUnit, role } = useAuth()
  const [units, setUnits]   = useState([])
  const [faults, setFaults] = useState(null)
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
    setFaults(null)
    setError('')
    api.getFaults(selectedUnit, { start: '-7d', limit: '100' })
      .then(d => setFaults(d.faults || []))
      .catch(err => setError(err.message))
  }, [selectedUnit])

  const activeFaults = faults ? faults.filter(f => f.fault && f.fault !== '0x0000' && f.fault !== 0) : []

  return (
    <>
      {/* Unit selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <select
          value={selectedUnit || ''}
          onChange={e => setSelectedUnit(e.target.value)}
          style={{ fontSize: 13, border: '0.5px solid var(--color-border-secondary)', borderRadius: 6, padding: '5px 10px', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', cursor: 'pointer' }}
        >
          {!selectedUnit && <option value="">— select unit —</option>}
          {units.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      {/* Active alerts */}
      <div>
        <div className="sec-hd">
          <span className="sec-title">Active faults</span>
          <span className="sec-sub">{selectedUnit || '—'} · last 7 days</span>
        </div>

        {error && <div className="notice" style={{ color: '#E24B4A' }}>⚠ {error}</div>}

        {!faults && !error && (
          <>{[1,2].map(i => <div key={i} className="skeleton" style={{ height: 50, marginBottom: 5 }} />)}</>
        )}

        {faults && activeFaults.length === 0 && (
          <div className="arow a-ok">
            <div className="atxt">
              <div className="atitle">No active faults</div>
              <div className="asub">All systems nominal for {selectedUnit}</div>
            </div>
          </div>
        )}

        {activeFaults.map((f, i) => (
          <div key={i} className={`arow ${faultClass(f.fault) || 'a-warn'}`}>
            <div className="atxt">
              <div className="atitle">{faultLabel(f.fault)} — {f.unit || selectedUnit}</div>
              <div className="asub">
                {f.fault} · {f.state || ''} {f.description ? `· ${f.description}` : ''}
              </div>
            </div>
            <div className="atime">{fmtAge(f.ts)}</div>
          </div>
        ))}
      </div>

      {/* Fault log */}
      {faults && faults.length > 0 && (
        <div>
          <div className="sec-hd">
            <span className="sec-title">Fault log</span>
            <span className="sec-sub">{faults.length} events</span>
          </div>
          <table className="dtbl">
            <thead>
              <tr><th>Time</th><th>Code</th><th>Description</th><th>State</th></tr>
            </thead>
            <tbody>
              {faults.slice(0, 50).map((f, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {new Date(f.ts).toLocaleString()}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{f.fault}</td>
                  <td>{f.description || faultLabel(f.fault)}</td>
                  <td>
                    <span className={`pill ${f.state === 'active' ? 'p-r' : f.state === 'cleared' ? 'p-g' : 'p-n'}`}>
                      {f.state || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Threshold table — read-only for maint/eu */}
      {role !== 'maint' && role !== 'eu' && (
        <div>
          <div className="sec-hd">
            <span className="sec-title">Alert thresholds</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>stored in device config</span>
          </div>
          <table className="dtbl">
            <thead><tr><th>Parameter</th><th>Condition</th><th>Severity</th></tr></thead>
            <tbody>
              <tr><td>Oil pressure</td><td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>&lt; 15 psi</td><td><span className="pill p-r">Critical</span></td></tr>
              <tr><td>DC voltage</td><td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>&lt; 25.5 V</td><td><span className="pill p-a">Warning</span></td></tr>
              <tr><td>Coolant temp</td><td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>&gt; 95 °C</td><td><span className="pill p-r">Critical</span></td></tr>
              <tr><td>Battery SOC</td><td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>&lt; 20 %</td><td><span className="pill p-a">Warning</span></td></tr>
            </tbody>
          </table>
          <div className="notice" style={{ marginTop: 8, fontSize: 11.5 }}>Thresholds are defined in the device firmware (gobi-agent). Configurable via Device Shadow config in a future release.</div>
        </div>
      )}
    </>
  )
}
