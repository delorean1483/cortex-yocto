import { useState } from 'react'
import { heaterStateLabel, heaterFlags, fmt } from '../../api/contract.js'
import { useCommand } from '../../data/hooks.js'
import { useCan } from '../../components/RoleGate.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'

function Cell({ label, value }) {
  return (
    <div className="tcell">
      <div className="tlbl">{label}</div>
      <div className="tval">{value}</div>
    </div>
  )
}

export default function HeaterTab({ tele, unit, isDemo }) {
  const command = useCommand()
  const { allowed, reason } = useCan('heater')
  const [confirm, setConfirm] = useState(null) // { title, body, body: cmdBody, ... }
  const [level, setLevel] = useState(tele?.heater_target_level || 3)

  if (!tele) return <div className="notice">Waiting for telemetry…</div>
  if (!tele.heater_present) return <div className="notice">No heater detected on this unit.</div>

  const flags = heaterFlags(tele.heater_flags)
  const err = Number(tele.heater_error) !== 0
  const on = tele.heater_state !== 'off'
  const disabled = !allowed || isDemo
  const disabledReason = isDemo ? 'Demo units cannot be controlled.' : reason

  const ask = (title, body, cmd) => setConfirm({ title, body, cmd })
  const run = () => {
    command.mutate({ unit, body: confirm.cmd }, { onSettled: () => setConfirm(null) })
  }

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

      {/* Controls */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
             title={disabled ? disabledReason : undefined}>
          <button className={`btn btn-sm ${on ? 'btn-red' : 'btn-primary'}`} disabled={disabled}
            onClick={() => ask(
              on ? `Turn heater OFF` : `Turn heater ON`,
              `${on ? 'Stop' : 'Start'} the diesel heater on ${unit}?`,
              { heater: { on: on ? 0 : 1 } })}>
            {on ? 'Turn off' : 'Turn on'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>Level</span>
            <button className="btn btn-sm" disabled={disabled || level <= 1} onClick={() => setLevel((l) => Math.max(1, l - 1))}>−</button>
            <span style={{ minWidth: 18, textAlign: 'center', fontWeight: 600 }}>{level}</span>
            <button className="btn btn-sm" disabled={disabled || level >= 10} onClick={() => setLevel((l) => Math.min(10, l + 1))}>+</button>
            <button className="btn btn-sm btn-primary" disabled={disabled}
              onClick={() => ask('Set heater level', `Set heater level to ${level} on ${unit}?`, { heater: { level } })}>
              Set
            </button>
          </div>
        </div>
        {disabled && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{disabledReason}</div>}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel="Send"
        pending={command.isPending}
        onConfirm={run}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
