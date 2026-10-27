'use strict';
// Run: node cloud/lambda/api/series-view.test.js
const assert = require('node:assert');
const { bucketMeans } = require('./series-view');

const H = 3600 * 1000;
const NOW = Date.UTC(2026, 9, 27, 14, 20); // 14:20, not on a bucket edge
const iso = (ms) => new Date(ms).toISOString();
// One pushed-down partial: a series' sum or count for the bucket starting at `ms`.
const part = (ms, field, agg, value) => ({ _time: iso(ms), _field: field, agg, _value: value });

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('one bucket per `every` from the range start to now, oldest first, labelled by bucket start', () => {
  const out = bucketMeans([], '-24h', '1h', NOW);
  assert.strictEqual(out.length, 25, '13:00 yesterday (partial) .. 14:00 today (partial)');
  assert.strictEqual(out[0].ts, Date.UTC(2026, 9, 26, 14));
  assert.strictEqual(out[24].ts, Date.UTC(2026, 9, 27, 14));
  for (let i = 1; i < out.length; i++) assert.strictEqual(out[i].ts - out[i - 1].ts, H);
});

check('a bucket with no readings is null for every chart field (a gap, not zero)', () => {
  const [first] = bucketMeans([], '-24h', '1h', NOW);
  assert.deepStrictEqual(first, { ts: Date.UTC(2026, 9, 26, 14), batt_v: null, cabin_temp_f: null, rpm: null });
});

check('partials from different series in one bucket are weighted by their point counts', () => {
  // 13:00-14:00: a 6-minute engine run (mode tag "climate", 72 points at 2450 RPM)
  // then 54 minutes off (648 points at 0): true mean 245, mean of means 1225.
  const b = Date.UTC(2026, 9, 27, 13);
  const out = bucketMeans([
    part(b, 'rpm', 'sum', 2450 * 72), part(b, 'rpm', 'count', 72),
    part(b, 'rpm', 'sum', 0), part(b, 'rpm', 'count', 648),
  ], '-24h', '1h', NOW);
  assert.strictEqual(out.find((p) => p.ts === b).rpm, 245);
});

check('means are rounded to 2 decimals', () => {
  const b = Date.UTC(2026, 9, 27, 13);
  const out = bucketMeans([part(b, 'batt_v', 'sum', 36.8), part(b, 'batt_v', 'count', 3)], '-24h', '1h', NOW);
  assert.strictEqual(out.find((p) => p.ts === b).batt_v, 12.27);
});

check('the first partial bucket keys on its aligned start, not the clipped range start', () => {
  // timeSrc "_start" labels the first window with the range start (13:20 yesterday).
  const clipped = NOW - 24 * H;
  const out = bucketMeans([part(clipped, 'batt_v', 'sum', 12.5), part(clipped, 'batt_v', 'count', 1)], '-24h', '1h', NOW);
  assert.strictEqual(out[0].batt_v, 12.5);
});

check('fields outside the chart set are ignored', () => {
  const b = Date.UTC(2026, 9, 27, 13);
  const out = bucketMeans([part(b, 'heater_fan_rpm', 'sum', 9), part(b, 'heater_fan_rpm', 'count', 1)], '-24h', '1h', NOW);
  assert.ok(!('heater_fan_rpm' in out.find((p) => p.ts === b)));
});

if (failed) { console.error(`series-view.test.js: ${failed} failed`); process.exit(1); }
console.log('series-view.test.js: all checks passed');
