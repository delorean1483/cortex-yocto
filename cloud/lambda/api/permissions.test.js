'use strict';
// Run: node cloud/lambda/api/permissions.test.js
const assert = require('node:assert');
const { canWrite, validateCommand, commandActions } = require('./permissions');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('admin can do everything', () => {
  for (const a of ['heater','setpoint','apu','diag','ota','users'])
    assert.strictEqual(canWrite('admin', a), true, a);
});
check('eu is read-only', () => {
  for (const a of ['heater','setpoint','apu','diag','ota','users'])
    assert.strictEqual(canWrite('eu', a), false, a);
});
check('maint: heater/setpoint/diag yes, apu/ota no', () => {
  assert.strictEqual(canWrite('maint', 'heater'), true);
  assert.strictEqual(canWrite('maint', 'diag'), true);
  assert.strictEqual(canWrite('maint', 'apu'), false);
  assert.strictEqual(canWrite('maint', 'ota'), false);
});
check('unknown role denied', () => assert.strictEqual(canWrite('nobody', 'heater'), false));

check('valid heater command', () => {
  const r = validateCommand({ heater: { on: 1, level: 3 } });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.desired, { heater: { on: 1, level: 3 } });
  assert.deepStrictEqual(commandActions(r.desired), ['heater']);
});
check('heater level out of range rejected', () => {
  assert.strictEqual(validateCommand({ heater: { on: 1, level: 11 } }).ok, false);
});
check('apu start valid, requires apu action', () => {
  const r = validateCommand({ apu_command: 'start' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(commandActions(r.desired), ['apu']);
});
check('bad apu_command rejected', () => {
  assert.strictEqual(validateCommand({ apu_command: 'explode' }).ok, false);
});
check('ota firmware_target valid', () => {
  const r = validateCommand({ firmware_target: '1.2.41' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(commandActions(r.desired), ['ota']);
});
check('empty command rejected', () => {
  assert.strictEqual(validateCommand({}).ok, false);
});

// --- authorizeCommand (Task 5) ---
const { authorizeCommand } = require('./permissions');
check('maint denied apu command', () => {
  const r = authorizeCommand('maint', { apu_command: 'start' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /not permitted/);
});
check('fm allowed heater command', () => {
  assert.strictEqual(authorizeCommand('fm', { heater: { on: 1 } }).ok, true);
});

console.log(`\n${12 - failed}/12 checks passed`);
process.exit(failed === 0 ? 0 : 1);
