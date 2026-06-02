import { useState, useEffect } from 'react'
import { IconUpload, IconRefresh } from '@tabler/icons-react'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'

const LATEST_VERSION = 'v1.0.0'

function versionStatus(reported, desired) {
  const current = reported?.firmware_version
  const target  = desired?.firmware_target
  if (!current) return { cls: 'p-n', label: 'Unknown' }
  if (target && target !== current) return { cls: 'p-a', label: 'Update queued' }
  if (current === LATEST_VERSION) return { cls: 'p-g', label: 'Up to date' }
  return { cls: 'p-a', label: 'Update available' }
}

export default function FirmwarePage() {
  const { role } = useAuth()
  const [units, setUnits]     = useState([])
  const [shadows, setShadows] = useState({})
  const [loading, setLoading] = useState(false)
  const [progressing, setProgressing] = useState({})
  const [msgs, setMsgs]       = useState({})
  const [fwTarget, setFwTarget] = useState('')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const { units: list } = await api.listUnits()
      setUnits(list || [])
      const results = await Promise.allSettled((list || []).map(u => api.getShadow(u)))
      const map = {}
      list.forEach((u, i) => {
        map[u] = results[i].status === 'fulfilled' ? results[i].value : null
      })
      setShadows(map)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  async function triggerUpdate(unit) {
    const target = fwTarget || LATEST_VERSION
    setMsgs(m => ({ ...m, [unit]: '' }))
    setProgressing(p => ({ ...p, [unit]: 0 }))
    try {
      await api.setConfig(unit, { firmware_target: target })
      // Simulate progress bar
      let w = 0
      const t = setInterval(() => {
        w += Math.random() * 15 + 5
        if (w >= 100) { w = 100; clearInterval(t) }
        setProgressing(p => ({ ...p, [unit]: Math.min(w, 100) }))
      }, 300)
      setMsgs(m => ({ ...m, [unit]: `OTA queued → ${target}` }))
      setTimeout(() => setProgressing(p => { const n = { ...p }; delete n[unit]; return n }), 8000)
    } catch (err) {
      setProgressing(p => { const n = { ...p }; delete n[unit]; return n })
      setMsgs(m => ({ ...m, [unit]: `Error: ${err.message}` }))
    }
  }

  const canUpdate = role === 'admin' || role === 'fm'

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>Latest release: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{LATEST_VERSION}</span></span>
        {canUpdate && (
          <>
            <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginLeft: 8 }}>Target version:</span>
            <input
              value={fwTarget}
              onChange={e => setFwTarget(e.target.value)}
              placeholder={LATEST_VERSION}
              style={{ fontSize: 12, fontFamily: 'var(--font-mono)', padding: '4px 8px', width: 100, border: '0.5px solid var(--color-border-secondary)', borderRadius: 6, background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)' }}
            />
          </>
        )}
        <button className="btn btn-sm" onClick={loadAll} title="Refresh">
          <IconRefresh size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>

      <div>
        <div className="sec-hd">
          <span className="sec-title">Firmware status</span>
          <span className="sec-sub">{units.length} units</span>
        </div>

        {loading && units.length === 0 && (
          <>{[1,2].map(i => <div key={i} className="skeleton" style={{ height: 40, marginBottom: 5 }} />)}</>
        )}

        {units.length > 0 && (
          <table className="dtbl">
            <thead>
              <tr><th>Unit</th><th>Current</th><th>Target</th><th>State</th>{canUpdate && <th></th>}</tr>
            </thead>
            <tbody>
              {units.map(unit => {
                const sh    = shadows[unit]
                const rep   = sh?.reported || {}
                const des   = sh?.desired  || {}
                const vs    = versionStatus(rep, des)
                const prog  = progressing[unit]
                const msg   = msgs[unit]
                return (
                  <tr key={unit}>
                    <td style={{ fontWeight: 500 }}>{unit}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{rep.firmware_version || '—'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: des.firmware_target ? 'var(--accent)' : 'var(--color-text-tertiary)' }}>
                      {des.firmware_target || LATEST_VERSION}
                    </td>
                    <td>
                      {prog !== undefined ? (
                        <div>
                          <span className="pill p-a">Updating…</span>
                          <div className="fw-bar" style={{ width: 80, marginTop: 4 }}>
                            <div className="fw-fill" style={{ width: `${prog}%` }} />
                          </div>
                        </div>
                      ) : (
                        <span className={`pill ${vs.cls}`}>{vs.label}</span>
                      )}
                      {msg && <div style={{ fontSize: 10.5, color: msg.startsWith('Error') ? '#E24B4A' : '#1D9E75', marginTop: 2 }}>{msg}</div>}
                    </td>
                    {canUpdate && (
                      <td>
                        {vs.label !== 'Up to date' && prog === undefined && (
                          <button className={`btn btn-sm ${vs.cls === 'p-a' ? 'btn-amber' : ''}`} onClick={() => triggerUpdate(unit)}>
                            <IconUpload size={11} /> Update
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {canUpdate && (
        <div>
          <div className="sec-hd"><span className="sec-title">Bulk OTA</span></div>
          <div className="bbar">
            <button className="btn btn-amber" onClick={() => {
              const outdated = units.filter(u => {
                const sh = shadows[u]
                const vs = versionStatus(sh?.reported, sh?.desired)
                return vs.label !== 'Up to date'
              })
              outdated.forEach(u => triggerUpdate(u))
            }}>
              <IconUpload size={13} /> Update all outdated
            </button>
          </div>
          <div className="notice" style={{ marginTop: 8, fontSize: 11.5 }}>
            OTA is triggered via AWS IoT Device Shadow. The device downloads and applies the update on next connection. Requires SWUpdate to be configured on the device.
          </div>
        </div>
      )}
    </>
  )
}
