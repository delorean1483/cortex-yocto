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
check('excludes prerelease-suffixed builds from the operator dropdown', () => {
  // Convention: diagnostic / validation / release-candidate builds tag as
  // vX.Y.Z-<suffix>. They still publish to releases/ (so they stay
  // shadow-target-OTA-able to the bench), but the strict N.N.N filter keeps
  // them OUT of the operator "Push version" list + latest. Regression guard so
  // a future parseVersion refactor can't silently reopen the v1.2.54/55-style
  // pollution (those were tagged as CLEAN v1.2.54/55 by mistake, hence visible).
  const r = parseReleases([
    'releases/1.2.56/', 'releases/1.2.55-diag/', 'releases/1.2.54-validate/', 'releases/1.3.0-rc.1/',
  ]);
  assert.deepStrictEqual(r.releases, ['1.2.56']);
  assert.strictEqual(r.latest, '1.2.56');
});

console.log(`\n${5 - failed}/5 checks passed`);
process.exit(failed === 0 ? 0 : 1);
