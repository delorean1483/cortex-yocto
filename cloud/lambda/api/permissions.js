'use strict';

// Role → write-action permission matrix + command-body validation.
// Roles: admin, fm (fleet manager), maint (maintenance), eu (end user).
// Actions: heater, setpoint, apu, diag, ota, apu_ota, config, users, location.
//
// `config` gates benign device-cadence tuning (poll_interval_s, report_mode)
// via POST /fleet/config; reboot + firmware_target ride with `ota` (disruptive
// → admin/fm only). See configActions()/authorizeConfig() below.
//
// `apu_ota` (flashing the STM32 APU-controller firmware over RS-485): admin/fm
// only. validateCommand accepts `apu_firmware_target` (semver) and
// commandActions emits `apu_ota` (Phase 2, wired 2026-09-16). The trigger stays
// inert end-to-end until go-live: the frontend keeps it behind APU_OTA_ENABLED,
// and the agent has no firmware manifest on the device (IMAGE_INSTALL is gated
// on bench Cases A/B), so a stray request has nothing to flash.
//
// `location` gates assigning a unit's map location (Fleet map): admin/fm only.
const MATRIX = {
  admin: new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'apu_ota', 'config', 'users', 'location']),
  fm:    new Set(['heater', 'setpoint', 'apu', 'diag', 'ota', 'apu_ota', 'config', 'users', 'location']),
  maint: new Set(['heater', 'setpoint', 'diag', 'config']),
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
    if (!['climate', 'battery', 'stop'].includes(body.apu_command))
      return { ok: false, error: 'apu_command must be "climate", "battery" or "stop"' };
    desired.apu_command = body.apu_command;
  }

  if (body.firmware_target !== undefined) {
    if (typeof body.firmware_target !== 'string' || !/^\d+\.\d+\.\d+$/.test(body.firmware_target))
      return { ok: false, error: 'firmware_target must be a semver string (e.g. 1.2.41)' };
    desired.firmware_target = body.firmware_target;
  }

  // STM32 APU-controller firmware flash over RS-485 (rides the apu_ota action;
  // agent flashes only the bundled image, so this target must match it). The
  // frontend keeps this behind APU_OTA_ENABLED until the flash path is
  // bench-validated; the agent stays inert with no manifest on the device.
  if (body.apu_firmware_target !== undefined) {
    if (typeof body.apu_firmware_target !== 'string' || !/^\d+\.\d+\.\d+$/.test(body.apu_firmware_target))
      return { ok: false, error: 'apu_firmware_target must be a semver string (e.g. 1.1.1)' };
    desired.apu_firmware_target = body.apu_firmware_target;
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
  if (desired.apu_firmware_target) actions.add('apu_ota');
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

// Map the keys in a POST /fleet/config body to the write-actions they require.
// Unlike POST /command, /config carries device-cadence tuning as well as
// control-class keys, so each maps to the least-privileged action that fits:
//   firmware_target, reboot         -> ota      (disruptive: admin/fm)
//   clmt_setpoint_f, batt_setpoint_v -> setpoint (admin/fm/maint)
//   poll_interval_s, report_mode    -> config   (admin/fm/maint)
function configActions(config) {
  const actions = new Set();
  if (config.firmware_target !== undefined) actions.add('ota');
  if (config.reboot !== undefined)          actions.add('ota');
  if (config.clmt_setpoint_f !== undefined || config.batt_setpoint_v !== undefined)
    actions.add('setpoint');
  if (config.poll_interval_s !== undefined || config.report_mode !== undefined)
    actions.add('config');
  return [...actions];
}

// The caller's role must be permitted for EVERY action the config body implies
// (so a mixed body is only accepted if the role can do all of it). eu, with no
// write actions, is denied any config write.
function authorizeConfig(role, config) {
  for (const action of configActions(config)) {
    if (!canWrite(role, action))
      return { ok: false, error: `role "${role}" not permitted to ${action}` };
  }
  return { ok: true };
}

module.exports = { canWrite, validateCommand, commandActions, authorizeCommand,
                   configActions, authorizeConfig, MATRIX };
