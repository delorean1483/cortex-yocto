'use strict';
// Run: node cloud/lambda/api/link-view.test.js
const assert = require('node:assert');
const { linkView } = require('./link-view');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

const T0 = 1762430000000;

check('APU silent: down, since, heartbeat', () => {
  assert.deepStrictEqual(
    linkView({ apu_link: 'down', apu_link_since: T0, heartbeat_ts: T0 + 25000, dc_v: 12.6 }),
    { apu: 'down', since: T0, heartbeat_ts: T0 + 25000 });
});
check('APU answering: ok', () => {
  assert.deepStrictEqual(
    linkView({ apu_link: 'ok', apu_link_since: T0, heartbeat_ts: T0 }),
    { apu: 'ok', since: T0, heartbeat_ts: T0 });
});
check('older agent (no apu_link key): null', () => {
  assert.strictEqual(linkView({ dc_v: 12.6, last_seen_ts: T0 }), null);
});
check('no shadow / no reported state: null', () => {
  assert.strictEqual(linkView(undefined), null);
  assert.strictEqual(linkView(null), null);
});
check('unknown link value: null, never guessed', () => {
  assert.strictEqual(linkView({ apu_link: 'flaky', heartbeat_ts: T0 }), null);
});
check('missing or junk times read as null', () => {
  assert.deepStrictEqual(linkView({ apu_link: 'down' }), { apu: 'down', since: null, heartbeat_ts: null });
  assert.deepStrictEqual(linkView({ apu_link: 'down', apu_link_since: 'soon', heartbeat_ts: null }),
    { apu: 'down', since: null, heartbeat_ts: null });
});

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('link-view: all passed');
