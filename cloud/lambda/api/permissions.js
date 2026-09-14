'use strict';

// Role → write-action permission matrix + command-body validation.
// Roles: admin, fm (fleet manager), maint (maintenance), eu (end user).
// Actions: heater, setpoint, apu, diag, ota, apu_ota, users.
//
// `apu_ota` (flashing the STM32 APU-controller firmware over RS-485) is
// declared here so the matrix stays in sync with the frontend mirror, but no
// command maps to it yet: validateCommand does NOT accept `apu_firmware_target`
// and commandActions does NOT emit `apu_ota`. Wiring that live trigger is scope
// Phase 2, gated on the STM32 flash path being bench-validated + PR #18 merged
// (docs/superpowers/specs/2026-09-14-apu-firmware-ota-control-scope.md).
const MATRIX = {
  admin: new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'apu_ota', 'users']),
  fm:    new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'apu_ota', 'users']),
  maint: new Set(['heater', 'setpoint', 'diag']),
  eu:    new Set([]),
};

function canWrite(role, action) {
  const set = MATRIX[role];
  return set ? set.has(action) : false;
}

function validateCommand(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'command body required' };
  const desired = {};

  if (body.heater !== undefined) {
    const h = body.heater;
    if (!h || typeof h !== 'object') return { ok: false, error: 'heater must be an object' };
    const out = {};
    if (h.on !== undefined) {
      if (h.on !== 0 && h.on !== 1) return { ok: false, error: 'heater.on must be 0 or 1' };
      out.on = h.on;
    }
    if (h.level !== undefined) {
      if (!Number.isInteger(h.level) || h.level < 1 || h.level > 10)
        return { ok: false, error: 'heater.level must be an integer 1–10' };
      out.level = h.level;
    }
    if (Object.keys(out).length === 0) return { ok: false, error: 'heater needs on and/or level' };
    desired.heater = out;
  }

  if (body.apu_command !== undefined) {
    if (!['start', 'stop'].includes(body.apu_command))
      return { ok: false, error: 'apu_command must be "start" or "stop"' };
    desired.apu_command = body.apu_command;
  }

  if (body.firmware_target !== undefined) {
    if (typeof body.firmware_target !== 'string' || !/^\d+\.\d+\.\d+$/.test(body.firmware_target))
      return { ok: false, error: 'firmware_target must be a semver string (e.g. 1.2.41)' };
    desired.firmware_target = body.firmware_target;
  }

  if (body.clmt_setpoint_f !== undefined) {
    const v = body.clmt_setpoint_f;
    if (typeof v !== 'number' || v < 50 || v > 90)
      return { ok: false, error: 'clmt_setpoint_f must be 50–90' };
    desired.clmt_setpoint_f = v;
  }

  if (body.batt_setpoint_v !== undefined) {
    const v = body.batt_setpoint_v;
    if (typeof v !== 'number' || v < 10 || v > 15)
      return { ok: false, error: 'batt_setpoint_v must be 10–15' };
    desired.batt_setpoint_v = v;
  }

  if (Object.keys(desired).length === 0)
    return { ok: false, error: 'no recognized command fields' };
  return { ok: true, desired };
}

function commandActions(desired) {
  const actions = new Set();
  if (desired.heater) actions.add('heater');
  if (desired.apu_command) actions.add('apu');
  if (desired.firmware_target) actions.add('ota');
  if (desired.clmt_setpoint_f !== undefined || desired.batt_setpoint_v !== undefined)
    actions.add('setpoint');
  return [...actions];
}

function authorizeCommand(role, desired) {
  for (const action of commandActions(desired)) {
    if (!canWrite(role, action))
      return { ok: false, error: `role "${role}" not permitted to ${action}` };
  }
  return { ok: true };
}

module.exports = { canWrite, validateCommand, commandActions, authorizeCommand, MATRIX };
