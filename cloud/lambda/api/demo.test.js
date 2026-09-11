'use strict';
// Run: DEMO_UNITS=on node cloud/lambda/api/demo.test.js
const assert = require('node:assert');
process.env.DEMO_UNITS = 'on';
const { demoEnabled, listDemoUnits, isDemoUnit, demoLatest, demoSeries } = require('./demo');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('enabled by env', () => assert.strictEqual(demoEnabled(), true));
check('lists >=3 demo units', () => assert.ok(listDemoUnits().length >= 3));
check('isDemoUnit true for a demo id', () => assert.strictEqual(isDemoUnit(listDemoUnits()[0]), true));
check('isDemoUnit false for real id', () => assert.strictEqual(isDemoUnit('APU-000123'), false));
check('demoLatest is deterministic (except ts)', () => {
  const u = listDemoUnits()[0];
  const a = { ...demoLatest(u) }; delete a.ts;
  const b = { ...demoLatest(u) }; delete b.ts;
  assert.deepStrictEqual(a, b);
});
check('demoLatest has contract fields', () => {
  const l = demoLatest(listDemoUnits()[0]);
  assert.ok('batt_v' in l && 'heater_state' in l && 'ts' in l);
});
check('demoSeries length', () => assert.strictEqual(demoSeries(listDemoUnits()[0], 12).length, 12));

console.log(`\n${7 - failed}/7 checks passed`);
process.exit(failed === 0 ? 0 : 1);
