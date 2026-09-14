'use strict';

// Pure helpers to turn S3 "releases/<version>/" prefixes into a sorted release
// list. No I/O. A version is valid only if it looks like N.N.N (semver-ish),
// so stray keys never become pushable OTA targets.

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmpVersion(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// commonPrefixes: array of strings like "releases/1.2.40/" (S3 CommonPrefixes
// .Prefix values). Returns { releases: [...desc], latest }.
function parseReleases(commonPrefixes) {
  const versions = (commonPrefixes || [])
    .map((p) => String(p).replace(/^releases\//, '').replace(/\/$/, ''))
    .filter((v) => parseVersion(v) !== null);
  versions.sort((a, b) => cmpVersion(b, a)); // descending (newest first)
  return { releases: versions, latest: versions[0] || null };
}

module.exports = { parseReleases, parseVersion, cmpVersion };
