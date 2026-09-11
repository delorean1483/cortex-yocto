import { heaterStateLabel, heaterFlags, fmt } from '../../api/contract.js'

function Cell({ label, value }) {
  return (
    <div className="tcell">
      <div className="tlbl">{label}</div>
      <div className="tval">{value}</div>
    </div>
  )
}

export default function HeaterTab({ tele }) {
  if (!tele) return <div className="notice">Waiting for telemetry…</div>
  if (!tele.heater_present) return <div className="notice">No heater detected on this unit.</div>

  const flags = heaterFlags(tele.heater_flags)
  const err = Number(tele.heater_error) !== 0

  return (
    <div className="card">
      <div className="sec-hd">
        <span className="sec-title">VEVOR diesel heater — {heaterStateLabel(tele.heater_state)}</span>
        <span className={`pill ${tele.heater_comms_ok ? 'p-g' : 'p-r'}`}>
          {tele.heater_comms_ok ? 'COMMS OK' : 'NO COMMS'}
        </span>
      </div>

      <div className="tgrid" style={{ marginTop: 4 }}>
        <Cell label="Target level" value={fmt.int(tele.heater_target_level)} />
        <Cell label="Active level" value={fmt.int(tele.heater_active_level)} />
        <Cell label="Exchanger" value={fmt.int(tele.heater_exchanger)} />
        <Cell label="Fan RPM" value={fmt.int(tele.heater_fan_rpm)} />
        <Cell label="Pump Hz" value={tele.heater_pump_hz != null ? Number(tele.heater_pump_hz).toFixed(1) : '—'} />
        <Cell label="Supply" value={fmt.volts(tele.heater_supply_v)} />
        <Cell label="In-state" value={`${fmt.int(tele.heater_state_seconds)}s`} />
      </div>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 12 }}>
        {flags.map((f) => (
          <span key={f.key}
            className={`pill ${f.on ? (f.key === 'xport_fault' || f.key === 'comms_fault' || f.key === 'safe_off' ? 'p-r' : 'p-a') : 'p-n'}`}
            style={f.on ? undefined : { opacity: 0.5 }}>
            {f.label}
          </span>
        ))}
      </div>

      {err && (
        <div style={{ marginTop: 10, color: '#E24B4A', fontSize: 12.5 }}>
          Heater error code: {tele.heater_error}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        Link health — valid frames {fmt.int(tele.heater_valid_frames)} ·
        checksum fails {fmt.int(tele.heater_checksum_failures)} ·
        transport errors {fmt.int(tele.heater_transport_errors)}
      </div>

      <div className="notice" style={{ marginTop: 12, fontSize: 11.5 }}>
        On/off and level control (guarded + confirm) is added in Plan 4.
      </div>
    </div>
  )
}
