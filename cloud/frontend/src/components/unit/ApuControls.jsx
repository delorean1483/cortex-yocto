import { useState } from 'react'
import { useCommand } from '../../data/hooks.js'
import { useCan } from '../../components/RoleGate.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'

// APU start/stop buttons + crank confirmation, shared by the Remote tab and
// the Overview's Quick actions. `offline` (stale telemetry) blocks the starts:
// a command queued in the device shadow would be applied whenever the unit
// reconnects, and an engine cranking hours later is not what anyone asked
// for. Stop stays available — a queued stop is always safe.
export default function ApuControls({ tele, unit, isDemo, offline = false, stacked = false, extra = null }) {
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

  const note = disabled ? disabledReason
    : offline ? 'Unit is offline — starting is unavailable until it reports again. Stop can still be queued.'
    : 'Every action asks you to confirm before it is sent to the unit.'

  return (
    <>
      <div className={stacked ? 'actions' : 'bbar'} title={disabled ? disabledReason : undefined}
        style={stacked ? { display: 'flex', flexDirection: 'column', gap: 8 } : undefined}>
        <button className={`btn btn-primary${stacked ? ' btn-lg' : ''}`} disabled={disabled || offline || mode === 'climate'}
          onClick={() => ask('Start APU · Climate',
            `Start the APU on ${unit} in Climate mode? The engine will crank.`,
            { apu_command: 'climate' })}>
          Start climate
        </button>
        <button className={`btn btn-orange${stacked ? ' btn-lg' : ''}`} disabled={disabled || offline || mode === 'battery'}
          onClick={() => ask('Start APU · Battery',
            `Start the APU on ${unit} in Battery mode? The engine will crank.`,
            { apu_command: 'battery' })}>
          Start battery charge
        </button>
        {/* Stop is never disabled as a no-op: the APU can be physically
            running with reg-10 mode 0 (e.g. a firmware battery auto-start),
            so a remote safety stop must always be available. */}
        <button className={`btn btn-red${stacked ? ' btn-lg' : ''}`} disabled={disabled}
          onClick={() => ask('Stop APU', `Stop the APU on ${unit}?`, { apu_command: 'stop' }, true)}>
          Stop APU
        </button>
        {extra}
      </div>
      <div className="actions-note" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.45, color: 'var(--color-text-tertiary)' }}>{note}</div>

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
