import { fmt } from '../../api/contract.js'

function Cell({ label, value, color }) {
  return (
    <div className="tcell">
      <div className="tlbl">{label}</div>
      <div className="tval" style={color ? { color } : undefined}>{value}</div>
    </div>
  )
}

export default function OverviewTab({ tele }) {
  if (!tele) return <div className="notice">Waiting for telemetry…</div>

  const err = Number(tele.error_n) !== 0
  return (
    <>
      <div className="tgrid">
        <Cell label="Battery" value={fmt.volts(tele.batt_v)} color={tele.batt_v < 12 ? '#E24B4A' : undefined} />
        <Cell label="Cabin" value={fmt.tempF(tele.cabin_temp_f)} />
        <Cell label="External" value={fmt.tempF(tele.ext_temp_f)} />
        <Cell label="RPM" value={fmt.int(tele.rpm)} />
        <Cell label="Oil" value={tele.oil_ok ? 'OK' : 'LOW'} color={tele.oil_ok ? 'var(--brand-green-text)' : '#E24B4A'} />
        <Cell label="Ignition" value={tele.ignition ? 'ON' : 'OFF'} />
        <Cell label="Fan" value={fmt.pct(tele.fan_speed)} />
        <Cell label="Setpoint" value={fmt.tempF(tele.clmt_setpoint_f)} />
      </div>

      <div className="card">
        <div className="sec-hd"><span className="sec-title">Status</span></div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5 }}>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Mode</span> {tele.mode}</div>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Engine</span> {tele.engine_status}</div>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Control</span> {tele.control_status}</div>
          <div>
            <span style={{ color: 'var(--color-text-tertiary)' }}>Fault</span>{' '}
            <span style={err ? { color: '#E24B4A', fontWeight: 500 } : undefined}>{tele.error}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5, marginTop: 10 }}>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Engine hrs</span> {fmt.hours(tele.engine_hrs)}</div>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Oil hrs</span> {fmt.hours(tele.oil_hrs)}</div>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Machine hrs</span> {fmt.hours(tele.machine_hrs)}</div>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>FW</span> v{tele.apu_fw_version}</div>
        </div>
      </div>
    </>
  )
}
