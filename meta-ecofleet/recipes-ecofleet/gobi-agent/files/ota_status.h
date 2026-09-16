/* ota_status.h — pure aging policy for the OTA status the dashboard sees.
 *
 * The root worker (gobi-ota-apply) writes a one-line status to
 * /var/lib/ecofleet/ota/status ("downloading <v>", "installing <v>",
 * "success <v>", "failed: <reason>") and the agent mirrors it into the shadow
 * as reported.ota_status every cycle. On a successful OTA the board reboots and
 * the new slot has no status file, so it reads back idle — but a FAILED OTA
 * leaves the "failed:" line in place forever, so the dashboard shows a stale
 * red pill until the next OTA overwrites it.
 *
 * This helper adds a time-to-live keyed off how long ago the status file was
 * written: while an OTA is active the worker keeps rewriting the file (fresh
 * mtime), so it never expires; once the worker is done (or has crashed) the
 * line ages out and the agent reports idle instead. No I/O here — main.c
 * supplies the file's age — so the policy is unit-tested on the host (see
 * ../tests/test_ota_status.c).
 */
#pragma once

/* Given the raw status line from the worker and how many seconds ago the
 * status file was last modified, return what to report to the shadow:
 *   - "idle" if raw is NULL, empty, or already "idle"
 *   - "idle" if age_s is strictly greater than ttl_s (aged out)
 *   - raw otherwise (still fresh)
 * A negative age_s (mtime in the future, e.g. clock skew) counts as fresh. */
const char *ota_status_effective(const char *raw, long age_s, long ttl_s);
