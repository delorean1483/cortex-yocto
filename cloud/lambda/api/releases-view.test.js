'use strict';
// Run: node cloud/lambda/api/releases-view.test.js
const assert = require('node:assert');
const { parseReleases, cmpVersion } = require('./releases-view');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

check('sorts versions newest-first + picks latest', () => {
  const r = parseReleases(['releases/1.2.9/', 'releases/1.2.40/', 'releases/1.2.10/', 'releases/1.2.26/']);
  assert.deepStrictEqual(r.releases, ['1.2.40', '1.2.26', '1.2.10', '1.2.9']);
  assert.strictEqual(r.latest, '1.2.40');
});
check('numeric (not lexical) ordering: 1.2.40 > 1.2.9', () => {
  assert.ok(cmpVersion('1.2.40', '1.2.9') > 0);
});
check('ignores non-semver prefixes', () => {
  const r = parseReleases(['releases/1.2.40/', 'releases/latest/', 'releases/junk', 'releases/']);
  assert.deepStrictEqual(r.releases, ['1.2.40']);
});
check('empty input -> null latest', () => {
  const r = parseReleases([]);
  assert.deepStrictEqual(r.releases, []);
  assert.strictEqual(r.latest, null);
});

console.log(`\n${4 - failed}/4 checks passed`);
process.exit(failed === 0 ? 0 : 1);
