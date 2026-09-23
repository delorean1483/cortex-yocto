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
