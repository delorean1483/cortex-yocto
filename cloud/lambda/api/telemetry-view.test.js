'use strict';
// Run: node cloud/lambda/api/telemetry-view.test.js
const assert = require('node:assert');
const path = require('node:path');
const { mapTelemetryRow } = require('./telemetry-view');
const fx = require(path.join('..', '..', 'fixtures', 'telemetry.sample.json'));

// A pivoted InfluxDB row looks like the fixture plus a _time column and no ts.
const row = { ...fx, _time: '2025-09-11T04:00:00Z' };
delete row.ts;

const out = mapTelemetryRow(row);

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('ts from _time', () => assert.strictEqual(out.ts, new Date(row._time).getTime()));
check('carries batt_v', () => assert.strictEqual(out.batt_v, 12.64));
check('carries heater block', () => {
  assert.strictEqual(out.heater_state, 'off');
  assert.strictEqual(out.heater_transport_errors, 4213);
  assert.strictEqual(out.heater_comms_ok, false);
});
check('carries enum label + n', () => {
  assert.strictEqual(out.mode, 'battery');
  assert.strictEqual(out.mode_n, 2);
});
check('carries STM32 OTA fields (bundled + flash state)', () => {
  assert.strictEqual(out.apu_bundled_fw_version, 10300);
  assert.strictEqual(out.apu_flash_state, 'flashing');
});
check('no _time leaks through', () => assert.ok(!('_time' in out)));

check('coprocessor heater keys passed through when present', () => {
  const o = mapTelemetryRow({ ...row, heater_phase: 'running', heater_type: 'vevor', heater_fault: false,
    heater_setpoint_f: 70, heater_control: 'level', heater_vendor_state: '3.0', heater_cmd_result: 0 });
  assert.strictEqual(o.heater_phase, 'running');
  assert.strictEqual(o.heater_type, 'vevor');
  assert.strictEqual(o.heater_fault, false);
  assert.strictEqual(o.heater_setpoint_f, 70);
  assert.strictEqual('heater_phase' in out, false);              // absent stays absent
});

console.log(`\n${7 - failed}/7 checks passed`);
process.exit(failed === 0 ? 0 : 1);
