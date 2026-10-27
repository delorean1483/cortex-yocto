'use strict';
// Run: node cloud/lambda/ingest/battery-alert.test.js
const assert = require('node:assert');
const {
  stepBattery, batteryEmail, INITIAL_STATE, HOLD_MS, DAILY_MS,
} = require('./battery-alert');

const MIN = 60 * 1000;

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

// Runs the rule over readings [{ at, v, tsMs? }] (tsMs defaults to arrival).
function feed(readings, init = null) {
  let state = init;
  const emails = [];
  for (const r of readings) {
    const res = stepBattery(state, { v: r.v, tsMs: r.tsMs ?? r.at }, r.at);
    state = res.state;
    if (res.email) emails.push({ ...res.email, at: r.at });
  }
  return { state, emails };
}

// Readings at `v` every `stepMs` from `from` up to and including `to`.
function steady(from, to, stepMs, v) {
  const out = [];
  for (let at = from; at <= to; at += stepMs) out.push({ at, v });
  return out;
}

const alertingAt = (lastV) => ({ ...INITIAL_STATE, alerting: true, lastV, lastSentMs: 0 });

check('no email for an engine crank', () => {
  const { emails } = feed([
    ...steady(0, 5 * MIN, 20000, 12.6),
    ...steady(5 * MIN + 20000, 5 * MIN + 50000, 10000, 10.4),
    ...steady(6 * MIN, 26 * MIN, 20000, 12.6),
  ]);
  assert.deepStrictEqual(emails, []);
});

check('first alert after 10 minutes under 12 V', () => {
  const { emails } = feed(steady(0, 15 * MIN, 20000, 11.8));
  assert.deepStrictEqual(emails, [{ kind: 'low', v: 11.8, at: HOLD_MS }]);
});

check('12.00 V is not low', () => {
  const { emails, state } = feed(steady(0, 60 * MIN, 20000, 12.0));
  assert.deepStrictEqual(emails, []);
  assert.strictEqual(state.runKind, null);
});

check('hovering around 12 V never holds', () => {
  const readings = [];
  for (let i = 0; i <= 120; i++) readings.push({ at: i * MIN, v: i % 2 ? 12.01 : 11.98 });
  assert.deepStrictEqual(feed(readings).emails, []);
});

check('a lone 0.00 reading while alerting at 5.3 V', () => {
  const { emails } = feed([
    { at: 0, v: 5.3 }, { at: 20000, v: 0.0 }, ...steady(40000, 20 * MIN, 20000, 5.3),
  ], alertingAt(5.3));
  assert.deepStrictEqual(emails, []);
});

check('further-volt drop needs its own 10 minutes', () => {
  const first = feed(steady(0, 9 * MIN, 20000, 10.5), alertingAt(11.5));
  assert.deepStrictEqual(first.emails, []);
  const rest = feed(steady(9 * MIN + 20000, 12 * MIN, 20000, 10.5), first.state);
  assert.deepStrictEqual(rest.emails, [{ kind: 'lower', v: 10.5, at: HOLD_MS }]);
  assert.strictEqual(rest.state.lastV, 10.5);
});

check('daily reminder 24 h after the last email', () => {
  const { emails } = feed(steady(0, 2.5 * DAILY_MS, 10 * MIN, 11.5), alertingAt(11.5));
  assert.deepStrictEqual(emails.map((e) => [e.kind, e.at]), [['daily', DAILY_MS], ['daily', 2 * DAILY_MS]]);
});

check('recovery after 10 minutes at or above 12 V, then re-arms', () => {
  const up = feed(steady(0, 12 * MIN, 20000, 12.4), alertingAt(11.5));
  assert.deepStrictEqual(up.emails, [{ kind: 'recovered', v: 12.4, at: HOLD_MS }]);
  assert.deepStrictEqual(up.state, INITIAL_STATE);
  const down = feed(steady(13 * MIN, 25 * MIN, 20000, 11.7), up.state);
  assert.deepStrictEqual(down.emails, [{ kind: 'low', v: 11.7, at: 23 * MIN }]);
});

check('replayed rows are ignored', () => {
  const at = 100 * MIN;
  const old = stepBattery(null, { v: 11.0, tsMs: at - 6 * MIN }, at);
  assert.strictEqual(old.changed, false);
  assert.strictEqual(old.email, null);
  const recent = stepBattery(null, { v: 11.0, tsMs: at - 4 * MIN }, at);
  assert.strictEqual(recent.changed, true);
  assert.strictEqual(recent.state.runKind, 'low');
});

check('a unit clock running ahead still counts', () => {
  const at = 100 * MIN;
  const res = stepBattery(null, { v: 11.0, tsMs: at + 3600000 }, at);
  assert.strictEqual(res.changed, true);
  assert.strictEqual(res.state.runSinceMs, at, 'durations run on arrival time');
});

check('missing or non-numeric batt_v changes nothing', () => {
  for (const init of [null, alertingAt(11.5)]) {
    for (const v of [undefined, null, NaN, 'abc']) {
      const res = stepBattery(init, { v, tsMs: 0 }, 0);
      assert.strictEqual(res.changed, false, `v=${String(v)}`);
      assert.strictEqual(res.email, null, `v=${String(v)}`);
    }
  }
});

check('unchanged state reports changed=false', () => {
  const res = stepBattery(null, { v: 12.6, tsMs: 0 }, 0);
  assert.strictEqual(res.changed, false);
  assert.strictEqual(res.email, null);
});

check('the Oct 17-27 bench sequence', () => {
  const T0 = Date.UTC(2026, 9, 17, 11);
  const plateaus = [
    [T0, 11.67],
    [Date.UTC(2026, 9, 18, 11), 11.5],
    [Date.UTC(2026, 9, 25, 7), 9.31],
    [Date.UTC(2026, 9, 26, 11), 7.25],
    [Date.UTC(2026, 9, 26, 23), 5.3],
    [Date.UTC(2026, 9, 27, 5, 20), 3.35],
  ];
  const glitch = Date.UTC(2026, 9, 27, 5, 25);
  const end = Date.UTC(2026, 9, 27, 6, 27);
  const readings = [];
  for (let at = T0; at <= end; at += MIN) {
    const v = at === glitch ? 0.0 : plateaus.filter(([from]) => from <= at).pop()[1];
    readings.push({ at, v });
  }
  const { emails } = feed(readings);
  assert.deepStrictEqual(emails.map((e) => e.kind),
    ['low', 'daily', 'daily', 'daily', 'daily', 'daily', 'daily', 'daily',
      'lower', 'daily', 'lower', 'lower', 'lower']);
  assert.deepStrictEqual(emails.filter((e) => e.kind === 'lower').map((e) => e.v), [9.31, 7.25, 5.3, 3.35]);
});

check('batteryEmail subjects', () => {
  const now = Date.UTC(2026, 9, 25, 6, 42);
  const subject = (kind, v) => batteryEmail(kind, 'TRUCK-001', v, now, 'https://dash.example').subject;
  assert.strictEqual(subject('low', 11.42), '[EcoFleet] Low battery — TRUCK-001: 11.42 V');
  assert.strictEqual(subject('lower', 9.31), '[EcoFleet] Battery still falling — TRUCK-001: 9.31 V');
  assert.strictEqual(subject('daily', 11.4), '[EcoFleet] Battery still low — TRUCK-001: 11.40 V');
  assert.strictEqual(subject('recovered', 12.48), '[EcoFleet] Battery recovered — TRUCK-001: 12.48 V');
});

check('batteryEmail text: unit, reading, Central time, unit link', () => {
  const { text } = batteryEmail('low', 'TRUCK-001', 11.42, Date.UTC(2026, 9, 25, 6, 42), 'https://dash.example');
  assert.ok(text.includes('Unit     : TRUCK-001'), text);
  assert.ok(text.includes('Battery  : 11.42 V'), text);
  assert.ok(text.includes('Time     : Oct 25, 2026, 1:42 AM CDT'), text);
  assert.ok(text.includes('https://dash.example/units/TRUCK-001'), text);
});

if (failed) { console.error(`battery-alert.test.js: ${failed} failed`); process.exit(1); }
console.log('battery-alert.test.js: all checks passed');
