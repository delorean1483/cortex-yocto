'use strict';
// Guards that the golden telemetry fixture carries every contract field.
// Run: node cloud/fixtures/fixture.test.js
const assert = require('node:assert');
const fx = require('./telemetry.sample.json');

const REQUIRED = [
  'unit', 'ts',
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

let failed = 0;
for (const k of REQUIRED) {
  try { assert.ok(k in fx, `missing key: ${k}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${e.message}`); }
}
console.log(`\n${REQUIRED.length - failed}/${REQUIRED.length} keys present`);
process.exit(failed === 0 ? 0 : 1);
