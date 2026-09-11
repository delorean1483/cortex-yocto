import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUnits, useUnitLatest } from '../data/hooks.js'
import { unitStatus, statusDotClass, isStale, fmt } from '../api/contract.js'

function UnitRow({ u, onStatus }) {
  const { data: tele } = useUnitLatest(u.unit)
  const navigate = useNavigate()
  const status = unitStatus(tele)

  useEffect(() => { onStatus(u.unit, status) }, [u.unit, status, onStatus])

  const stale = tele && isStale(tele)
  return (
    <div className="urow" onClick={() => navigate('/units/' + encodeURIComponent(u.unit))}>
      <span className={`sdot ${statusDotClass(status)}`} />
      <span className="uid">{u.unit}</span>
      {u.demo && <span className="pill p-n" style={{ marginRight: 4 }}>demo</span>}
      <span className="umeta">
        {!tele ? 'no data' : stale ? 'stale' : 'live'}
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

export default function DashboardPage() {
  const { data: units, isLoading, error } = useUnits()
  const [statuses, setStatuses] = useState({})

  const report = useCallback((unit, status) => {
    setStatuses((s) => (s[unit] === status ? s : { ...s, [unit]: status }))
  }, [])

  if (error) return <div className="notice" style={{ color: '#E24B4A' }}>⚠ {error.message}</div>

  const list = units || []
  const vals = Object.values(statuses)
  const online = vals.filter((s) => s !== 'off').length
  const faults = vals.filter((s) => s === 'err').length
  const warnings = vals.filter((s) => s === 'warn').length

  return (
    <>
      <div className="sgrid">
        <div className="scard">
          <div className="scard-lbl">Online units</div>
          <div className="scard-val" style={{ color: 'var(--brand-green-text)' }}>
            {isLoading ? <span className="skeleton" style={{ display: 'inline-block', width: 34, height: 24 }} /> : online}
          </div>
          <div className="scard-sub">of {list.length} total</div>
        </div>
        <div className="scard">
          <div className="scard-lbl">Active faults</div>
          <div className="scard-val" style={{ color: faults ? '#E24B4A' : 'var(--color-text-primary)' }}>
            {isLoading ? <span className="skeleton" style={{ display: 'inline-block', width: 24, height: 24 }} /> : faults}
          </div>
          <div className="scard-sub">{faults ? 'attention needed' : 'all clear'}</div>
        </div>
        <div className="scard">
          <div className="scard-lbl">Warnings</div>
          <div className="scard-val" style={{ color: warnings ? 'var(--brand-orange)' : 'var(--color-text-primary)' }}>
            {isLoading ? <span className="skeleton" style={{ display: 'inline-block', width: 24, height: 24 }} /> : warnings}
          </div>
          <div className="scard-sub">low batt / oil</div>
        </div>
        <div className="scard">
          <div className="scard-lbl">Fleet size</div>
          <div className="scard-val">{list.length}</div>
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
