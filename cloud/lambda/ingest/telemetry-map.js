'use strict';

// Pure telemetry mapper: gobi-agent build_telemetry_json() payload ->
// InfluxDB point descriptor. No I/O. Field names ARE the contract (see
// cloud/CONTRACT.md); they must match cloud/lambda/api/telemetry-view.js.

const TAGS = ['mode', 'engine_status', 'control_status', 'error', 'oil_change', 'heater_state',
  'apu_flash_state'];

const FLOAT = [
  'cabin_temp_f', 'ext_temp_f', 'batt_v', 'clmt_setpoint_f', 'batt_setpoint_v',
  'heater_supply_v', 'heater_pump_hz',
];
const INT = [
  'rpm', 'mode_n', 'engine_status_n', 'control_status_n', 'error_n', 'oil_change_n',
  'engine_hrs', 'oil_hrs', 'machine_hrs', 'fan_speed', 'diag_outputs', 'apu_fw_version',
  'apu_bundled_fw_version',
  'heater_target_level', 'heater_active_level', 'heater_error', 'heater_fan_rpm',
  'heater_exchanger', 'heater_state_seconds', 'heater_age_ms', 'heater_flags',
  'heater_valid_frames', 'heater_checksum_failures', 'heater_transport_errors',
];
const BOOL = [
  'oil_ok', 'ignition', 'fan_auto', 'diag_active', 'heater_present',
  'heater_safe_off', 'heater_comms_ok',
];

function mapTelemetry(msg) {
  const tags = { unit: String(msg.unit) };
  for (const t of TAGS) tags[t] = msg[t] != null ? String(msg[t]) : 'unknown';

  const fields = {};
  for (const f of FLOAT) fields[f] = { type: 'float', value: Number(msg[f] ?? 0) };
  for (const f of INT)   fields[f] = { type: 'int',   value: Math.trunc(Number(msg[f] ?? 0)) };
  for (const f of BOOL)  fields[f] = { type: 'bool',  value: Boolean(msg[f] ?? false) };

  return { measurement: 'telemetry', tags, fields, timestamp: msg.ts };
}

module.exports = { mapTelemetry, TAGS, FLOAT, INT, BOOL };
