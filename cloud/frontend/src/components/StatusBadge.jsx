import { IconAlertTriangle, IconAlertCircle, IconCircleCheck, IconWifiOff } from '@tabler/icons-react'

const TONE_ICON = { err: IconAlertTriangle, warn: IconAlertCircle, ok: IconCircleCheck, off: IconWifiOff }

export default function StatusBadge({ view, size = 16 }) {
  const Icon = TONE_ICON[view.tone]
  return (
    <span className={`badge t-${view.tone}`}>
      <Icon size={size} stroke={2.2} aria-hidden="true" />
      {view.status}
    </span>
  )
}
