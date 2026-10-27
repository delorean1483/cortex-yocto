'use strict';
// Run: node cloud/lambda/api/flux.test.js
const assert = require('node:assert');
const {
  latestFlux, telemetryFlux, seriesFlux, seriesPoints, unitsFlux, faultsFlux, clampLimit,
  UNITS_LOOKBACK, SERIES_FIELDS, MAX_SERIES_POINTS,
} = require('./flux');

// Index of a pipeline stage in the query text (-1 if absent).
const at = (q, stage) => q.indexOf(stage);

// ── latest: reduce each series to its newest point BEFORE the pivot ─────────
{
  const q = latestFlux('TRUCK-001');
  assert.ok(at(q, '|> last()') > -1, 'latest uses last()');
  assert.ok(at(q, '|> last()') < at(q, '|> pivot('), 'last() runs before pivot (pivot sees ~1 row per field, not 24h)');
  // Enum fields are tags, so state changes split series: still merge and pick the global newest.
  assert.ok(at(q, '|> pivot(') < at(q, '|> group()'), 'group() after pivot');
  assert.ok(at(q, '|> group()') < at(q, '|> sort('), 'group() before sort');
  assert.ok(/limit\(n: 1\)/.test(q), 'single row');
  assert.ok(q.includes('r.unit == "TRUCK-001"'));
}

// ── telemetry: trim each series to its newest N before the pivot ────────────
{
  const q = telemetryFlux('TRUCK-001', '-30d', 50);
  assert.ok(q.includes('range(start: -30d)'));
  assert.ok(at(q, '|> tail(n: 50)') > -1, 'tail(n) per series');
  assert.ok(at(q, '|> tail(n: 50)') < at(q, '|> pivot('), 'tail before pivot');
  assert.ok(/limit\(n: 50\)/.test(q), 'final global limit kept');
  assert.ok(at(q, '|> sort(columns: ["_time"], desc: true)') > at(q, '|> group()'), 'newest-first across merged series');
}

// ── series: chart fields averaged into fixed time buckets over the range ────
{
  const q = seriesFlux('TRUCK-001', '-7d', '1h');
  assert.ok(q.includes('range(start: -7d)'));
  assert.ok(q.includes('r._measurement == "telemetry" and r.unit == "TRUCK-001"'));
  for (const f of SERIES_FIELDS) assert.ok(q.includes(`r._field == "${f}"`), `reads ${f}`);
  assert.ok(!q.includes('heater'), 'only the chart fields are read, not all ~50');
  // Sum and count per series per bucket, both pushed down to storage. Enum tags
  // split a field into several series; the API adds the partials up, so a bucket
  // where the state changed is weighted by points, not by series.
  assert.ok(q.includes('aggregateWindow(every: 1h, fn: sum, createEmpty: false, timeSrc: "_start")'));
  assert.ok(q.includes('aggregateWindow(every: 1h, fn: count, createEmpty: false, timeSrc: "_start")'));
  assert.ok(q.includes('set(key: "agg", value: "sum")') && q.includes('set(key: "agg", value: "count")'),
    'rows say which partial they are');
  // union() rejects mixed _value types (rpm sums and all counts are int, batt_v
  // sums are float): InfluxDB 2.7 "schema collision detected".
  assert.strictEqual(q.split('|> toFloat()').length - 1, 2, 'both partials cast to float before the union');
  assert.ok(at(q, 'union(') < at(q, '|> toFloat()') && q.lastIndexOf('|> toFloat()') < at(q, '|> keep('),
    'cast happens inside the union inputs');
  // A source shared by both partials (a `data =` variable) stops InfluxDB pushing
  // the window aggregate down to storage: every raw point would reach the Flux
  // engine. Each partial reads its own source, filtered the same way.
  assert.strictEqual(q.split('from(bucket: "telemetry")').length - 1, 2, 'one source per partial');
  assert.strictEqual(q.split('r.unit == "TRUCK-001"').length - 1, 2, 'both sources filtered to the unit');
  assert.ok(!q.includes('fn: mean'), 'no mean of per-series means');
  assert.ok(!q.includes('pivot('), 'no pivot: the API folds the partials');
  assert.ok(!/limit\(/.test(q), 'no row limit: the bucket size bounds the row count');
}

// ── series: bucket count bounded, inputs validated ──────────────────────────
{
  assert.strictEqual(seriesPoints('-1h', '1m'), 60);
  assert.strictEqual(seriesPoints('-24h', '15m'), 96);
  assert.strictEqual(seriesPoints('-7d', '1h'), 168);
  assert.strictEqual(seriesPoints('-30d', '6h'), 120);
  assert.ok(MAX_SERIES_POINTS >= 168 && MAX_SERIES_POINTS <= 1000);
  assert.throws(() => seriesFlux('U', '-30d', '1m'), /buckets/, '43,200 buckets is too many');
  assert.throws(() => seriesFlux('U', '-7d', '1h) |> drop('), /every/, 'bucket size is validated');
  assert.throws(() => seriesFlux('U', '-7d', '0m'), /every/, 'zero-length bucket');
  assert.throws(() => seriesFlux('U', '-7d', '30s'), /every/, 'sub-minute buckets not offered');
  assert.throws(() => seriesFlux('U', '-1h) |> drop(', '1m'), /start/, 'range start is validated');
  assert.ok(seriesFlux('A"B', '-1h', '1m').includes('r.unit == "AB"'), 'quote stripped');
}

// ── injection guard: quotes stripped from the unit id, range must be relative ─
{
  assert.ok(!latestFlux('A"B').includes('A"B'), 'quote stripped');
  assert.ok(latestFlux('A"B').includes('r.unit == "AB"'));
  assert.throws(() => telemetryFlux('U', '-1h) |> drop(', 10), /start/, 'range start is validated');
  assert.ok(telemetryFlux('U', '-7d', 10).includes('range(start: -7d)'));
}

// ── unit list: shorter lookback ─────────────────────────────────────────────
{
  assert.strictEqual(UNITS_LOOKBACK, '-7d');
  assert.ok(unitsFlux().includes(`start: ${UNITS_LOOKBACK}`));
  assert.ok(unitsFlux().includes('schema.tagValues'));
}

// ── faults: validated range, trimmed before pivot ───────────────────────────
{
  const q = faultsFlux('TRUCK-001', '-7d', 100);
  assert.ok(q.includes('from(bucket: "faults")'));
  assert.ok(q.includes('range(start: -7d)'));
  assert.ok(q.includes('r._measurement == "faults" and r.unit == "TRUCK-001"'));
  assert.ok(at(q, '|> tail(n: 100)') > -1 && at(q, '|> tail(n: 100)') < at(q, '|> pivot('), 'tail before pivot');
  assert.ok(at(q, '|> group()') < at(q, '|> sort(columns: ["_time"], desc: true)'));
  assert.ok(/limit\(n: 100\)/.test(q));
  assert.throws(() => faultsFlux('U', '-7d) |> drop(', 10), /start/, 'range start is validated');
  assert.ok(faultsFlux('A"B', '-1d', 5).includes('r.unit == "AB"'), 'quote stripped');
}

// ── clampLimit: query-string limits can't produce NaN or runaway queries ────
{
  assert.strictEqual(clampLimit('50', 100, 500), 50);
  assert.strictEqual(clampLimit(undefined, 100, 500), 100);
  assert.strictEqual(clampLimit('abc', 100, 500), 100, 'non-numeric -> default');
  assert.strictEqual(clampLimit('0', 100, 500), 1, 'at least 1');
  assert.strictEqual(clampLimit('-5', 100, 500), 1);
  assert.strictEqual(clampLimit('9999', 100, 500), 500, 'capped');
}

console.log('flux.test.js: all assertions passed');
