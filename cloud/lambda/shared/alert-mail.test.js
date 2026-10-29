'use strict';
// Run: node cloud/lambda/shared/alert-mail.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  recipientsFrom, withFooter, sendAlert, sesEmailInput, centralTime, ALERT_FAILED,
} = require('./alert-mail');

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

// The console.error lines logged while fn runs.
async function errorsDuring(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.error = original; }
  return lines;
}

// Records every call; `reject` lists addresses whose sendEmail fails.
function fakeIo(users = [], reject = []) {
  const calls = { scanUsers: 0, sendEmail: [], publish: [] };
  return {
    calls,
    io: {
      scanUsers: async () => { calls.scanUsers++; return users; },
      sendEmail: async (m) => {
        calls.sendEmail.push(m);
        if (reject.includes(m.to)) throw new Error('MessageRejected');
      },
      publish: async (m) => { calls.publish.push(m); },
    },
  };
}

const CFG = { alertFrom: 'EcoFleet Alerts <alerts@goecofleet.com>', dashboardUrl: 'https://d' };
const optedIn = (email) => ({ email, email_alerts: true });

(async () => {
  await check('recipientsFrom keeps only opted-in people', () => {
    assert.deepStrictEqual(recipientsFrom([
      optedIn('a@x'), { email: 'b@x', email_alerts: false }, { email: 'c@x' },
      { email: '', email_alerts: true }, optedIn('a@x'),
    ]), ['a@x']);
  });

  await check('empty alertFrom publishes once to SNS with the text unchanged', async () => {
    const { io, calls } = fakeIo([optedIn('a@x')]);
    const res = await sendAlert({ subject: 'S', text: 'T' }, io, { ...CFG, alertFrom: '' });
    assert.deepStrictEqual(calls.publish, [{ subject: 'S', text: 'T' }]);
    assert.strictEqual(calls.scanUsers, 0);
    assert.deepStrictEqual(calls.sendEmail, []);
    assert.deepStrictEqual(res, { via: 'sns', sent: 1, failed: [] });
  });

  await check('with alertFrom, one email per opted-in person, with the footer', async () => {
    const { io, calls } = fakeIo([optedIn('b@x'), optedIn('a@x')]);
    const res = await sendAlert({ subject: 'S', text: 'T' }, io, CFG);
    assert.deepStrictEqual(calls.sendEmail, [
      { from: CFG.alertFrom, to: 'a@x', subject: 'S', text: withFooter('T', 'https://d') },
      { from: CFG.alertFrom, to: 'b@x', subject: 'S', text: withFooter('T', 'https://d') },
    ]);
    assert.deepStrictEqual(calls.publish, []);
    assert.deepStrictEqual(res, { via: 'ses', sent: 2, failed: [] });
  });

  await check('one rejected address does not stop the others', async () => {
    const { io, calls } = fakeIo([optedIn('bad@x'), optedIn('good@x')], ['bad@x']);
    let res;
    const errors = await errorsDuring(async () => { res = await sendAlert({ subject: 'S', text: 'T' }, io, CFG); });
    assert.strictEqual(calls.sendEmail.length, 2);
    assert.deepStrictEqual(res, { via: 'ses', sent: 1, failed: ['bad@x'] });
    assert.deepStrictEqual(errors, ['ALERT EMAIL FAILED: to bad@x: MessageRejected']);
  });

  // terraform/monitoring.tf counts log lines carrying this tag and alarms on
  // any; if the two drift apart the alarm silently stops firing.
  await check('the CloudWatch metric filter counts the same tag the code logs', () => {
    assert.strictEqual(ALERT_FAILED, 'ALERT EMAIL FAILED');
    const tf = fs.readFileSync(path.join(__dirname, '../../terraform/monitoring.tf'), 'utf8');
    const marker = tf.match(/alert_failed_marker\s*=\s*"([^"]*)"/);
    assert.ok(marker, 'alert_failed_marker not found in monitoring.tf');
    assert.strictEqual(marker[1], ALERT_FAILED);
    assert.match(tf, /pattern\s*=\s*"\\"\$\{local\.alert_failed_marker\}\\""/);
  });

  await check('nobody opted in sends nothing', async () => {
    const { io, calls } = fakeIo([{ email: 'a@x', email_alerts: false }]);
    const res = await sendAlert({ subject: 'S', text: 'T' }, io, CFG);
    assert.deepStrictEqual(calls.sendEmail, []);
    assert.deepStrictEqual(res, { via: 'ses', sent: 0, failed: [] });
  });

  await check('withFooter says why and how to turn alerts off', () => {
    assert.strictEqual(withFooter('T', 'https://d'),
      'T\n\n—\nYou get this because you turned on email alerts in EcoFleet.\nTurn them off: https://d');
  });

  // Every subject and footer has "—" (U+2014). SES assumes 7-bit ASCII unless a
  // charset is given, so without UTF-8 the per-person emails arrive garbled.
  await check('the SES request marks subject and body as UTF-8', () => {
    assert.deepStrictEqual(
      sesEmailInput({ from: CFG.alertFrom, to: 'a@x', subject: '[EcoFleet] Low battery — U: 11.42 V', text: 'T —' }),
      {
        FromEmailAddress: CFG.alertFrom,
        Destination: { ToAddresses: ['a@x'] },
        Content: { Simple: {
          Subject: { Data: '[EcoFleet] Low battery — U: 11.42 V', Charset: 'UTF-8' },
          Body: { Text: { Data: 'T —', Charset: 'UTF-8' } },
        } },
      });
  });

  await check('centralTime: US Central with the zone, plain space before AM/PM', () => {
    assert.strictEqual(centralTime(Date.UTC(2026, 9, 25, 6, 42)), 'Oct 25, 2026, 1:42 AM CDT');
    assert.strictEqual(centralTime(Date.UTC(2026, 11, 1, 18, 5)), 'Dec 1, 2026, 12:05 PM CST');
  });

  if (failed) { console.error(`alert-mail.test.js: ${failed} failed`); process.exit(1); }
  console.log('alert-mail.test.js: all checks passed');
})();
