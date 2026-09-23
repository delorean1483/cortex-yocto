import { useState, useEffect } from 'react'
import { IconRefresh, IconClockPause } from '@tabler/icons-react'
import { api } from '../api/client.js'
import { reportView } from '../api/contract.js'
import EmptyState from '../components/EmptyState.jsx'

const RANGES = [
  { label: '24 h', value: '-1d', long: 'the last 24 hours' },
  { label: '7 days', value: '-7d', long: 'the last 7 days' },
  { label: '30 days', value: '-30d', long: 'the last 30 days' },
]

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
  const view = reportView(totals)
  const range = RANGES.find((r) => r.value === start)

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="radiogroup" aria-label="Report period">
          {RANGES.map((r) => (
            <label key={r.value}>
              <input type="radio" name="report-range" value={r.value}
                checked={start === r.value} onChange={() => setStart(r.value)} />
              {r.label}
            </label>
          ))}
        </div>
        <button className="btn" onClick={fetchReport} disabled={loading}>
          <IconRefresh size={16} className={loading ? 'spin' : undefined} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && <div className="notice" style={{ color: 'var(--err)' }}>⚠ {error}</div>}

      {loading && !data && (
        <div className="stats">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 112, borderRadius: 12 }} />)}</div>
      )}

      {totals && view.zeroRuntime && (
        <EmptyState icon={IconClockPause} title={`No APU runtime in ${range.long}`}>
          The engine-hours counter didn't change on any real unit, so runtime, fuel savings and MTBF are zero.
          Demo units aren't included in reports.
        </EmptyState>
      )}

      {totals && (
        <div className="stats">
          {view.cards.map((c) => (
            <div key={c.key} className="stat">
              <div className="stat-lbl">{c.label}</div>
              <div className="stat-val" style={c.tone === 'ok' && !view.zeroRuntime ? { color: 'var(--ok)' } : undefined}>
                {c.value}{c.unit && <span className="stat-unit">{c.unit}</span>}
              </div>
              <div className="stat-cap">{c.caption}</div>
            </div>
          ))}
        </div>
      )}

      {operators.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="sec-hd">
            <h2 id="ops-h" className="sec-title" style={{ margin: 0 }}>Operator activity</h2>
            <span className="sec-sub">{range.long}</span>
          </div>
          <div className="panel" style={{ overflowX: 'auto' }}>
            <table className="dtbl" aria-labelledby="ops-h">
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
        </section>
      )}

      {!loading && !totals && !error && (
        <div className="notice">No report data for {range.long}.</div>
      )}
    </>
  )
}
