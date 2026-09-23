import { diagOutputs } from '../../api/contract.js'

export default function ComponentTestTab({ tele }) {
  if (!tele) return <div className="notice">Waiting for telemetry…</div>

  const outputs = diagOutputs(tele.diag_outputs)

  return (
    <>
      <div className="sec-hd">
        <span className="sec-title">Component test</span>
        <span className={`pill ${tele.diag_active ? 'p-a' : 'p-n'}`}>
          {tele.diag_active ? 'DIAG ACTIVE' : 'Inactive'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
        {outputs.map((o) => (
          <div key={o.idx} style={{
            padding: '12px 12px', borderRadius: 'var(--border-radius-md)',
            border: '0.5px solid var(--color-border-tertiary)',
            background: o.on ? 'var(--color-background-success)' : 'var(--color-background-secondary)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{o.name}</div>
            <div style={{ fontSize: 11, marginTop: 4, color: o.on ? 'var(--brand-green-text)' : 'var(--color-text-tertiary)' }}>
              {o.on ? '● ENERGIZED' : '○ off'}
            </div>
          </div>
        ))}
      </div>

      <div className="notice" style={{ fontSize: 11.5 }}>
        Live relay states reported by the APU controller. Actuating outputs is done from the in-cab panel (technician passcode required).
      </div>
    </>
  )
}
