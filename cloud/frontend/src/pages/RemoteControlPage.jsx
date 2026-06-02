import { useState, useEffect, useRef } from 'react'
import { IconRefresh, IconPlayerPlay, IconPlayerStop, IconHistory, IconCheck, IconLoader2 } from '@tabler/icons-react'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useNavigate } from 'react-router-dom'

function fmtVal(v, unit = '') {
  if (v == null) return '—'
  return `${Number(v).toFixed(v < 10 ? 1 : 0)}${unit}`
}

function dotClass(tele) {
  if (!tele) return 's-off'
  if (tele.fault && tele.fault !== '0x0000' && tele.fault !== 0) return 's-err'
  if (tele.dc_v && tele.dc_v < 25.5) return 's-warn'
  return 's-on'
}

export default function RemoteControlPage() {
  const { selectedUnit, setSelectedUnit, role } = useAuth()
  const [units, setUnits]       = useState([])
  const [tele, setTele]         = useState(null)
  const [shadow, setShadow]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const [configMsg, setConfigMsg]   = useState('')
  const [cmdPending, setCmdPending] = useState('')
  const [pollInterval, setPollInterval] = useState(5)
  const [reportMode, setReportMode]     = useState('normal')
  const pollRef = useRef(null)
  const navigate = useNavigate()
  const isMaint = role === 'maint'

  useEffect(() => {
    api.listUnits().then(d => {
      const list = d.units || []
      setUnits(list)
      if (!selectedUnit && list.length > 0) setSelectedUnit(list[0])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedUnit) return
    fetchData()
    const id = setInterval(fetchData, 15_000)
    return () => clearInterval(id)
  }, [selectedUnit])

  async function fetchData() {
    if (!selectedUnit) return
    setLoading(true)
    try {
      const [teleData, shadowData] = await Promise.all([
        api.getTelemetry(selectedUnit, { start: '-5m', limit: '1' }),
        api.getShadow(selectedUnit),
      ])
      const latest = teleData.telemetry?.[0] || null
      setTele(latest)
      setShadow(shadowData)
      if (shadowData?.reported) {
        setPollInterval(shadowData.reported.poll_interval_s || 5)
        setReportMode(shadowData.reported.report_mode || 'normal')
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  async function sendCommand(cmd) {
    if (!selectedUnit || cmdPending) return
    setCmdPending(cmd)
    try {
      await api.setConfig(selectedUnit, { apu_command: cmd })
      // Refresh telemetry after a short delay to pick up state change
      setTimeout(fetchData, 3000)
    } catch (err) {
      setConfigMsg(`Command failed: ${err.message}`)
    } finally {
      setCmdPending('')
    }
  }

  async function applyConfig(extra = {}) {
    if (!selectedUnit) return
    setConfigMsg('')
    try {
      await api.setConfig(selectedUnit, { poll_interval_s: pollInterval, report_mode: reportMode, ...extra })
      setConfigMsg('Config queued — device will apply on next sync.')
      setTimeout(() => setConfigMsg(''), 4000)
    } catch (err) {
      setConfigMsg(`Error: ${err.message}`)
    }
  }

  const dot = dotClass(tele)
  const fw  = shadow?.reported?.firmware_version || shadow?.desired?.firmware_target || '—'

  return (
    <>
      {/* Unit selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select
          value={selectedUnit || ''}
          onChange={e => setSelectedUnit(e.target.value)}
          style={{ fontSize: 13, fontWeight: 500, border: '0.5px solid var(--color-border-secondary)', borderRadius: 6, padding: '5px 10px', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', cursor: 'pointer' }}
        >
          {!selectedUnit && <option value="">— select unit —</option>}
          {units.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <button className="btn btn-sm" onClick={fetchData} title="Refresh">
          <IconRefresh size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        {tele && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Updated {new Date(tele.ts).toLocaleTimeString()}</span>}
      </div>

      {!selectedUnit && (
        <div className="notice">Select a unit above to view telemetry.</div>
      )}

      {selectedUnit && (
        <>
          {/* Status card */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className={`sdot ${dot}`} style={{ width: 9, height: 9 }} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>{selectedUnit}</span>
              {dot === 's-err' && <span className="pill p-r">FAULT</span>}
              {dot === 's-warn' && <span className="pill p-a">WARNING</span>}
              {dot === 's-on' && <span className="pill p-g">ONLINE</span>}
              {dot === 's-off' && <span className="pill p-n">NO DATA</span>}
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>FW: {fw}</span>
            </div>

            {!tele && <div className="notice" style={{ fontSize: 11 }}>No recent telemetry — device may be offline.</div>}

            {tele && (
              <div className="tgrid">
                <TCell label="DC voltage" val={tele.dc_v} unit=" V" warn={tele.dc_v < 25.5} err={tele.dc_v < 24} />
                <TCell label="Current"    val={tele.dc_a}   unit=" A" />
                <TCell label="Batt SOC"   val={tele.batt_soc} unit=" %" warn={tele.batt_soc < 30} />
                <TCell label="Oil PSI"    val={tele.oil_psi}  unit=" psi" err={tele.oil_psi != null && tele.oil_psi < 15} warn={tele.oil_psi != null && tele.oil_psi < 20} />
                <TCell label="Coolant"    val={tele.coolant_t} unit=" °C" warn={tele.coolant_t > 90} err={tele.coolant_t > 95} />
                <TCell label="Runtime"    val={tele.runtime_hrs} unit=" h" />
                <TCell label="RPM"        val={tele.rpm} />
                <TCell label="Power"      val={tele.watts} unit=" W" />
              </div>
            )}
          </div>

          {/* Actions */}
          <div>
            <div className="sec-hd"><span className="sec-title">Unit actions</span></div>
            <div className="bbar">
              <button className="btn btn-amber" disabled={isMaint || !!cmdPending} title={isMaint ? 'Requires supervisor sign-off' : ''} onClick={() => sendCommand('start')}>
                {cmdPending === 'start' ? <IconLoader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <IconPlayerPlay size={13} />}
                Start APU
              </button>
              <button className="btn btn-red" disabled={isMaint || !!cmdPending} onClick={() => sendCommand('stop')}>
                {cmdPending === 'stop' ? <IconLoader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <IconPlayerStop size={13} />}
                Stop APU
              </button>
              <button className="btn" onClick={() => { navigate('/history') }}>
                <IconHistory size={13} /> View logs
              </button>
            </div>
            {isMaint && (
              <div className="notice" style={{ marginTop: 8 }}>
                Maintenance role: start/stop requires supervisor sign-off.
              </div>
            )}
          </div>

          {/* Config (not for End User) */}
          {role !== 'eu' && (
            <div>
              <div className="sec-hd"><span className="sec-title">Device config</span></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>Poll interval (5–60 s)</label>
                  <input type="number" min={5} max={60} value={pollInterval} onChange={e => setPollInterval(Number(e.target.value))}
                    style={{ width: 80, fontSize: 12, padding: '5px 8px', border: '0.5px solid var(--color-border-secondary)', borderRadius: 6, background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>Report mode</label>
                  <select value={reportMode} onChange={e => setReportMode(e.target.value)}
                    style={{ fontSize: 12, padding: '5px 8px', border: '0.5px solid var(--color-border-secondary)', borderRadius: 6, background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)' }}>
                    <option value="normal">Normal</option>
                    <option value="eco">Eco</option>
                    <option value="debug">Debug</option>
                  </select>
                </div>
                <button className="btn btn-amber btn-sm" onClick={() => applyConfig()}>
                  <IconCheck size={12} /> Apply
                </button>
              </div>
              {configMsg && <div style={{ marginTop: 7, fontSize: 11.5, color: configMsg.startsWith('Error') ? '#E24B4A' : '#1D9E75' }}>{configMsg}</div>}
            </div>
          )}
        </>
      )}
    </>
  )
}

function TCell({ label, val, unit = '', warn, err }) {
  const color = err ? '#E24B4A' : warn ? '#BA7517' : 'var(--color-text-primary)'
  return (
    <div className="tcell">
      <div className="tlbl">{label}</div>
      <div className="tval" style={{ color }}>
        {val != null ? Number(val).toFixed(val < 10 ? 1 : 0) : '—'}
        {val != null && <span className="tunit">{unit}</span>}
      </div>
    </div>
  )
}
