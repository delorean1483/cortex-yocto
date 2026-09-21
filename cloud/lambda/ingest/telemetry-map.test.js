'use strict';
// Run: node cloud/lambda/ingest/telemetry-map.test.js
const assert = require('node:assert');
const path = require('node:path');
const { mapTelemetry } = require('./telemetry-map');
const fx = require(path.join('..', '..', 'fixtures', 'telemetry.sample.json'));

const p = mapTelemetry(fx);

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('measurement + timestamp', () => {
  assert.strictEqual(p.measurement, 'telemetry');
  assert.strictEqual(p.timestamp, fx.ts);
});
check('unit + enum tags', () => {
  assert.strictEqual(p.tags.unit, 'APU-000123');
  assert.strictEqual(p.tags.mode, 'battery');
  assert.strictEqual(p.tags.heater_state, 'off');
});
check('float field batt_v', () => {
  assert.deepStrictEqual(p.fields.batt_v, { type: 'float', value: 12.64 });
});
check('int field rpm', () => {
  assert.deepStrictEqual(p.fields.rpm, { type: 'int', value: 0 });
});
check('bool field oil_ok', () => {
  assert.deepStrictEqual(p.fields.oil_ok, { type: 'bool', value: true });
});
check('heater field carried', () => {
  assert.deepStrictEqual(p.fields.heater_transport_errors, { type: 'int', value: 4213 });
});
check('apu_bundled_fw_version int field (STM32 OTA)', () => {
  assert.deepStrictEqual(p.fields.apu_bundled_fw_version, { type: 'int', value: 10300 });
});
check('apu_flash_state enum tag (STM32 OTA)', () => {
  assert.strictEqual(p.tags.apu_flash_state, 'flashing');
});
check('legacy names NOT present', () => {
  assert.ok(!('oil_psi' in p.fields), 'oil_psi should be gone');
  assert.ok(!('dc_v' in p.fields), 'dc_v should be gone');
  assert.ok(!('coolant_t' in p.fields), 'coolant_t should be gone');
});
check('missing fields tolerated', () => {
  const bare = mapTelemetry({ unit: 'X', ts: 1 });
  assert.strictEqual(bare.tags.unit, 'X');
  assert.strictEqual(bare.fields.batt_v.value, 0);
});

console.log(`\n${10 - failed}/10 checks passed`);
process.exit(failed === 0 ? 0 : 1);
