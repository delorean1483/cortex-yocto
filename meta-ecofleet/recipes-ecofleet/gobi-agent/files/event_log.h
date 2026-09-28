/* event_log.h — on-device APU fault history for the panel's Error Log.
 *
 * Each APU fault becomes one event: when it started, when it cleared (0 while
 * still active) and the conditions when it started. Newest first, capped at
 * EVENT_LOG_MAX. Stored as JSON on the slot-shared /data partition so the
 * history survives A/B updates (falls back to /var/lib/ecofleet).
 */
#pragma once

#include <stddef.h>

#define EVENT_LOG_MAX 200

#ifndef EVENT_LOG_PATH
#define EVENT_LOG_PATH          "/data/ecofleet/events.json"
#endif
#ifndef EVENT_LOG_FALLBACK_PATH
#define EVENT_LOG_FALLBACK_PATH "/var/lib/ecofleet/events.json"
#endif

typedef struct {
    char   error[32];           /* fault name, e.g. "low_oil" ("" if unknown) */
    char   mode[16];            /* off | climate | battery */
    char   control_status[16];
    char   engine_status[16];
    int    rpm;
    double batt_v;
    double cabin_temp_f;
    double coolant_temp_f;
} event_snapshot_t;

typedef struct {
    int              code;      /* APU error code (control_error_t), never 0 */
    long long        start_ms;  /* epoch ms */
    long long        end_ms;    /* epoch ms when cleared, 0 while active */
    event_snapshot_t snap;      /* conditions when it started */
} event_t;

typedef struct {
    event_t ev[EVENT_LOG_MAX];  /* ev[0] = newest */
    int     count;
} event_log_t;

void event_log_init(event_log_t *log);

/* Apply one reading's error transition prev -> cur. Closes the active event
 * when a fault clears or changes, opens a new one (with snap) when a fault
 * starts. Returns 1 if the log changed (caller saves), else 0. Pure. */
int event_log_on_error(event_log_t *log, int prev, int cur, long long now_ms,
                       const event_snapshot_t *snap);

/* Code of the still-active (newest, unclosed) event, or 0. Pure. */
int event_log_active_code(const event_log_t *log);

/* Load (1 = read a valid file; 0 = missing/corrupt, log left empty) and save
 * atomically (0 ok, -1 error). */
int event_log_load(const char *path, event_log_t *log);
int event_log_save(const char *path, const event_log_t *log);
