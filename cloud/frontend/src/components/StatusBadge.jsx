import { IconAlertTriangle, IconAlertCircle, IconCircleCheck, IconWifiOff } from '@tabler/icons-react'

const TONE_ICON = { err: IconAlertTriangle, warn: IconAlertCircle, ok: IconCircleCheck, off: IconWifiOff }

export default function StatusBadge({ view, size = 16, small = false }) {
  const Icon = TONE_ICON[view.tone]
  return (
    <span className={`badge${small ? ' badge-sm' : ''} t-${view.tone}`}>
      <Icon size={size} stroke={2.2} aria-hidden="true" />
      {view.status}
    </span>
  )
}
