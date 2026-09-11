'use strict';
// Run: node cloud/lambda/api/reports-view.test.js
const assert = require('node:assert');
const { buildReports, APU_SAVINGS_USD_PER_HR } = require('./reports-view');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('sums engine hours across units', () => {
  const r = buildReports({ engineHrsRows: [{ unit: 'a', _value: 100 }, { unit: 'b', _value: 150 }] });
  assert.strictEqual(r.totals.runtime_hrs, 250);
});
check('counts fault events', () => {
  const r = buildReports({ faultRows: [{ unit: 'a', _value: 3 }, { unit: 'b', _value: 5 }] });
  assert.strictEqual(r.totals.fault_events, 8);
});
check('mtbf = runtime / faults', () => {
  const r = buildReports({ engineHrsRows: [{ unit: 'a', _value: 800 }], faultRows: [{ unit: 'a', _value: 4 }] });
  assert.strictEqual(r.totals.mtbf_hrs, 200);
});
check('mtbf falls back to runtime when no faults', () => {
  const r = buildReports({ engineHrsRows: [{ unit: 'a', _value: 500 }], faultRows: [] });
  assert.strictEqual(r.totals.mtbf_hrs, 500);
});
check('fuel saved uses the documented rate', () => {
  const r = buildReports({ engineHrsRows: [{ unit: 'a', _value: 1000 }] });
  assert.strictEqual(r.totals.fuel_saved_usd, Math.round(1000 * APU_SAVINGS_USD_PER_HR));
});
check('empty input yields zeros + empty operators', () => {
  const r = buildReports({});
  assert.deepStrictEqual(r.totals, { runtime_hrs: 0, fuel_saved_usd: 0, mtbf_hrs: 0, fault_events: 0 });
  assert.deepStrictEqual(r.operators, []);
});

console.log(`\n${6 - failed}/6 checks passed`);
process.exit(failed === 0 ? 0 : 1);
