import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUnits, useUnitLatest } from '../data/hooks.js'
import { unitStatus, statusDotClass, isStale, fmt } from '../api/contract.js'

function UnitRow({ u, onStatus }) {
  const { data: tele, isLoading: teleLoading } = useUnitLatest(u.unit)
  const navigate = useNavigate()
  // 'pending' until the first latest-telemetry response, so the fleet cards
  // don't count a still-loading unit as offline / fault-free.
  const status = teleLoading ? 'pending' : unitStatus(tele)

  useEffect(() => { onStatus(u.unit, status) }, [u.unit, status, onStatus])

  const stale = tele && isStale(tele)
  return (
    <div className="urow" onClick={() => navigate('/units/' + encodeURIComponent(u.unit))}>
      <span className={`sdot ${statusDotClass(status)}`} />
      <span className="uid">{u.unit}</span>
      {u.demo && <span className="pill p-n" style={{ marginRight: 4 }}>demo</span>}
      <span className="umeta">
        {!tele ? (teleLoading ? '' : 'no data') : stale ? 'stale' : 'live'}
      </span>
      <span className="uval">
        {fmt.volts(tele?.batt_v)}
        {tele && Number(tele.error_n) !== 0 && (
          <span style={{ color: '#E24B4A', fontSize: 10, marginLeft: 6 }}>{tele.error}</span>
        )}
      </span>
    </div>
  )
}

function Pending({ width = 24 }) {
  return <span className="skeleton" style={{ display: 'inline-block', width, height: 24 }} />
}

export default function DashboardPage() {
  const { data: units, isLoading, error } = useUnits()
  const [statuses, setStatuses] = useState({})

  const report = useCallback((unit, status) => {
    setStatuses((s) => (s[unit] === status ? s : { ...s, [unit]: status }))
  }, [])

  if (error) return <div className="notice" style={{ color: '#E24B4A' }}>⚠ {error.message}</div>

  const list = units || []
  const vals = Object.values(statuses)
  const settled = !isLoading && list.every((u) => statuses[u.unit] && statuses[u.unit] !== 'pending')
  const online = vals.filter((s) => s !== 'off').length
  const faults = vals.filter((s) => s === 'err').length
  const warnings = vals.filter((s) => s === 'warn').length

  return (
    <>
      <div className="sgrid">
        <div className="scard">
          <div className="scard-lbl">Online units</div>
          <div className="scard-val" style={{ color: 'var(--brand-green-text)' }}>
            {settled ? online : <Pending width={34} />}
          </div>
          <div className="scard-sub">{isLoading ? '\u00a0' : `of ${list.length} total`}</div>
        </div>
        <div className="scard">
          <div className="scard-lbl">Active faults</div>
          <div className="scard-val" style={{ color: faults ? '#E24B4A' : 'var(--color-text-primary)' }}>
            {settled ? faults : <Pending />}
          </div>
          <div className="scard-sub">{!settled ? '\u00a0' : faults ? 'attention needed' : 'all clear'}</div>
        </div>
        <div className="scard">
          <div className="scard-lbl">Warnings</div>
          <div className="scard-val" style={{ color: warnings ? 'var(--brand-orange)' : 'var(--color-text-primary)' }}>
            {settled ? warnings : <Pending />}
          </div>
          <div className="scard-sub">low batt / oil</div>
        </div>
        <div className="scard">
          <div className="scard-lbl">Fleet size</div>
          <div className="scard-val">{isLoading ? <Pending /> : list.length}</div>
          <div className="scard-sub">units reporting</div>
        </div>
      </div>

      <div>
        <div className="sec-hd">
          <span className="sec-title">Unit status</span>
          <span className="sec-sub">{isLoading ? 'loading…' : `${list.length} units`}</span>
        </div>

        {isLoading && [1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 38, marginBottom: 5 }} />
        ))}

        {!isLoading && list.length === 0 && (
          <div className="notice">No units found. Fleet data appears once a device connects to IoT Core and sends telemetry.</div>
        )}

        {list.map((u) => <UnitRow key={u.unit} u={u} onStatus={report} />)}
      </div>
    </>
  )
}
