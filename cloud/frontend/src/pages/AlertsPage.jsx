import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  IconAlertTriangle, IconAlertCircle, IconCircleCheck, IconChevronRight,
} from '@tabler/icons-react'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { faultInfo, ageText, faultStateView, shortWhen, fleetFaultRows, severityCounts, unitView } from '../api/contract.js'
import { useFleetLatest } from '../data/hooks.js'
import UnitPicker, { ALL_UNITS } from '../components/UnitPicker.jsx'
import FilterChips from '../components/FilterChips.jsx'

const WINDOW_LABEL = 'last 7 days'

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

function FaultCell({ info, cleared }) {
  const Icon = info.tone === 'err' ? IconAlertTriangle : IconAlertCircle
  return (
    <>
      {!cleared && <Icon size={18} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 8, color: `var(--${info.tone})` }} />}
      <span className="strong">{info.name}</span>
      <span className="code">{info.code}</span>
    </>
  )
}

export default function AlertsPage() {
  const { selectedUnit, setSelectedUnit, role } = useAuth()
  const fleetRole = role === 'admin' || role === 'fm'
  // Scope is page-local: AuthContext's selectedUnit is shared with other pages
  // and must never hold the all-units sentinel.
  const [scope, setScope]   = useState(fleetRole ? ALL_UNITS : selectedUnit)
  const [units, setUnits]   = useState([])
  const [ready, setReady]   = useState(false)
  const [results, setResults] = useState(null)
  const [sev, setSev]       = useState('all')
  const eff = scope === ALL_UNITS ? ALL_UNITS : (scope || selectedUnit)
  const allMode = eff === ALL_UNITS

  useEffect(() => {
    api.listUnits().then(d => {
      const list = d.units || []
      setUnits(list)
      if (!fleetRole && !selectedUnit && list.length > 0) setSelectedUnit(list[0].unit)
    }).catch(() => {}).finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!eff || (allMode && !ready)) return
    let live = true
    setResults(null)
    const targets = allMode ? units.map(u => u.unit) : [eff]
    Promise.allSettled(targets.map(u => api.getFaults(u, { start: '-7d', limit: '100' }))).then(settled => {
      if (!live) return
      setResults(settled.map((r, i) => r.status === 'fulfilled'
        ? { unit: targets[i], faults: r.value.faults || [] }
        : { unit: targets[i], error: r.reason }))
    })
    return () => { live = false }
  }, [eff, allMode && ready, allMode ? units : null])

  const { byUnit, pending } = useFleetLatest(units.map(u => u.unit))
  const now = Date.now()
  const offline = (unit) => !pending[unit] && byUnit[unit] !== undefined && unitView(byUnit[unit], now).stale

  const { active, log, failed } = results ? fleetFaultRows(results) : { active: [], log: [], failed: [] }
  const counts = severityCounts(active)
  const shown = allMode && sev !== 'all' ? active.filter(f => faultInfo(f).tone === sev) : active
  const unitCount = new Set(active.map(f => f.unit)).size
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

  const anyCritical = counts.err > 0
  const tone = active.length === 0 ? 'ok' : anyCritical ? 'err' : 'warn'
  const BannerIcon = tone === 'ok' ? IconCircleCheck : tone === 'err' ? IconAlertTriangle : IconAlertCircle

  const pick = (v) => {
    setScope(v)
    if (v !== ALL_UNITS) setSelectedUnit(v)
  }

  return (
    <>
      <div className="toolbar">
        <UnitPicker units={units} value={eff} onChange={pick} allLabel={fleetRole ? 'All units' : undefined} />
        {allMode && (
          <FilterChips label="Severity" value={sev} onChange={setSev} options={[
            { value: 'all',  label: `All · ${counts.all}` },
            { value: 'err',  label: `Critical · ${counts.err}` },
            { value: 'warn', label: `Warning · ${counts.warn}` },
          ]} />
        )}
        {allMode && <span className="sec-sub" style={{ marginLeft: 'auto' }}>Last 7 days</span>}
      </div>

      {failed.length > 0 && (
        <div className="notice" style={{ color: 'var(--err)' }}>{`Couldn't load faults for ${failed.join(', ')}`}</div>
      )}
      {!results && eff && <div className="skeleton" style={{ height: 88, borderRadius: 14 }} />}

      {results && !allMode && failed.length === 0 && (
        <section aria-label="Fault status" className={`banner b-${tone}`}>
          <span className={`badge badge-icon t-${tone}`} style={{ width: 52, height: 52 }}>
            <BannerIcon size={28} aria-hidden="true" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="banner-title" style={{ margin: 0, color: tone === 'ok' ? 'var(--color-text-primary)' : `var(--${tone})` }}>
              {active.length === 0 ? 'No active faults' : `${active.length} active fault${active.length === 1 ? '' : 's'}`}
            </h2>
            <div className="banner-sub">{eff} · {WINDOW_LABEL}</div>
          </div>
        </section>
      )}

      {results && allMode && (
        <div className="sec-hd" style={{ marginBottom: 0 }}>
          <h2 id="active-h" className="sec-title" style={{ margin: 0 }}>Active faults</h2>
          <span className="sec-sub">{active.length === 0 ? 'None across all units' : `${active.length} across ${plural(unitCount, 'unit')}`}</span>
        </div>
      )}

      {shown.length > 0 && (
        <section aria-label="Active faults" className="panel" style={{ overflowX: 'auto' }}>
          <table className="dtbl roomy" aria-label="Active faults">
            <thead>
              <tr>
                {allMode && <th className="w-150">Unit</th>}
                <th>Fault</th><th>Severity</th>
                {allMode && <th>Raised</th>}
                {allMode && <th />}
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => {
                const info = faultInfo(f)
                return (
                  <tr key={`${f.unit}-${info.code}`} className={info.tone === 'err' ? 'row-err' : undefined}>
                    {allMode && <td className="strong">{f.unit}</td>}
                    <td>
                      <FaultCell info={info} />
                      {!allMode && <div className="subline">Raised {ageText(now - f.ts)}</div>}
                    </td>
                    <td><SeverityBadge info={info} /></td>
                    {allMode && (
                      <td>
                        {ageText(now - f.ts)}
                        {offline(f.unit) && <div className="subline">Unit offline</div>}
                      </td>
                    )}
                    {allMode && (
                      <td className="num">
                        <Link className="btn btn-sm" to={`/units/${encodeURIComponent(f.unit)}`}
                          aria-label={`Open unit ${f.unit}`}>Open unit</Link>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {log.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="sec-hd">
            <h2 id="fault-log-h" className="sec-title" style={{ margin: 0 }}>Fault log</h2>
            <span className="sec-sub">{log.length} event{log.length === 1 ? '' : 's'} · {WINDOW_LABEL}</span>
          </div>
          <div className="panel" style={{ overflowX: 'auto' }}>
            <table className="dtbl roomy" aria-labelledby="fault-log-h">
              <thead>
                <tr>
                  <th className="w-170">When</th>
                  {allMode && <th className="w-150">Unit</th>}
                  <th>Fault</th>
                  <th className="w-110">State</th>
                </tr>
              </thead>
              <tbody>
                {log.slice(0, 50).map((f, i) => {
                  const cleared = f.state === 'cleared'
                  const info = faultInfo(f)
                  const sv = faultStateView(f, info)
                  return (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap' }}>{shortWhen(f.ts)}</td>
                      {allMode && <td className="strong">{f.unit}</td>}
                      <td>
                        {cleared && info.code === '0x0000' ? 'All faults cleared' : info.name}
                        <span className="code">{info.code}</span>
                      </td>
                      <td><span className={`badge badge-sm t-${sv.tone}`}>{sv.label}</span></td>
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
