'use strict';
// Run: node cloud/lambda/api/flux.test.js
const assert = require('node:assert');
const { latestFlux, telemetryFlux, unitsFlux, UNITS_LOOKBACK } = require('./flux');

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

console.log('flux.test.js: all assertions passed');
