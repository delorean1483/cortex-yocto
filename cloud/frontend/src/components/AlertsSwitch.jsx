import { IconBell, IconBellOff } from '@tabler/icons-react'
import { useMyAlerts, useSetMyAlerts } from '../data/hooks.js'

const SAVE_FAILED = "Couldn't save. Try again."

// The signed-in person's own email-alerts preference: low battery and APU fault
// emails for every unit. Shows the stored value (not the click) until a save
// succeeds, so a failed save never looks like it worked.
export default function AlertsSwitch({ compact, email }) {
  const { data, isLoading } = useMyAlerts()
  const save = useSetMyAlerts()
  const on = data?.email_alerts === true
  const disabled = isLoading || save.isPending
  const toggle = () => save.mutate(!on)

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
        <span style={{ fontSize: 12, color: save.isError ? 'var(--warn)' : 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {save.isError ? SAVE_FAILED : `Sent to ${email}`}
        </span>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label="Email alerts"
        className="switch" onClick={toggle} disabled={disabled} />
    </div>
  )
}
