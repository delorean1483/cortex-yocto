/* weather.h — pure forecast transforms for the gobi weather-fetch service.
 *
 * These functions have no I/O: they map Open-Meteo's daily forecast response
 * into the compact weather.json the touchscreen UI consumes. Keeping them pure
 * lets them be unit-tested on the host (see ../tests/test_weather.c).
 */
#pragma once

/* Coarse weather category derived from a WMO weather-interpretation code.
 * Open-Meteo returns ~30 distinct codes; the UI only needs a handful of icons,
 * so the fetcher collapses them here and the QML keys its icon off the slug. */
typedef enum {
    WCAT_UNKNOWN = 0,
    WCAT_CLEAR,
    WCAT_PARTLY,
    WCAT_CLOUDY,
    WCAT_FOG,
    WCAT_RAIN,
    WCAT_SNOW,
    WCAT_STORM,
} weather_cat_t;

/* Map a WMO code (0..99) to a coarse category.
 * Out-of-range or unassigned codes return WCAT_UNKNOWN. */
weather_cat_t wmo_to_category(int wmo_code);

/* Stable lowercase slug for a category: "clear","partly","cloudy","fog",
 * "rain","snow","storm", or "unknown". Never returns NULL. */
const char *weather_cat_slug(weather_cat_t cat);

/* Three-letter weekday abbreviation ("Mon".."Sun") for an ISO date string
 * "YYYY-MM-DD". Returns "?" if the string is not a parseable date.
 * Pure/proleptic-Gregorian (Sakamoto) — no libc time / timezone involvement. */
const char *weekday_abbrev(const char *iso_date);

/* Transform an Open-Meteo /v1/forecast *daily* JSON response into the compact
 * weather.json the UI consumes. Returns a malloc'd, NUL-terminated string the
 * caller must free(), or NULL on parse failure / missing required arrays.
 *
 *   open_meteo_json : raw response body
 *   location_label  : human label embedded as "location" (NULL/"" -> omitted)
 *   fetched_ts_ms   : epoch milliseconds to stamp as "fetched_ts"
 *   max_days        : cap on days emitted (clamped to what the response holds)
 *
 * Output shape:
 *   {"fetched_ts":<ms>,"location":"...","days":[
 *      {"label":"Thu","date":"2026-08-27","hi_f":78,"lo_f":61,
 *       "code":2,"cat":"partly","precip_pct":10}, ... ]}
 */
char *weather_build_json(const char *open_meteo_json,
                         const char *location_label,
                         long long fetched_ts_ms,
                         int max_days);
