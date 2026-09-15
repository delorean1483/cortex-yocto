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
  for (const a of ['heater','setpoint','apu','diag','ota','apu_ota','users'])
    assert.strictEqual(canWrite('admin', a), true, a);
});
check('eu is read-only', () => {
  for (const a of ['heater','setpoint','apu','diag','ota','apu_ota','users'])
    assert.strictEqual(canWrite('eu', a), false, a);
});
check('maint: heater/setpoint/diag yes, apu/ota/apu_ota no', () => {
  assert.strictEqual(canWrite('maint', 'heater'), true);
  assert.strictEqual(canWrite('maint', 'diag'), true);
  assert.strictEqual(canWrite('maint', 'apu'), false);
  assert.strictEqual(canWrite('maint', 'ota'), false);
  assert.strictEqual(canWrite('maint', 'apu_ota'), false);
});
check('fm/admin can apu_ota, maint/eu cannot', () => {
  assert.strictEqual(canWrite('fm', 'apu_ota'), true);
  assert.strictEqual(canWrite('admin', 'apu_ota'), true);
  assert.strictEqual(canWrite('maint', 'apu_ota'), false);
  assert.strictEqual(canWrite('eu', 'apu_ota'), false);
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
check('apu climate valid, requires apu action', () => {
  const r = validateCommand({ apu_command: 'climate' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(commandActions(r.desired), ['apu']);
});
check('apu battery valid', () => {
  assert.strictEqual(validateCommand({ apu_command: 'battery' }).ok, true);
});
check('apu stop valid', () => {
  assert.strictEqual(validateCommand({ apu_command: 'stop' }).ok, true);
});
check('legacy apu_command "start" rejected at API', () => {
  assert.strictEqual(validateCommand({ apu_command: 'start' }).ok, false);
});
check('bad apu_command rejected', () => {
  assert.strictEqual(validateCommand({ apu_command: 'explode' }).ok, false);
});
check('ota firmware_target valid', () => {
  const r = validateCommand({ firmware_target: '1.2.41' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(commandActions(r.desired), ['ota']);
});
check('apu_firmware_target NOT yet wired (scope Phase 2 — trigger inert)', () => {
  // apu_ota exists in the matrix, but no command maps to it yet: an
  // apu_firmware_target-only body is an unrecognized field and is rejected,
  // so the APU flash trigger cannot fire server-side until Phase 2 wires it.
  const r = validateCommand({ apu_firmware_target: '1.1.1' });
  assert.strictEqual(r.ok, false);
});
check('empty command rejected', () => {
  assert.strictEqual(validateCommand({}).ok, false);
});

// --- authorizeCommand (Task 5) ---
const { authorizeCommand } = require('./permissions');
check('maint denied apu command', () => {
  const r = authorizeCommand('maint', { apu_command: 'climate' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /not permitted/);
});
check('fm allowed heater command', () => {
  assert.strictEqual(authorizeCommand('fm', { heater: { on: 1 } }).ok, true);
});

// --- configActions / authorizeConfig (role-gate POST /fleet/config) ---
const { configActions, authorizeConfig } = require('./permissions');
check('firmware_target + reboot require ota', () => {
  assert.deepStrictEqual(configActions({ firmware_target: '1.2.41' }), ['ota']);
  assert.deepStrictEqual(configActions({ reboot: true }), ['ota']);
});
check('setpoints require setpoint', () => {
  assert.deepStrictEqual(configActions({ clmt_setpoint_f: 72 }), ['setpoint']);
  assert.deepStrictEqual(configActions({ batt_setpoint_v: 12.8 }), ['setpoint']);
});
check('poll_interval_s + report_mode require config', () => {
  assert.deepStrictEqual(configActions({ poll_interval_s: 10 }), ['config']);
  assert.deepStrictEqual(configActions({ report_mode: 'eco' }), ['config']);
});
check('eu denied any config write (read-only)', () => {
  assert.strictEqual(authorizeConfig('eu', { poll_interval_s: 10 }).ok, false);
});
check('maint denied reboot/ota via config', () => {
  assert.strictEqual(authorizeConfig('maint', { reboot: true }).ok, false);
  assert.strictEqual(authorizeConfig('maint', { firmware_target: '1.2.41' }).ok, false);
});
check('maint allowed setpoint + cadence config', () => {
  assert.strictEqual(authorizeConfig('maint', { poll_interval_s: 10, clmt_setpoint_f: 70 }).ok, true);
});
check('admin allowed reboot; fm allowed firmware_target', () => {
  assert.strictEqual(authorizeConfig('admin', { reboot: true }).ok, true);
  assert.strictEqual(authorizeConfig('fm', { firmware_target: '1.2.41' }).ok, true);
});
check('config with mixed keys needs every implied action', () => {
  // maint has setpoint+config but not ota -> a bundle touching ota is denied
  assert.strictEqual(authorizeConfig('maint', { poll_interval_s: 10, firmware_target: '1.2.41' }).ok, false);
});

console.log(`\n${25 - failed}/25 checks passed`);
process.exit(failed === 0 ? 0 : 1);
