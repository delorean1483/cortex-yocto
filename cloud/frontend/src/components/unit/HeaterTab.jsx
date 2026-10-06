import { useState, useEffect } from 'react'
import { heaterStateLabel, heaterFlags, fmt, heaterCmdSeq, heaterDesiredPending,
  heaterExt, heaterPhaseLabel, heaterTypeLabel } from '../../api/contract.js'
import { useCommand, useShadow } from '../../data/hooks.js'
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
  const { data: shadow } = useShadow(unit)
  const { allowed, reason } = useCan('heater')
  const [confirm, setConfirm] = useState(null) // { title, body, cmd }
  const [level, setLevel] = useState(tele?.heater_target_level || 3)
  const [setpoint, setSetpoint] = useState(tele?.heater_setpoint_f || 72)

  // Ack tracking: capture the reported seq at send; the command is "applied"
  // once the device bumps heater_desired_seq past that baseline.
  const seq = heaterCmdSeq(shadow)
  const [baseSeq, setBaseSeq] = useState(null)
  const [pending, setPending] = useState(false)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    if (pending && baseSeq != null && seq > baseSeq) {
      setPending(false)
      setApplied(true)
      const t = setTimeout(() => setApplied(false), 3000)
      return () => clearTimeout(t)
    }
  }, [pending, baseSeq, seq])

  if (!tele) return <div className="notice">Waiting for telemetry…</div>
  if (!tele.heater_present) return <div className="notice">No heater detected on this unit.</div>

  const flags = heaterFlags(tele.heater_flags)
  const ext = heaterExt(tele)
  const fault = ext && !!tele.heater_fault
  // 255 = coprocessor fault without a vendor code (shown via the FAULT pill)
  const err = Number(tele.heater_error) !== 0 && !(fault && Number(tele.heater_error) === 255)
  const on = ext ? !['off', 'fault', 'detecting'].includes(tele.heater_phase) : tele.heater_state !== 'off'
  const useSetpoint = ext && tele.heater_control === 'setpoint'
  const typeLabel = heaterTypeLabel(tele.heater_type) || 'VEVOR'
  const stateText = ext ? heaterPhaseLabel(tele.heater_phase) : heaterStateLabel(tele.heater_state)
  const disabled = !allowed || isDemo
  const disabledReason = isDemo ? 'Demo units cannot be controlled.' : reason
  const showPending = pending || heaterDesiredPending(shadow)

  const ask = (title, body, cmd) => setConfirm({ title, body, cmd })
  const run = () => {
    command.mutate({ unit, body: confirm.cmd }, {
      onSuccess: () => { setBaseSeq(seq); setPending(true); setApplied(false) },
      onSettled: () => setConfirm(null),
    })
  }

  return (
    <div className="card">
      <div className="sec-hd">
        <span className="sec-title">{typeLabel} diesel heater — {stateText}</span>
        <span style={{ display: 'flex', gap: 5 }}>
          {fault && <span className="pill p-r">FAULT</span>}
          <span className={`pill ${tele.heater_comms_ok ? 'p-g' : 'p-r'}`}>
            {tele.heater_comms_ok ? 'COMMS OK' : 'NO COMMS'}
          </span>
        </span>
      </div>

      <div className="tgrid" style={{ marginTop: 4 }}>
        {useSetpoint
          ? <Cell label="Setpoint" value={fmt.tempF(tele.heater_setpoint_f)} />
          : <Cell label="Target level" value={fmt.int(tele.heater_target_level)} />}
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
        Link health — valid frames {fmt.counter(tele.heater_valid_frames)} ·
        checksum fails {fmt.counter(tele.heater_checksum_failures)} ·
        transport errors {fmt.counter(tele.heater_transport_errors)}
      </div>

      {/* Controls */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
             title={disabled ? disabledReason : undefined}>
          <button className={`btn btn-sm ${on ? 'btn-red' : 'btn-primary'}`} disabled={disabled || (fault && !on)}
            title={fault && !on ? 'Clear the fault before starting the heater.' : undefined}
            onClick={() => ask(
              on ? `Turn heater OFF` : `Turn heater ON`,
              `${on ? 'Stop' : 'Start'} the diesel heater on ${unit}?`,
              { heater: { on: on ? 0 : 1 } })}>
            {on ? 'Turn off' : 'Turn on'}
          </button>

          {fault && (
            <button className="btn btn-sm btn-red" disabled={disabled}
              onClick={() => ask('Clear heater fault',
                `Clear the heater fault on ${unit}? This does not start the heater; it only allows a new start once the heater reports standby.`,
                { heater: { clear_fault: true } })}>
              Clear fault
            </button>
          )}

          {useSetpoint ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>Setpoint</span>
            <button className="btn btn-sm" disabled={disabled || setpoint <= 41} onClick={() => setSetpoint((v) => Math.max(41, v - 2))}>−</button>
            <span style={{ minWidth: 34, textAlign: 'center', fontWeight: 600 }}>{setpoint}°F</span>
            <button className="btn btn-sm" disabled={disabled || setpoint >= 86} onClick={() => setSetpoint((v) => Math.min(86, v + 2))}>+</button>
            <button className="btn btn-sm btn-primary" disabled={disabled}
              onClick={() => ask('Set heater setpoint', `Set heater setpoint to ${setpoint}°F on ${unit}?`, { heater: { setpoint_f: setpoint } })}>
              Set
            </button>
          </div>
          ) : (
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
          )}

          {showPending && <span className="pill p-a">Pending…</span>}
          {applied && !showPending && <span className="pill p-g">Applied ✓</span>}
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
