'use strict';
// Run: node cloud/lambda/api/locations-view.test.js
const assert = require('node:assert');
const { validateLocation, mergeLocations, DEMO_LOCATIONS, LABEL_MAX } = require('./locations-view');

// ── validateLocation ──────────────────────────────────────────────────────
{
  assert.deepStrictEqual(validateLocation({ lat: 32.9, lon: -97.04 }),
    { ok: true, value: { lat: 32.9, lon: -97.04, label: null } });
  assert.deepStrictEqual(validateLocation({ lat: 90, lon: -180, label: '  Dallas yard ' }),
    { ok: true, value: { lat: 90, lon: -180, label: 'Dallas yard' } }, 'bounds inclusive, label trimmed');
  assert.strictEqual(validateLocation({ lat: 1, lon: 2, label: '' }).value.label, null, 'empty label -> null');
  assert.strictEqual(validateLocation({ lat: 1, lon: 2, label: '   ' }).value.label, null, 'blank label -> null');

  const bad = (body, re) => {
    const r = validateLocation(body);
    assert.strictEqual(r.ok, false, JSON.stringify(body));
    assert.match(r.error, re);
  };
  bad(null, /body required/);
  bad({ lat: '32.9', lon: -97 }, /lat/);          // strings are not numbers
  bad({ lat: 91, lon: 0 }, /lat/);
  bad({ lat: NaN, lon: 0 }, /lat/);
  bad({ lat: 0, lon: 180.5 }, /lon/);
  bad({ lat: 0 }, /lon/);
  bad({ lat: 0, lon: 0, label: 7 }, /label must be a string/);
  bad({ lat: 0, lon: 0, label: 'x'.repeat(LABEL_MAX + 1) }, /60 characters/);
  assert.strictEqual(validateLocation({ lat: 0, lon: 0, label: 'x'.repeat(LABEL_MAX) }).ok, true);
}

// ── mergeLocations ────────────────────────────────────────────────────────
{
  const items = [
    { unit: 'TRUCK-002', lat: 30, lon: -90, updated_by: 'a@x.io', updated_at: 5 },
    { unit: 'TRUCK-001', lat: 32.9, lon: -97, label: 'Yard', updated_by: 'b@x.io', updated_at: 9 },
  ];
  const out = mergeLocations(items, ['APU-DEMO-01']);
  assert.deepStrictEqual(out.map((l) => l.unit), ['APU-DEMO-01', 'TRUCK-001', 'TRUCK-002'], 'sorted by unit');
  assert.deepStrictEqual(out[1], { unit: 'TRUCK-001', lat: 32.9, lon: -97, label: 'Yard',
    source: 'assigned', updated_by: 'b@x.io', updated_at: 9 });
  assert.strictEqual(out[2].label, null, 'missing label -> null');
  assert.strictEqual(out[0].source, 'demo');
  assert.strictEqual(out[0].lat, DEMO_LOCATIONS['APU-DEMO-01'].lat);
  assert.deepStrictEqual(mergeLocations([], []), [], 'nothing stored, demo off');
  assert.deepStrictEqual(mergeLocations(undefined, ['NOT-A-DEMO']), [], 'unknown demo ids ignored');
}

console.log('locations-view.test.js: all assertions passed');
