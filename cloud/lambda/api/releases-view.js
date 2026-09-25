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

// First cortex image whose agent carries out each remote reboot only once
// (reboot-loop guard). Older agents reboot again on every start because
// desired.reboot is only cleared in a report that never goes out before the
// cold reset, so a remote reboot is refused for them (and for unversioned
// branch builds).
const REBOOT_MIN_FW = '1.2.62';
function supportsRemoteReboot(firmwareVersion) {
  return parseVersion(firmwareVersion) !== null && cmpVersion(firmwareVersion, REBOOT_MIN_FW) >= 0;
}

module.exports = { parseReleases, parseVersion, cmpVersion, supportsRemoteReboot, REBOOT_MIN_FW };
