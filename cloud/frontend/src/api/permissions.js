// Frontend mirror of the API permission matrix (UI gating only; the api
// Lambda's permissions.js is authoritative). Keep in sync with the spec.
const MATRIX = {
  admin: new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'users']),
  fm:    new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'users']),
  maint: new Set(['heater', 'setpoint', 'diag']),
  eu:    new Set([]),
}

export function canWrite(role, action) {
  const s = MATRIX[role]
  return s ? s.has(action) : false
}
