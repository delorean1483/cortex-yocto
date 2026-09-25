/* location.h — the unit's dashboard-assigned location (Fleet map).
 *
 * The API mirrors an assigned location into shadow desired.location as
 * {"assigned":true,"lat":..,"lon":..,"label":".."} and a cleared one as
 * {"assigned":false} (deleting a desired key never produces a delta, so a
 * clear must be an explicit value). gobi-agent stores it at
 * LOCATION_JSON_PATH; weather-fetch prefers it over IP geolocation, so the
 * forecast and the unit's time zone follow the location an admin assigned.
 */
#pragma once

#include <cjson/cJSON.h>

#ifndef LOCATION_JSON_PATH
#define LOCATION_JSON_PATH "/var/lib/ecofleet/location.json"
#endif

typedef struct {
    double lat;          /* -90..90   */
    double lon;          /* -180..180 */
    char   label[61];    /* printable, <= 60 chars, "" if none */
} unit_location_t;

/* desired.location -> 1 assigned (out filled), 0 explicitly cleared,
 * -1 invalid/absent (caller ignores it). Control characters in the label
 * become spaces; long labels are truncated. Pure. */
int location_from_desired(const cJSON *obj, unit_location_t *out);

/* File form {"lat":..,"lon":..,"label":".."}. to_json returns a malloc'd
 * string (caller frees) or NULL; from_json returns 1 if valid, else 0. Pure. */
char *location_to_json(const unit_location_t *l);
int   location_from_json(const char *json, unit_location_t *out);

/* I/O. store: write l atomically (or remove the file when l is NULL) only if
 * that changes the stored value; returns 1 changed, 0 unchanged, -1 error.
 * load: 1 if a valid file was read into out, else 0. */
int location_store(const char *path, const unit_location_t *l);
int location_load(const char *path, unit_location_t *out);
