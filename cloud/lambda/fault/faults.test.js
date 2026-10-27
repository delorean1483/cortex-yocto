'use strict';

// Regression tests for the fault-word decoder. Run: node faults.test.js
// Excluded from the Lambda deploy zip by deploy-lambda.sh (--exclude "*.test.js").
//
// Guards against the decimal-key masking bug: FAULT_BITS keys stringify to
// decimal, so any bit >= 0x10 must be masked with Number(bit), not
// parseInt(bit, 16). Bit values mirror the Gobi APU REG_FAULT word (config.h).

const assert = require('node:assert');
const { describeFault, faultEmail } = require('./faults.js');

const cases = [
  ['0x0000', 'No fault'],
  ['0x0001', 'Low oil pressure'],
  ['0x0004', 'Low battery voltage'],                       // must NOT pick up 0x10/0x40
  ['0x0010', 'Overcurrent'],                               // was mis-decoded pre-fix
  ['0x0080', 'Starter failure'],                           // was "Unknown fault" pre-fix
  ['0x0014', 'Low battery voltage, Overcurrent'],          // multi-bit
  ['0x00FF', 'Low oil pressure, High coolant temperature, Low battery voltage, '
           + 'Modbus communication failure, Overcurrent, Low fuel, '
           + 'Engine overspeed, Starter failure'],         // all bits
  ['0x0100', 'Unknown fault (0x0100)'],                    // undefined bit
];

let failed = 0;
for (const [input, expected] of cases) {
  try {
    assert.strictEqual(describeFault(input), expected);
    console.log(`  [PASS] ${input} -> ${expected}`);
  } catch (e) {
    failed++;
    console.error(`  [FAIL] ${input}\n         expected: ${expected}`
      + `\n         actual:   ${describeFault(input)}`);
  }
}

// faultEmail: the subject and body fault emails have always had, now built in
// one place so the per-person mailer sends exactly the same text.
const TS = Date.UTC(2026, 9, 25, 6, 42);
const emailChecks = [
  ['fault email subject and body', () => {
    const { subject, text } = faultEmail('TRUCK-001', '0x0004', 'running', TS);
    assert.strictEqual(subject, '[EcoFleet] Fault — TRUCK-001: Low battery voltage');
    assert.strictEqual(text, [
      'Unit     : TRUCK-001',
      'Fault    : 0x0004  (Low battery voltage)',
      'APU state: running',
      'Time     : 2026-10-25T06:42:00.000Z',
    ].join('\n'));
  }],
  ['fault-cleared email subject and status line', () => {
    const { subject, text } = faultEmail('TRUCK-001', '0x0000', 'off', TS);
    assert.strictEqual(subject, '[EcoFleet] Recovered — TRUCK-001: APU fault cleared');
    assert.ok(text.includes('Status   : fault cleared (0x0000)'), text);
  }],
];
for (const [name, fn] of emailChecks) {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
}

const total = cases.length + emailChecks.length;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed === 0 ? 0 : 1);
