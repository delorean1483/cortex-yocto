import { useFaults } from '../../data/hooks.js'

function statePill(state) {
  if (state === 'active') return 'p-r'
  if (state === 'cleared') return 'p-g'
  return 'p-n'
}

export default function HistoryTab({ unit }) {
  const { data: faults, isLoading } = useFaults(unit)

  if (isLoading) {
    return <>{[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 34, marginBottom: 5 }} />)}</>
  }
  if (!faults || faults.length === 0) {
    return <div className="notice">No fault events in the last 7 days — the unit has reported no faults. (This log shows faults only; live readings are on the Telemetry tab.)</div>
  }

  return (
    <div>
      <div className="sec-hd">
        <span className="sec-title">Event log</span>
        <span className="sec-sub">{faults.length} events · last 7 days</span>
      </div>
      <table className="dtbl">
        <thead><tr><th>Time</th><th>Code</th><th>Description</th><th>State</th></tr></thead>
        <tbody>
          {faults.map((f, i) => (
            <tr key={i}>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                {new Date(f.ts).toLocaleString()}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{f.fault}</td>
              <td>{f.error && f.error !== 'none' ? f.error : (f.description || '—')}</td>
              <td><span className={`pill ${statePill(f.state)}`}>{f.state || '—'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
