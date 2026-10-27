'use strict';
// Run: node cloud/lambda/ingest/battery-check.test.js
const assert = require('node:assert');
const { checkBattery } = require('./battery-check');
const { batteryEmail, INITIAL_STATE, HOLD_MS } = require('./battery-alert');

const URL = 'https://dash.example';
const NOW = Date.UTC(2026, 9, 25, 6, 42);

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

// One unit's stored state with the same version check the DynamoDB write uses.
function memoryIo(initial = null) {
  const store = { item: initial && { state: initial, ver: 1 }, saves: 0 };
  const sent = [];
  return {
    store,
    sent,
    io: {
      loadState: async () => store.item && { state: { ...store.item.state }, ver: store.item.ver },
      saveState: async (unit, state, prevVer) => {
        store.saves++;
        if ((store.item ? store.item.ver : null) !== prevVer) return false;
        store.item = { state, ver: (prevVer ?? 0) + 1 };
        return true;
      },
      sendAlert: async (m) => { sent.push(m); },
    },
  };
}

// Not alerting yet, with a 10-minute "under 12 V" run already behind it.
const HELD_LOW = { ...INITIAL_STATE, runKind: 'low', runSinceMs: NOW - HOLD_MS };
const reading = (batt_v) => ({ unit: 'TRUCK-001', batt_v, ts: NOW });

(async () => {
  await check("sends the rule's email after the state write wins", async () => {
    const { io, sent, store } = memoryIo(HELD_LOW);
    const res = await checkBattery(reading(11.8), NOW, io, URL);
    assert.deepStrictEqual(sent, [batteryEmail('low', 'TRUCK-001', 11.8, NOW, URL)]);
    assert.strictEqual(store.item.ver, 2);
    assert.strictEqual(store.item.state.alerting, true);
    assert.deepStrictEqual(res, { email: 'low' });
  });

  await check('no write when the rule reports no change', async () => {
    const { io, sent, store } = memoryIo();
    const res = await checkBattery(reading(12.6), NOW, io, URL);
    assert.strictEqual(store.saves, 0);
    assert.deepStrictEqual(sent, []);
    assert.deepStrictEqual(res, { email: null });
  });

  await check('a lost write sends nothing', async () => {
    const { io, sent } = memoryIo(HELD_LOW);
    io.saveState = async () => false;
    const res = await checkBattery(reading(11.8), NOW, io, URL);
    assert.deepStrictEqual(sent, []);
    assert.deepStrictEqual(res, { email: null });
  });

  await check('two overlapping calls send one email', async () => {
    const { io, sent } = memoryIo(HELD_LOW);
    await Promise.all([
      checkBattery(reading(11.8), NOW, io, URL),
      checkBattery(reading(11.7), NOW, io, URL),
    ]);
    assert.strictEqual(sent.length, 1);
  });

  await check('failures are swallowed', async () => {
    for (const broken of ['loadState', 'saveState', 'sendAlert']) {
      const { io } = memoryIo(HELD_LOW);
      io[broken] = async () => { throw new Error(`${broken} down`); };
      const res = await checkBattery(reading(11.8), NOW, io, URL);
      assert.strictEqual(typeof res.error, 'string', broken);
      assert.ok(res.error.includes(`${broken} down`), res.error);
    }
  });

  if (failed) { console.error(`battery-check.test.js: ${failed} failed`); process.exit(1); }
  console.log('battery-check.test.js: all checks passed');
})();
