/* heater_cmd.h — deliver the remote heater command (shadow desired.heater) to
 * the G0B1, one pass per agent heater tick. Host-tested by
 * ../tests/test_heater_cmd.c against the real shadow.c.
 *
 * Delivery rule: ON at most once, STOP at least once.
 *  - An ON (reg 53 = 1) gets exactly one delivery attempt (mb_write_reg's
 *    in-cycle retries included). Whatever the result (accepted, refused, or
 *    no answer) it is taken out of the pending command; the request readback
 *    (reg 53/64) shows what really happened. With no answer it is logged as
 *    "ON delivery unknown". The G0B1 re-arms START after a Cortex-silence
 *    stop, so a re-sent ON could start the heater long after the user asked.
 *  - A STOP, level, setpoint or clear stays pending until the firmware
 *    answers (OK or refused), and is re-sent every tick until then.
 *  - An ON older than HEATER_ON_MAX_AGE_MS is dropped without being written:
 *    the age counts from the dashboard tap (shadow metadata timestamp) when
 *    known, else from when the agent received it.
 */
#pragma once
#include <stdbool.h>
#include <stdint.h>

#define HEATER_ON_MAX_AGE_MS 15000u

/* One Modbus write: returns HEATER_WR_OK / HEATER_WR_REFUSED /
 * HEATER_WR_FAILED (heater_ext.h). */
typedef int (*heater_write_fn)(int reg, int value, const char *what, void *ctx);

typedef enum {
    HEATER_APPLY_LOST     = -1,  /* a write got no answer: link suspect       */
    HEATER_APPLY_IDLE     = 0,   /* nothing written                           */
    HEATER_APPLY_ANSWERED = 1    /* every write got an answer (OK or refused) */
} heater_apply_t;

/* Apply the pending remote heater command, if any. `ext` = the firmware has
 * the coprocessor block (regs 68..75); now_ms = CLOCK_MONOTONIC ms. */
heater_apply_t heater_cmd_apply(bool ext, uint64_t now_ms, heater_write_fn wr, void *ctx);
