import { useState, useEffect } from 'react'
import { IconRefresh } from '@tabler/icons-react'
import { api } from '../api/client.js'

const RANGES = [
  { label: '24 h', value: '-1d' },
  { label: '7 days', value: '-7d' },
  { label: '30 days', value: '-30d' },
]

function money(v) {
  if (v == null) return '—'
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
}
function num(v) { return v == null ? '—' : Number(v).toLocaleString() }

export default function ReportsPage() {
  const [start, setStart] = useState('-7d')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { fetchReport() }, [start])

  async function fetchReport() {
    setLoading(true); setError('')
    try { setData(await api.getReports({ start })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const totals = data?.totals
  const operators = data?.operators || []

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {RANGES.map(r => (
          <button key={r.value}
            className={`btn btn-sm${start === r.value ? ' btn-primary' : ''}`}
            onClick={() => setStart(r.value)}>{r.label}</button>
        ))}
        <button className="btn btn-sm" onClick={fetchReport} style={{ marginLeft: 4 }}>
          <IconRefresh size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>

      {error && <div className="notice" style={{ color: '#E24B4A' }}>⚠ {error}</div>}

      {loading && !data && (
        <div className="sgrid">{[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 62 }} />)}</div>
      )}

      {totals && (
        <div className="sgrid">
          <div className="scard"><div className="scard-lbl">Total runtime</div><div className="scard-val">{num(totals.runtime_hrs)}<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}> h</span></div></div>
          <div className="scard"><div className="scard-lbl">Fuel saved</div><div className="scard-val" style={{ color: 'var(--brand-green-text)' }}>{money(totals.fuel_saved_usd)}</div></div>
          <div className="scard"><div className="scard-lbl">MTBF</div><div className="scard-val">{num(totals.mtbf_hrs)}<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}> h</span></div></div>
          <div className="scard"><div className="scard-lbl">Fault events</div><div className="scard-val">{num(totals.fault_events)}</div></div>
        </div>
      )}

      {operators.length > 0 && (
        <div>
          <div className="sec-hd"><span className="sec-title">Operator activity</span><span className="sec-sub">selected period</span></div>
          <table className="dtbl">
            <thead><tr><th>Operator</th><th>Fleet</th><th>Starts</th><th>Stops</th><th>FW updates</th></tr></thead>
            <tbody>
              {operators.map((o, i) => (
                <tr key={i}>
                  <td>{o.operator}</td><td>{o.fleet}</td>
                  <td>{o.starts}</td><td>{o.stops}</td><td>{o.fw_updates}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !totals && !error && (
        <div className="notice">No report data for this period.</div>
      )}
    </>
  )
}
