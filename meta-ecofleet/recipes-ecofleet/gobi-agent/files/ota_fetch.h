/* ota_fetch.h — run the panel's "Check for updates" manifest fetch on its own
 * thread. The fetch can take up to its 8 s curl timeout on a slow or absent
 * network; on the telemetry thread that left the Modbus bus silent long
 * enough for the G0B1 to stop a running heater (5 s Cortex-silence stop).
 * One fetch at a time; the telemetry thread starts it and later takes the
 * result. Host-tested by ../tests/test_ota_fetch.c.
 */
#pragma once
#include <stdbool.h>
#include <stddef.h>

#define OTA_MANIFEST_MAX 4096u

typedef struct {
    int    curl_rc;     /* CURLcode, 0 = OK                       */
    long   http;        /* HTTP status, 0 if none                 */
    bool   overflow;    /* manifest larger than OTA_MANIFEST_MAX  */
    size_t len;
    char   data[OTA_MANIFEST_MAX + 1];
} ota_fetch_result_t;

/* The blocking fetch, run on the worker thread (curl in main.c; a fake in
 * the host test). Fills *out. */
typedef void (*ota_fetch_fn)(ota_fetch_result_t *out);

/* Start a fetch on a new detached thread. False if one is already running
 * or not yet taken, or the thread could not be created. */
bool ota_fetch_start(ota_fetch_fn fn);

/* True once per started fetch, when it has finished: copies the result into
 * *out and makes the slot free again. */
bool ota_fetch_take(ota_fetch_result_t *out);

/* True from start until the result is taken. */
bool ota_fetch_busy(void);
