import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'

function statusDot(tele) {
  if (!tele) return 's-off'
  if (tele.fault && tele.fault !== 0 && tele.fault !== '0x0000') return 's-err'
  if (tele.dc_v && tele.dc_v < 25.5) return 's-warn'
  return 's-on'
}

function fmtVoltage(v) {
  return v != null ? `${Number(v).toFixed(1)} V` : '—'
}

export default function DashboardPage() {
  const { selectedUnit, setSelectedUnit, role } = useAuth()
  const [units, setUnits]     = useState(null)
  const [telemap, setTelemap] = useState({})
  const [error, setError]     = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    api.listUnits()
      .then(data => {
        setUnits(data.units || [])
        // Fetch latest telemetry for each unit (limit 1)
        data.units.forEach(u => {
          api.getTelemetry(u, { start: '-15m', limit: '1' })
            .then(r => {
              const latest = r.telemetry?.[0] || null
              setTelemap(prev => ({ ...prev, [u]: latest }))
            })
            .catch(() => {})
        })
      })
      .catch(err => setError(err.message))
  }, [])

  function openUnit(unit) {
    setSelectedUnit(unit)
    navigate('/remote')
  }

  const online  = units ? units.filter(u => telemap[u] && statusDot(telemap[u]) !== 's-off').length : 0
  const faulted = units ? units.filter(u => statusDot(telemap[u]) === 's-err').length : 0
  const warning = units ? units.filter(u => statusDot(telemap[u]) === 's-warn').length : 0

  if (error) return <div className="notice" style={{ color: '#E24B4A' }}>⚠ {error}</div>

  return (
    <>
      {/* Stat cards */}
      <div className="sgrid">
        <div className="scard">
          <div className="scard-lbl">Online units</div>
          <div className="scard-val" style={{ color: '#1D9E75' }}>
            {units ? online : <span className="skeleton" style={{ display: 'inline-block', width: 40, height: 26 }} />}
          </div>
          <div className="scard-sub">{units ? `of ${units.length} total` : '…'}</div>
        </div>
        <div className="scard">
          <div className="scard-lbl">Active faults</div>
          <div className="scard-val" style={{ color: faulted > 0 ? '#E24B4A' : 'var(--color-text-primary)' }}>
            {units ? faulted : <span className="skeleton" style={{ display: 'inline-block', width: 30, height: 26 }} />}
          </div>
          <div className="scard-sub">{warning > 0 ? `${warning} warning` : 'none active'}</div>
        </div>
        {role !== 'eu' && role !== 'maint' && (
          <div className="scard">
            <div className="scard-lbl">Fleet efficiency</div>
            <div className="scard-val">—</div>
            <div className="scard-sub">requires history data</div>
          </div>
        )}
      </div>

      {/* Unit list */}
      <div>
        <div className="sec-hd">
          <span className="sec-title">Unit status</span>
          <span className="sec-sub">{units ? `${units.length} units` : 'loading…'}</span>
        </div>

        {!units && (
          <>
            {[1,2,3].map(i => (
              <div key={i} className="skeleton" style={{ height: 38, marginBottom: 5 }} />
            ))}
          </>
        )}

        {units && units.length === 0 && (
          <div className="notice">No units found. Fleet data appears once a device connects to IoT Core and sends telemetry.</div>
        )}

        {units && units.map(unit => {
          const tele = telemap[unit]
          const dot = statusDot(tele)
          return (
            <div key={unit} className="urow" onClick={() => openUnit(unit)}>
              <span className={`sdot ${dot}`} />
              <span className="uid">{unit}</span>
              <span className="umeta">{tele ? new Date(tele.ts).toLocaleTimeString() : 'no recent data'}</span>
              <span className="uval">
                {tele ? fmtVoltage(tele.dc_v) : '—'}
                {tele?.fault && tele.fault !== '0x0000' && tele.fault !== 0 && (
                  <span style={{ color: '#E24B4A', fontSize: 10, marginLeft: 6 }}>
                    {tele.fault}
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}
