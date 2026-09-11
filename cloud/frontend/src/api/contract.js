// Pure view-model helpers over the telemetry contract (cloud/CONTRACT.md).

export function unitStatus(tele) {
  if (!tele) return 'off'
  if (Number(tele.error_n) !== 0) return 'err'
  if ((tele.batt_v != null && Number(tele.batt_v) < 12.0) || tele.oil_ok === false) return 'warn'
  return 'ok'
}

export function statusDotClass(status) {
  return { ok: 's-on', warn: 's-warn', err: 's-err', off: 's-off' }[status] || 's-off'
}

export function isStale(tele, maxAgeMs = 60000) {
  if (!tele || tele.ts == null) return true
  return (Date.now() - Number(tele.ts)) > maxAgeMs
}

export function heaterStateLabel(state) {
  if (!state) return 'Unknown'
  return String(state).charAt(0).toUpperCase() + String(state).slice(1)
}

const dash = (v) => v == null || Number.isNaN(Number(v))
export const fmt = {
  volts: (v) => dash(v) ? '—' : `${Number(v).toFixed(1)} V`,
  tempF: (v) => dash(v) ? '—' : `${Math.round(Number(v))}°F`,
  pct:   (v) => dash(v) ? '—' : `${Math.round(Number(v))}%`,
  int:   (v) => dash(v) ? '—' : `${Math.round(Number(v))}`,
  hours: (v) => dash(v) ? '—' : `${Math.round(Number(v))} h`,
}
