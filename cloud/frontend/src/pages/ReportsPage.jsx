import { useState, useEffect } from 'react'
import { IconRefresh, IconChartBar } from '@tabler/icons-react'
import { api } from '../api/client.js'

const RANGES = [
  { label: '24 h',   value: '-1d' },
  { label: '7 days', value: '-7d' },
  { label: '30 days',value: '-30d' },
]

function fmt(v, digits = 1) {
  if (v == null) return '—'
  return Number(v).toFixed(digits)
}

export default function ReportsPage() {
  const [start, setStart]     = useState('-7d')
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => { fetchReport() }, [start])

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      const d = await api.getReports({ start })
      setData(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const units = data?.units || []

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {RANGES.map(r => (
            <button key={r.value}
              className={`btn btn-sm${start === r.value ? ' btn-amber' : ''}`}
              onClick={() => setStart(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
        <button className="btn btn-sm" onClick={fetchReport} style={{ marginLeft: 4 }}>
          <IconRefresh size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        {data && (
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
            Generated {new Date(data.generated_at).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <div className="notice" style={{ fontSize: 12, color: '#E24B4A' }}>{error}</div>}

      {loading && <div className="notice" style={{ fontSize: 11 }}>Running queries…</div>}

      {!loading && units.length === 0 && !error && (
        <div className="notice" style={{ fontSize: 11 }}>No telemetry data for this period.</div>
      )}

      {!loading && units.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                {['Unit', 'Runtime (hrs)', 'Avg DC V', 'Avg SOC %', 'Faults'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10.5, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {units.map(u => (
                <tr key={u.unit} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <IconChartBar size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                      <span style={{ fontWeight: 500 }}>{u.unit}</span>
                    </div>
                  </td>
                  <td style={tdStyle}>{fmt(u.runtime_hrs, 1)}</td>
                  <td style={{ ...tdStyle, color: u.avg_dc_v != null && u.avg_dc_v < 25.5 ? '#BA7517' : 'inherit' }}>
                    {fmt(u.avg_dc_v)} V
                  </td>
                  <td style={{ ...tdStyle, color: u.avg_batt_soc != null && u.avg_batt_soc < 30 ? '#BA7517' : 'inherit' }}>
                    {fmt(u.avg_batt_soc)} %
                  </td>
                  <td style={tdStyle}>
                    {u.fault_count > 0
                      ? <span className="pill p-r">{u.fault_count}</span>
                      : <span className="pill p-g">0</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && units.length > 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>
          Runtime shows the last recorded cumulative total. Averages computed from telemetry samples in the selected window.
        </div>
      )}
    </>
  )
}

const tdStyle = { padding: '8px 12px', verticalAlign: 'middle' }
