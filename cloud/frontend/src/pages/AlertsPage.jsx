import { useState, useEffect } from 'react'
import {
  IconAlertTriangle, IconAlertCircle, IconCircleCheck, IconChevronRight,
} from '@tabler/icons-react'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { activeFaults, faultInfo, ageText } from '../api/contract.js'
import UnitPicker from '../components/UnitPicker.jsx'

const WINDOW_LABEL = 'last 7 days'

function whenText(ts) {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Reference only — trip points live in the APU controller firmware.
const MONITORED = [
  { name: 'Low oil pressure',  trigger: 'Engine oil-pressure switch open', critical: true },
  { name: 'High engine temp',  trigger: 'Coolant or engine over-temperature', critical: true },
  { name: 'Low battery',       trigger: 'Battery voltage below the safe threshold', critical: false },
  { name: 'A/C pressure',      trigger: 'Refrigerant pressure out of range (low or high)', critical: true },
  { name: 'Start / RPM fault', trigger: 'Failed to start, engine stalled, or no RPM', critical: true },
]

function SeverityBadge({ info }) {
  return <span className={`badge badge-sm t-${info.tone}`}>{info.severity}</span>
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
      if (!selectedUnit && list.length > 0) setSelectedUnit(list[0].unit)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedUnit) return
    let live = true
    setFaults(null)
    setError('')
    api.getFaults(selectedUnit, { start: '-7d', limit: '100' })
      .then(d => { if (live) setFaults(d.faults || []) })
      .catch(err => { if (live) setError(err.message) })
    return () => { live = false }
  }, [selectedUnit])

  const active = faults ? activeFaults(faults) : []
  const anyCritical = active.some((f) => faultInfo(f).tone === 'err')
  const tone = active.length === 0 ? 'ok' : anyCritical ? 'err' : 'warn'
  const BannerIcon = tone === 'ok' ? IconCircleCheck : tone === 'err' ? IconAlertTriangle : IconAlertCircle

  return (
    <>
      <div className="toolbar">
        <UnitPicker units={units} value={selectedUnit} onChange={setSelectedUnit} />
      </div>

      {error && <div className="notice" style={{ color: 'var(--err)' }}>⚠ {error}</div>}
      {!faults && !error && selectedUnit && <div className="skeleton" style={{ height: 88, borderRadius: 14 }} />}

      {faults && (
        <section aria-label="Fault status" className={`banner b-${tone}`}>
          <span className={`badge badge-icon t-${tone}`} style={{ width: 52, height: 52 }}>
            <BannerIcon size={28} aria-hidden="true" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="banner-title" style={{ margin: 0, color: tone === 'ok' ? 'var(--color-text-primary)' : `var(--${tone})` }}>
              {active.length === 0 ? 'No active faults' : `${active.length} active fault${active.length === 1 ? '' : 's'}`}
            </h2>
            <div className="banner-sub">{selectedUnit} · {WINDOW_LABEL}</div>
          </div>
        </section>
      )}

      {active.length > 0 && (
        <section aria-label="Active faults" className="panel">
          {active.map((f) => {
            const info = faultInfo(f)
            const Icon = info.tone === 'err' ? IconAlertTriangle : IconAlertCircle
            return (
              <div key={info.code} className="attn-row">
                <span className={`badge badge-icon t-${info.tone}`}><Icon size={20} aria-hidden="true" /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="attn-title">{info.name}</div>
                  <div className="attn-sub">Raised {ageText(Date.now() - f.ts)} · code {info.code}</div>
                </div>
                <SeverityBadge info={info} />
              </div>
            )
          })}
        </section>
      )}

      {faults && faults.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="sec-hd">
            <h2 id="fault-log-h" className="sec-title" style={{ margin: 0 }}>Fault log</h2>
            <span className="sec-sub">{faults.length} event{faults.length === 1 ? '' : 's'} · {WINDOW_LABEL}</span>
          </div>
          <div className="panel" style={{ overflowX: 'auto' }}>
            <table className="dtbl" aria-labelledby="fault-log-h">
              <thead>
                <tr><th>When</th><th>Fault</th><th>State</th></tr>
              </thead>
              <tbody>
                {faults.slice(0, 50).map((f, i) => {
                  const cleared = f.state === 'cleared'
                  const info = faultInfo(f)
                  return (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap' }}>{whenText(f.ts)}</td>
                      <td>
                        {cleared && info.code === '0x0000' ? 'All faults cleared' : info.name}
                        <span style={{ marginLeft: 8, fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>{info.code}</span>
                      </td>
                      <td>
                        <span className={`badge badge-sm ${cleared ? 't-ok' : f.state === 'active' ? `t-${info.tone}` : 't-off'}`}>
                          {cleared ? 'Cleared' : f.state === 'active' ? 'Active' : (f.state || '—')}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {role !== 'maint' && role !== 'eu' && (
        <details className="ref panel" style={{ padding: '4px 18px' }}>
          <summary>
            <IconChevronRight size={18} className="chev" aria-hidden="true" />
            What the controller monitors
          </summary>
          <table className="dtbl" style={{ marginBottom: 12 }}>
            <thead><tr><th>Fault</th><th>Trigger</th><th>Severity</th></tr></thead>
            <tbody>
              {MONITORED.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td style={{ color: 'var(--color-text-secondary)' }}>{m.trigger}</td>
                  <td><span className={`badge badge-sm ${m.critical ? 't-err' : 't-warn'}`}>{m.critical ? 'Critical' : 'Warning'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--color-text-secondary)' }}>
            The APU controller raises these faults. Its trip points are set in the controller's firmware.
          </p>
        </details>
      )}
    </>
  )
}
