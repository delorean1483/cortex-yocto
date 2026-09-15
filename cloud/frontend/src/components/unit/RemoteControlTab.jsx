import { useState } from 'react'
import { useCommand } from '../../data/hooks.js'
import { useCan } from '../../components/RoleGate.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'

export default function RemoteControlTab({ tele, unit, isDemo }) {
  const command = useCommand()
  const { allowed, reason } = useCan('apu')
  const [confirm, setConfirm] = useState(null)

  const disabled = !allowed || isDemo
  const disabledReason = isDemo ? 'Demo units cannot be controlled.' : reason
  // The remote command sets the APU op-state (firmware mode reg): climate /
  // battery / stop. A button that wouldn't change state is disabled — but
  // switching between climate and battery while running is allowed, so the
  // guard keys on the reported mode, not a single running flag.
  const mode = tele && tele.mode

  const ask = (title, body, cmd, danger) => setConfirm({ title, body, cmd, danger })
  const run = () => command.mutate({ unit, body: confirm.cmd }, { onSettled: () => setConfirm(null) })

  return (
    <>
      <div className="card">
        <div className="sec-hd"><span className="sec-title">APU control</span></div>
        {tele && (
          <div style={{ fontSize: 12.5, marginBottom: 12 }}>
            <span style={{ color: 'var(--color-text-tertiary)' }}>Mode</span> {tele.mode}
            {' · '}<span style={{ color: 'var(--color-text-tertiary)' }}>Engine</span> {tele.engine_status}
            {' · '}<span style={{ color: 'var(--color-text-tertiary)' }}>Control</span> {tele.control_status}
            {' · '}<span style={{ color: 'var(--color-text-tertiary)' }}>RPM</span> {tele.rpm}
          </div>
        )}
        <div className="bbar" title={disabled ? disabledReason : undefined}>
          <button className="btn btn-primary" disabled={disabled || mode === 'climate'}
            onClick={() => ask('Start APU · Climate',
              `Start the APU on ${unit} in Climate mode? The engine will crank.`,
              { apu_command: 'climate' })}>
            Start · Climate
          </button>
          <button className="btn btn-orange" disabled={disabled || mode === 'battery'}
            onClick={() => ask('Start APU · Battery',
              `Start the APU on ${unit} in Battery mode? The engine will crank.`,
              { apu_command: 'battery' })}>
            Start · Battery
          </button>
          {/* Stop is never disabled as a no-op: the APU can be physically
              running with reg-10 mode 0 (e.g. a firmware battery auto-start),
              so a remote safety stop must always be available. */}
          <button className="btn btn-red" disabled={disabled}
            onClick={() => ask('Stop APU', `Stop the APU on ${unit}?`, { apu_command: 'stop' }, true)}>
            Stop APU
          </button>
        </div>
        {disabled && <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{disabledReason}</div>}
      </div>

      <div className="notice" style={{ fontSize: 11.5 }}>
        Temperature and battery-voltage setpoints and component-test actuation are read-only pending device-shadow support in the agent.
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel="Send"
        danger={confirm?.danger}
        pending={command.isPending}
        onConfirm={run}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}
