import { IconBell, IconBellOff } from '@tabler/icons-react'
import { useMyAlerts, useSetMyAlerts } from '../data/hooks.js'

const SAVE_FAILED = "Couldn't save. Try again."
const LOAD_FAILED = "Couldn't load. Retry"

// The signed-in person's own email-alerts preference: low battery and APU fault
// emails for every unit. Shows the stored value (not the click) until a save
// succeeds, so a failed save never looks like it worked. Until the stored value
// has loaded the switch is dead: a click then would save a guess.
export default function AlertsSwitch({ compact, email }) {
  const { data, isError: loadFailed, refetch } = useMyAlerts()
  const save = useSetMyAlerts()
  const on = data?.email_alerts === true
  const unknown = !data
  const disabled = unknown || save.isPending
  const toggle = () => save.mutate(!on)
  const retry = () => refetch()

  if (compact && unknown && loadFailed) {
    return (
      <button type="button" onClick={retry} aria-label="Email alerts: couldn't load. Retry"
        title={`Email alerts: ${LOAD_FAILED}`}
        style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', color: 'var(--warn)' }}>
        <IconBellOff size={19} aria-hidden="true" />
      </button>
    )
  }

  if (compact) {
    const label = `Email alerts: ${on ? 'on' : 'off'}`
    const Icon = on ? IconBell : IconBellOff
    return (
      <button type="button" onClick={toggle} disabled={disabled} aria-pressed={on} aria-label={label}
        title={save.isError ? SAVE_FAILED : label}
        style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 8, cursor: disabled ? 'default' : 'pointer', color: save.isError ? 'var(--warn)' : on ? 'var(--accent)' : 'var(--color-text-tertiary)' }}>
        <Icon size={19} aria-hidden="true" />
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 0 16px' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>Email alerts</span>
        {unknown && loadFailed ? (
          <button type="button" onClick={retry}
            style={{ alignSelf: 'flex-start', padding: 0, background: 'none', border: 'none', font: 'inherit', fontSize: 12, color: 'var(--warn)', cursor: 'pointer', textDecoration: 'underline' }}>
            {LOAD_FAILED}
          </button>
        ) : (
          <span style={{ fontSize: 12, color: save.isError ? 'var(--warn)' : 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {save.isError ? SAVE_FAILED : `Sent to ${email}`}
          </span>
        )}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label="Email alerts"
        className="switch" onClick={toggle} disabled={disabled} />
    </div>
  )
}
