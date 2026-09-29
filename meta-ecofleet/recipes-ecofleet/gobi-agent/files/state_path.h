/* state_path.h — where small unit state files live.
 *
 * State that must survive A/B updates (assigned location, time zone) lives on
 * the slot-shared /data partition (ecofleet-data). Units without a working
 * /data keep the per-slot copy under /var/lib/ecofleet, which is also where
 * releases before 1.2.66 kept it — so readers fall back to it right after an
 * update, and writers remove it once the shared copy is in use.
 */
#pragma once

/* Overridable on the compile line so host tests can use /tmp paths. */
#ifndef LOCATION_JSON_SHARED
#define LOCATION_JSON_SHARED "/data/ecofleet/location.json"
#endif
#ifndef LOCATION_JSON_LEGACY
#define LOCATION_JSON_LEGACY "/var/lib/ecofleet/location.json"
#endif
#define TIMEZONE_SHARED      "/data/ecofleet/timezone"
#define TIMEZONE_LEGACY      "/var/lib/ecofleet/timezone"

/* Path to write: shared when its directory is writable, else legacy. Returns
 * one of the two pointers passed in. */
const char *state_write_path(const char *shared, const char *legacy);

/* Path to read: shared if that file exists, else legacy if it exists, else
 * shared. Returns one of the two pointers passed in. */
const char *state_read_path(const char *shared, const char *legacy);

/* After writing `used`: delete the legacy copy unless it is the one in use, so
 * a stale per-slot value can never shadow a later clear on /data. */
void state_retire_legacy(const char *used, const char *legacy);
