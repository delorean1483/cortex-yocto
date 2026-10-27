'use strict';
// Run: node cloud/lambda/api/me-alerts.test.js
const assert = require('node:assert');
const { parseAlertsBody } = require('./me-alerts');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('accepts a boolean email_alerts', () => {
  assert.deepStrictEqual(parseAlertsBody('{"email_alerts":true}'), { email_alerts: true });
  assert.deepStrictEqual(parseAlertsBody('{"email_alerts":false}'), { email_alerts: false });
});

check('rejects anything that is not a boolean email_alerts', () => {
  for (const body of ['{"email_alerts":"true"}', '{"email_alerts":1}', '{}', 'not json', undefined, 'null']) {
    const res = parseAlertsBody(body);
    assert.strictEqual(typeof res.error, 'string', `body ${body}`);
    assert.ok(!('email_alerts' in res), `body ${body}`);
  }
});

check('ignores every other key: the handler never takes an email from the body', () => {
  assert.deepStrictEqual(parseAlertsBody('{"email_alerts":true,"email":"other@x"}'), { email_alerts: true });
});

if (failed) { console.error(`me-alerts.test.js: ${failed} failed`); process.exit(1); }
console.log('me-alerts.test.js: all checks passed');
