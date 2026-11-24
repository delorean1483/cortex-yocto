/* heater_host.h — keep the host-owned heater settings on the G0B1.
 *
 * The host (this agent) owns the heater level (fw reg 54), setpoint (fw 69,
 * degC) and AUTOTERM control mode (fw 2230). The G0B1 keeps them in RAM only
 * and boots with level 1, setpoint 20 C and temperature mode, so after a
 * G0B1 reboot the agent writes them back. Only the agent writes 54/69/2230,
 * so a 54 or 69 readback that differs from what it last had accepted means
 * the G0B1 lost them.
 *
 * Remembered = the last value a command write of that register got accepted
 * (panel command.json or shadow desired.heater), kept in a small file on
 * /data. With no file, each setting is seeded once from the first good
 * readback.
 *
 * Re-assert = write 54, 69, then 2230 (2230 only while reg 70 offers the
 * mode). Never reg 53 or 75: it never starts or stops the heater. Triggers:
 * the first good poll after the agent starts (with a file), the first good
 * poll after any read with no answer, a 54/69 mismatch, a retry after a
 * refused or unanswered write, and the mode becoming selectable after a
 * re-assert that had to leave it out. Not while a heater command is pending,
 * at most one per HEATER_HOST_MIN_GAP_MS, HEATER_HOST_BACKOFF_MS after a
 * refusal or after a mismatch that the previous re-assert didn't fix.
 *
 * Decision logic is pure (no I/O) and host-tested by
 * ../tests/test_heater_host.c; the file helpers take a path.
 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "heater_ext.h"

#define HEATER_HOST_MIN_GAP_MS  10000u
#define HEATER_HOST_BACKOFF_MS  60000u
#define HEATER_HOST_MAX_WRITES  3

typedef struct {
    int level;        /* fw 54, 1..10; 0 = not known   */
    int setpoint_c;   /* fw 69, 5..30; 0 = not known   */
    int mode;         /* fw 2230, 0/1; -1 = not known  */
} heater_host_settings_t;

typedef struct {
    heater_host_settings_t want;
    bool startup;          /* first good poll after agent start still to come */
    bool link_down;        /* a read got no answer since the last re-assert */
    bool retry;            /* last re-assert had a refused/unanswered write */
    bool mode_owed;        /* mode remembered but left out (no CAP_MODE)   */
    bool ever;             /* a re-assert has run (rate limit applies)     */
    int  last_why;         /* heater_host_reason_t of the last re-assert   */
    uint64_t last_ms;
    uint64_t backoff_until_ms;
} heater_host_t;

/* One good poll's readback (only polls where the coprocessor block answered). */
typedef struct {
    int level;        /* fw 54 */
    int setpoint_c;   /* fw 69 */
    int mode;         /* trusted fw 2230 (heater_mode_next), -1 = none */
    unsigned caps;    /* fw 70 */
} heater_host_readback_t;

typedef enum {
    HEATER_HOST_NONE = 0,
    HEATER_HOST_STARTUP,    /* agent started with remembered settings      */
    HEATER_HOST_LINK,       /* APU answering again after a missed read     */
    HEATER_HOST_MISMATCH,   /* 54/69 readback differs: G0B1 lost them      */
    HEATER_HOST_RETRY,      /* previous re-assert refused / unanswered     */
    HEATER_HOST_MODE        /* mode selectable again after being left out  */
} heater_host_reason_t;

/* `loaded` = settings from the file (NULL = no file): with any known
 * setting, the first good poll re-asserts them. */
void heater_host_init(heater_host_t *h, const heater_host_settings_t *loaded);

/* Fill settings not known yet from a good readback (seeding). Returns true
 * if h->want changed (persist it). */
bool heater_host_adopt(heater_host_t *h, const heater_host_readback_t *rb);

/* A heater command write finished (result = HEATER_WR_*). An accepted write
 * of 54/69/2230 becomes the remembered value. Returns true if h->want
 * changed (persist it). */
bool heater_host_note_write(heater_host_t *h, int reg, int value, int result);

/* A read (poll or keepalive) or a write got no answer: the G0B1 may have
 * rebooted, so re-assert on the next good poll. */
void heater_host_note_link_down(heater_host_t *h);

/* Decide on a re-assert for one good poll. Returns the number of writes
 * placed in out (0..HEATER_HOST_MAX_WRITES) and the reason in *why
 * (HEATER_HOST_NONE when 0). When it returns > 0 the caller must run the
 * writes and call heater_host_done(). */
int heater_host_plan(heater_host_t *h, const heater_host_readback_t *rb,
                     bool cmd_pending, uint64_t now_ms,
                     heater_write_t out[HEATER_HOST_MAX_WRITES],
                     heater_host_reason_t *why);

/* Results of the planned writes (HEATER_WR_*; SKIPPED = not tried). */
void heater_host_done(heater_host_t *h, const heater_write_t *w,
                      const int *results, int n, uint64_t now_ms);

/* "agent start" | "APU link back" | "G0B1 lost settings" | "retry" |
 * "mode selectable" | "none". */
const char *heater_host_reason_name(heater_host_reason_t why);

/* File format: {"level":5,"setpoint_c":22,"mode":1}, unknown fields left
 * out. parse() accepts any subset; out-of-range values are dropped. Returns
 * false if nothing usable was found. */
int  heater_host_format(const heater_host_settings_t *s, char *buf, size_t len);
bool heater_host_parse(const char *json, heater_host_settings_t *out);
bool heater_host_load(const char *path, heater_host_settings_t *out);
int  heater_host_save(const char *path, const heater_host_settings_t *s);   /* 0 ok, -1 error */
