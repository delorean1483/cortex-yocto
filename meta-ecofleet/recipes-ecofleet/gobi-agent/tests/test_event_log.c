/* test_event_log.c — on-device APU fault history (event_log.c).
 *
 * Each APU fault becomes one event: when it started, when it cleared (0 while
 * still active) and the conditions at the start (mode, status, RPM, battery,
 * temperatures). Newest first, capped at EVENT_LOG_MAX. Stored as JSON on the
 * slot-shared /data partition so it survives A/B updates.
 */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "event_log.h"

static int g_fail, g_checks;
#define CHECK(c, msg) do { g_checks++; if (!(c)) { g_fail++; \
    printf("  FAIL: %s  (%s:%d)\n", (msg), __FILE__, __LINE__); } } while (0)

static event_snapshot_t snap(int rpm) {
    event_snapshot_t s; memset(&s, 0, sizeof s);
    strcpy(s.mode, "climate"); strcpy(s.control_status, "cooling");
    s.rpm = rpm; s.batt_v = 13.9; s.cabin_temp_f = 80; s.coolant_temp_f = 190;
    return s;
}

static void test_transitions(void)
{
    event_log_t log; event_log_init(&log);
    event_snapshot_t s = snap(2450);
    printf("event_log_on_error\n");

    CHECK(event_log_on_error(&log, 0, 0, 1000, &s) == 0, "no fault, no change");
    CHECK(log.count == 0, "empty");

    CHECK(event_log_on_error(&log, 0, 3, 5000, &s) == 1, "fault starts");
    CHECK(log.count == 1 && log.ev[0].code == 3 && log.ev[0].start_ms == 5000 && log.ev[0].end_ms == 0,
          "active event recorded");
    CHECK(strcmp(log.ev[0].snap.mode, "climate") == 0 && log.ev[0].snap.rpm == 2450, "conditions kept");
    CHECK(event_log_active_code(&log) == 3, "active code");

    CHECK(event_log_on_error(&log, 3, 3, 6000, &s) == 0, "same fault, no change");

    CHECK(event_log_on_error(&log, 3, 0, 9000, &s) == 1, "fault clears");
    CHECK(log.count == 1 && log.ev[0].end_ms == 9000, "event closed");
    CHECK(event_log_active_code(&log) == 0, "nothing active");

    /* fault changes directly from one code to another: close + open */
    event_log_on_error(&log, 0, 5, 10000, &s);
    CHECK(event_log_on_error(&log, 5, 7, 12000, &s) == 1, "code change");
    CHECK(log.count == 3 && log.ev[0].code == 7 && log.ev[0].end_ms == 0, "new one active, newest first");
    CHECK(log.ev[1].code == 5 && log.ev[1].end_ms == 12000, "previous closed");
}

static void test_cap(void)
{
    event_log_t log; event_log_init(&log);
    event_snapshot_t s = snap(0);
    printf("cap at EVENT_LOG_MAX\n");
    for (int i = 0; i < EVENT_LOG_MAX + 15; i++) {
        event_log_on_error(&log, 0, 1, 1000LL * i, &s);
        event_log_on_error(&log, 1, 0, 1000LL * i + 500, &s);
    }
    CHECK(log.count == EVENT_LOG_MAX, "capped");
    CHECK(log.ev[0].start_ms == 1000LL * (EVENT_LOG_MAX + 14), "newest kept at the front");
    CHECK(log.ev[EVENT_LOG_MAX - 1].start_ms == 1000LL * 15, "oldest ones dropped");
}

static void test_file_roundtrip(void)
{
    char path[] = "/tmp/test_event_log_XXXXXX";
    int fd = mkstemp(path); close(fd); unlink(path);
    event_log_t a, b; event_log_init(&a); event_log_init(&b);
    event_snapshot_t s = snap(2400);
    printf("save/load\n");
    CHECK(event_log_load(path, &b) == 0 && b.count == 0, "missing file loads empty");
    event_log_on_error(&a, 0, 2, 1790000000000LL, &s);
    event_log_on_error(&a, 2, 0, 1790000060000LL, &s);
    event_log_on_error(&a, 0, 4, 1790000100000LL, &s);
    CHECK(event_log_save(path, &a) == 0, "save ok");
    CHECK(event_log_load(path, &b) == 1 && b.count == 2, "loaded both");
    CHECK(b.ev[0].code == 4 && b.ev[0].end_ms == 0, "active one first");
    CHECK(b.ev[1].code == 2 && b.ev[1].end_ms == 1790000060000LL, "cleared one");
    CHECK(strcmp(b.ev[1].snap.control_status, "cooling") == 0 && b.ev[1].snap.batt_v > 13.8, "snapshot round-trips");
    FILE *f = fopen(path, "w"); fputs("{not json", f); fclose(f);
    CHECK(event_log_load(path, &b) == 0 && b.count == 0, "corrupt file loads empty, never crashes");
    unlink(path);
    CHECK(event_log_save("/nonexistent-dir/x.json", &a) != 0, "save failure reported");
}

int main(void)
{
    test_transitions();
    test_cap();
    test_file_roundtrip();
    printf("\n%d checks, %d failures\n", g_checks, g_fail);
    if (g_fail == 0) printf("ALL GREEN\n");
    return g_fail ? 1 : 0;
}
