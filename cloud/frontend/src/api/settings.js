// Reporting-interval choices. The Dashboard marks a unit Offline after 60 s of
// silence, so <= 20 s always leaves room for three missed reports.
export const INTERVAL_CHOICES = [5, 10, 15, 20]
export const PENDING_TIMEOUT_MS = 120000

// State of a requested interval change, from what the unit reports back.
export function intervalStatus({ reported, requested, sentAt, now }) {
  if (requested == null) return 'idle'
  if (Number(reported) === Number(requested)) return 'confirmed'
  if (sentAt != null && now - sentAt > PENDING_TIMEOUT_MS) return 'unconfirmed'
  return 'pending'
}

// Remote reboot needs the agent's reboot-loop guard (system image 1.2.62+):
// older agents rebooted again on every start. Mirrors the API's 409 gate.
export const REBOOT_MIN_FW = '1.2.62'
const semver = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim())
  return m ? m.slice(1).map(Number) : null
}
export function supportsRemoteReboot(firmwareVersion) {
  const a = semver(firmwareVersion), b = semver(REBOOT_MIN_FW)
  if (!a) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return true
}
