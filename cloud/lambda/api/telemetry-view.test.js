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
check('no _time leaks through', () => assert.ok(!('_time' in out)));

console.log(`\n${5 - failed}/5 checks passed`);
process.exit(failed === 0 ? 0 : 1);
