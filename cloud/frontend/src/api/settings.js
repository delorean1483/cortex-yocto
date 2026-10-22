import { versionAtLeast } from './contract.js'

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
export function supportsRemoteReboot(firmwareVersion) {
  return versionAtLeast(firmwareVersion, REBOOT_MIN_FW)
}
