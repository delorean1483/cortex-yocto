'use strict';

// Pure mapper: a pivoted InfluxDB telemetry row -> API response object.
// Field names MUST match cloud/lambda/ingest/telemetry-map.js (the contract).

const TELEMETRY_FIELD_NAMES = [
  'cabin_temp_f', 'ext_temp_f', 'batt_v', 'rpm', 'oil_ok', 'ignition',
  'mode', 'mode_n', 'engine_status', 'engine_status_n',
  'control_status', 'control_status_n', 'error', 'error_n',
  'oil_change', 'oil_change_n',
  'engine_hrs', 'oil_hrs', 'machine_hrs',
  'clmt_setpoint_f', 'batt_setpoint_v', 'fan_speed', 'fan_auto',
  'diag_active', 'diag_outputs', 'apu_fw_version',
  'heater_present', 'heater_state', 'heater_target_level', 'heater_active_level',
  'heater_error', 'heater_supply_v', 'heater_fan_rpm', 'heater_pump_hz',
  'heater_exchanger', 'heater_state_seconds', 'heater_age_ms', 'heater_flags',
  'heater_safe_off', 'heater_comms_ok',
  'heater_valid_frames', 'heater_checksum_failures', 'heater_transport_errors',
];

function mapTelemetryRow(r) {
  const out = { ts: r._time ? new Date(r._time).getTime() : r.ts };
  for (const k of TELEMETRY_FIELD_NAMES) if (k in r) out[k] = r[k];
  return out;
}

module.exports = { mapTelemetryRow, TELEMETRY_FIELD_NAMES };
