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

export const HEATER_FLAG_LABELS = [
  { key: 'fresh',       bit: 0x01, label: 'Fresh' },
  { key: 'cooldown',    bit: 0x02, label: 'Cooldown' },
  { key: 'safe_off',    bit: 0x04, label: 'Safe-off' },
  { key: 'comms_fault', bit: 0x08, label: 'Comms fault' },
  { key: 'xport_fault', bit: 0x10, label: 'Transport fault' },
]
export function heaterFlags(flags) {
  const f = Number(flags) || 0
  return HEATER_FLAG_LABELS.map((x) => ({ key: x.key, label: x.label, on: (f & x.bit) !== 0 }))
}

// Component-test output names by index (mirrors firmware diag_outputs bits;
// best-effort labels — correct against firmware if they differ).
export const DIAG_OUTPUTS = [
  'Run/Ignition', 'Glow Plug', 'Starter', 'Fuel Pump',
  'Evap Fan', 'Compressor', 'Condenser Fan',
]
export function diagOutputs(mask) {
  const m = Number(mask) || 0
  return DIAG_OUTPUTS.map((name, idx) => ({ idx, name, on: (m & (1 << idx)) !== 0 }))
}

export function connLabel(tele) {
  if (!tele || tele.ts == null) return { text: 'no data', cls: 'p-n' }
  return isStale(tele) ? { text: 'stale', cls: 'p-a' } : { text: 'live', cls: 'p-g' }
}
