'use strict';
// Run: node cloud/lambda/fault/fault-alert.test.js
// Excluded from the Lambda deploy zip by deploy-lambda.sh (--exclude "*.test.js").
const assert = require('node:assert');
const {
  parseFault, faultFields, alertKind, faultEmail, handleFault, STANDBY,
} = require('./fault-alert');

const URL = 'https://dash.example';
const TS = Date.UTC(2026, 9, 25, 6, 42);   // Oct 25, 2026, 1:42 AM CDT
const MIN = 60 * 1000;

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

// What gobi-agent publishes on ecofleet/<serial>/faults (cloud/CONTRACT.md §2).
const ERROR_LABEL = { 0: 'none', 1: 'low_oil', 2: 'high_engine_temp', 3: 'low_battery', 7: 'standby' };
const msg = (error_n, ts = TS, status = 'off') =>
  ({ unit: 'TRUCK-001', ts, error: ERROR_LABEL[error_n] || 'unknown', error_n, status });
const ev = (code, tsMs = TS) => parseFault(msg(code, tsMs), 0);
const prev = (code, tsMs = TS - MIN) => ({ code, tsMs });

// The faults bucket for one unit, newest-at-or-before lookups like the Flux query.
function memoryIo() {
  const records = [];
  const sent = [];
  const calls = [];
  return {
    records, sent, calls,
    io: {
      lastFault: async (unit, tsMs) => {
        calls.push('lastFault');
        const older = records.filter((r) => r.unit === unit && r.tsMs <= tsMs)
          .sort((a, b) => b.tsMs - a.tsMs);
        return older.length ? { code: older[0].fields.error_n, tsMs: older[0].tsMs } : null;
      },
      writeFault: async (unit, tsMs, fields) => {
        calls.push('writeFault');
        records.push({ unit, tsMs, fields });
      },
      sendAlert: async (m) => { calls.push('sendAlert'); sent.push(m); },
    },
  };
}

(async () => {
  // ── parseFault ──────────────────────────────────────────────────────────────
  await check('reads the agent message', () => {
    assert.deepStrictEqual(parseFault(msg(1), 0),
      { unit: 'TRUCK-001', tsMs: TS, code: 1, error: 'low_oil', status: 'off' });
  });

  await check('a message without ts takes the arrival time', () => {
    const { ts, ...noTs } = msg(1);
    assert.strictEqual(parseFault(noTs, 1234).tsMs, 1234);
  });

  await check('drops messages without a unit or an integer error_n', () => {
    assert.strictEqual(parseFault({ ...msg(1), unit: '' }, 0), null);
    assert.strictEqual(parseFault({ unit: 'TRUCK-001', ts: TS, error: 'low_oil' }, 0), null);
    assert.strictEqual(parseFault({ ...msg(1), error_n: '1' }, 0), null);
    assert.strictEqual(parseFault({ ...msg(1), error_n: 1.5 }, 0), null);
    assert.strictEqual(parseFault({ ...msg(1), error_n: -1 }, 0), null);
    assert.strictEqual(parseFault({ unit: 'TRUCK-001', ts: TS, fault: '0x0004', state: 'idle' }, 0), null);
    assert.strictEqual(parseFault(null, 0), null);
  });

  // ── faultFields (the InfluxDB record the Alerts page and History tab read) ──
  await check('an active fault record', () => {
    assert.deepStrictEqual(faultFields(ev(1)), {
      fault: '0x0001', error: 'low_oil', error_n: 1, description: 'Low oil pressure',
      state: 'active', status: 'off', active: true,
    });
  });

  await check('no-fault and standby records are not active faults', () => {
    assert.deepStrictEqual(faultFields(ev(0)), {
      fault: '0x0000', error: 'none', error_n: 0, description: 'No fault',
      state: 'cleared', status: 'off', active: false,
    });
    const standby = faultFields(ev(STANDBY));
    assert.strictEqual(standby.description, 'Standby (truck engine on)');
    assert.strictEqual(standby.state, 'standby');
    assert.strictEqual(standby.active, false);
  });

  await check('a code the cloud does not know is still an active fault', () => {
    const f = faultFields(ev(12));
    assert.strictEqual(f.fault, '0x000C');
    assert.strictEqual(f.description, 'Unknown fault (code 12)');
    assert.strictEqual(f.active, true);
  });

  // ── alertKind ───────────────────────────────────────────────────────────────
  await check('alertKind: which changes email', () => {
    const table = [
      ['first fault ever',              null,       1, 'fault'],
      ['fault after no fault',          prev(0),    1, 'fault'],
      ['fault after standby',           prev(7),    1, 'fault'],
      ['a different fault',             prev(1),    2, 'fault'],
      ['same fault again (agent restart)', prev(1), 1, null],
      ['fault cleared',                 prev(1),    0, 'cleared'],
      ['fault replaced by standby',     prev(1),    7, 'cleared'],
      ['truck engine on',               prev(0),    7, null],
      ['truck engine off',              prev(7),    0, null],
      ['first message, no fault',       null,       0, null],
      ['redelivered fault',             prev(1, TS), 1, null],
    ];
    for (const [name, p, code, want] of table) {
      assert.strictEqual(alertKind(p, ev(code)), want, name);
    }
  });

  // ── faultEmail ──────────────────────────────────────────────────────────────
  await check('fault email', () => {
    const { subject, text } = faultEmail('fault', ev(1), null, URL);
    assert.strictEqual(subject, '[EcoFleet] Fault — TRUCK-001: Low oil pressure');
    assert.strictEqual(text, [
      'Unit     : TRUCK-001',
      'Fault    : Low oil pressure',
      'APU      : Off',
      'Time     : Oct 25, 2026, 1:42 AM CDT',
      '',
      'https://dash.example/units/TRUCK-001',
    ].join('\n'));
  });

  await check('cleared email names the fault that cleared and what the unit says now', () => {
    const { subject, text } = faultEmail('cleared', ev(STANDBY), prev(1), URL);
    assert.strictEqual(subject, '[EcoFleet] Recovered — TRUCK-001: Low oil pressure cleared');
    assert.strictEqual(text, [
      'Unit     : TRUCK-001',
      'Cleared  : Low oil pressure',
      'Now      : Standby (truck engine on)',
      'APU      : Off',
      'Time     : Oct 25, 2026, 1:42 AM CDT',
      '',
      'https://dash.example/units/TRUCK-001',
    ].join('\n'));
  });

  await check('APU status reads like the panel; unknown values pass through', () => {
    assert.ok(faultEmail('fault', parseFault(msg(1, TS, 'chillin'), 0), null, URL).text.includes('APU      : At target'));
    assert.ok(faultEmail('fault', parseFault(msg(1, TS, 'warming_up'), 0), null, URL).text.includes('APU      : Warming up'));
    assert.ok(faultEmail('fault', parseFault(msg(1, TS, 'mystery'), 0), null, URL).text.includes('APU      : mystery'));
  });

  // ── handleFault ─────────────────────────────────────────────────────────────
  await check('looks up the previous record before writing, then emails', async () => {
    const { io, records, sent, calls } = memoryIo();
    const res = await handleFault(msg(1), io, URL, 0);
    assert.deepStrictEqual(calls, ['lastFault', 'writeFault', 'sendAlert']);
    assert.deepStrictEqual(records, [{ unit: 'TRUCK-001', tsMs: TS, fields: faultFields(ev(1)) }]);
    assert.deepStrictEqual(sent, [faultEmail('fault', ev(1), null, URL)]);
    assert.deepStrictEqual(res, { email: 'fault' });
  });

  await check('a day of driving and one low-oil shutdown sends two emails', async () => {
    const { io, records, sent } = memoryIo();
    const day = [7, 0, 7, 0, 1, 7, 0, 7, 0];   // standby = truck engine on
    for (const [i, code] of day.entries()) await handleFault(msg(code, TS + i * MIN), io, URL, 0);
    assert.strictEqual(records.length, day.length);
    assert.deepStrictEqual(sent.map((m) => m.subject), [
      '[EcoFleet] Fault — TRUCK-001: Low oil pressure',
      '[EcoFleet] Recovered — TRUCK-001: Low oil pressure cleared',
    ]);
  });

  await check('a redelivered message is written again but not emailed again', async () => {
    const { io, records, sent } = memoryIo();
    await handleFault(msg(1), io, URL, 0);
    const res = await handleFault(msg(1), io, URL, 0);
    assert.strictEqual(records.length, 2);
    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(res, { email: null });
  });

  await check('a malformed message touches nothing', async () => {
    const { io, calls } = memoryIo();
    const res = await handleFault({ unit: 'TRUCK-001', fault: '0x0004' }, io, URL, 0);
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(res, { dropped: true });
  });

  await check('an email failure keeps the record and does not throw', async () => {
    const { io, records } = memoryIo();
    io.sendAlert = async () => { throw new Error('SNS down'); };
    const res = await handleFault(msg(1), io, URL, 0);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(res.email, 'fault');
    assert.ok(res.error.includes('SNS down'), res.error);
  });

  await check('a lookup or write failure throws, so the Lambda retries before any email', async () => {
    for (const broken of ['lastFault', 'writeFault']) {
      const { io, sent } = memoryIo();
      io[broken] = async () => { throw new Error(`${broken} down`); };
      await assert.rejects(handleFault(msg(1), io, URL, 0), new RegExp(`${broken} down`));
      assert.strictEqual(sent.length, 0, broken);
    }
  });

  if (failed) { console.error(`fault-alert.test.js: ${failed} failed`); process.exit(1); }
  console.log('fault-alert.test.js: all checks passed');
})();
