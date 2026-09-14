// Frontend mirror of the API permission matrix (UI gating only; the api
// Lambda's permissions.js is authoritative). Keep in sync with the spec.
// `apu_ota` gates flashing the STM32 APU-controller firmware over RS-485 — a
// higher safety bar than the Linux image `ota`, so it's admin/fm only (maint
// excluded, same as `ota`). Keep in sync with the api Lambda's matrix.
const MATRIX = {
  admin: new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'apu_ota', 'users']),
  fm:    new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'apu_ota', 'users']),
  maint: new Set(['heater', 'setpoint', 'diag']),
  eu:    new Set([]),
}

export function canWrite(role, action) {
  const s = MATRIX[role]
  return s ? s.has(action) : false
}
