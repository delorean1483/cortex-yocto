/* heater_ext.h — pure helpers for the heater coprocessor's extended Modbus
 * block (EF-G0B1R firmware regs 68..75 / wire 67..74): heater type, generic
 * phase, control mode from CAPS (+ fw 2230), setpoint degF<->degC, vendor
 * state string,
 * and the heater_present gate. No I/O; host-tested by
 * ../tests/test_heater_ext.c.
 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define HEATER_CAP_LEVEL     0x0001u   /* fw reg 70 bit0 */
#define HEATER_CAP_SETPOINT  0x0002u   /* fw reg 70 bit1 */
/* fw reg 70 bit8 (G0B1 1.3.17 + L011 0.2.4, AUTOTERM only): the control mode
 * is selectable at fw 2230 (wire 2229): 0 temperature (setpoint, reg 69),
 * 1 power (level, reg 54). Reads back the APPLIED mode; writes on a heater
 * without the bit, or in maintenance, are refused with ILLEGAL_VALUE. */
#define HEATER_CAP_MODE      0x0100u
#define HEATER_REG_MODE      2230      /* fw reg (1-based) */
#define HEATER_MODE_TEMPERATURE 0
#define HEATER_MODE_POWER       1
#define HEATER_PHASE_FAULT   6u        /* fw reg 71 value */
#define HEATER_CMD_CLEAR_FAULT 3u      /* fw reg 75 command */

#define HEATER_SETPOINT_F_MIN 41
#define HEATER_SETPOINT_F_MAX 86
#define HEATER_SETPOINT_C_MIN 5
#define HEATER_SETPOINT_C_MAX 30

/* fw reg 68: 0 none, 1 VEVOR, 2 AUTOTERM -> "none"|"vevor"|"autoterm"|"unknown". */
const char *heater_type_name(unsigned type);

/* fw reg 71: 0 off,1 detecting,2 starting,3 running,4 stop_requested,
 * 5 cooldown,6 fault -> "off"|"detecting"|"starting"|"running"|"stopping"|
 * "cooldown"|"fault", else "unknown". */
const char *heater_phase_name(unsigned phase);

/* What the heater is driven by: "level" or "setpoint". With CAP_MODE and a
 * known applied mode (fw 2230; -1 = not read), power -> "level" and
 * temperature -> "setpoint"; otherwise "setpoint" if CAP_SETPOINT is set in
 * caps, else "level". */
const char *heater_control_name(unsigned caps, int mode);

/* fw 2230 -> "temperature" | "power", or NULL when the mode isn't selectable
 * (no CAP_MODE), not read yet (-1) or an unknown value. */
const char *heater_mode_name(unsigned caps, int mode);

/* The control mode to keep after one read of fw 2227..2230: G0B1 1.3.17
 * answers 2230 with 0 (no exception) while the L011 is unidentified, lost,
 * in maintenance or after a Cortex-silence latch, so a reading only counts
 * when the L011 is identified (2227/2228 not both 0) and reg 64 shows no
 * heater-link or map fault (bits 3, 5, 6); otherwise `prev` is kept.
 * Returns 0, 1, or -1 for an unknown value. */
int heater_mode_next(int prev, unsigned l011_ver, unsigned l011_build,
                     unsigned flags, unsigned raw);

/* "temperature" -> 0, "power" -> 1, anything else (NULL included) -> -1.
 * Inline so shadow.c can use it without linking heater_ext.c. */
static inline int heater_mode_parse(const char *s)
{
    if (!s) return -1;
    if (strcmp(s, "temperature") == 0) return HEATER_MODE_TEMPERATURE;
    if (strcmp(s, "power") == 0) return HEATER_MODE_POWER;
    return -1;
}

/* Whole degF from whole degC, rounded half away from zero. */
int heater_c_to_f(int c);

/* Whole degC from whole degF, rounded half away from zero, clamped 5..30. */
int heater_f_to_c(int f);

/* fw reg 72 (major<<8 | sub) -> "major.sub" into buf (always NUL-terminated). */
void heater_vendor_state_str(unsigned v, char *buf, size_t len);

/* heater_present: the legacy block answered (state_ok) AND either the
 * extended block is absent (old firmware: type_ok false) or a heater type is
 * actually detected (type != 0). Hides the card on heaterless units running
 * coprocessor-era firmware, where reg 55 always answers. */
bool heater_present_from(bool state_ok, bool type_ok, unsigned type);

/* L011 diagnostics, G0B1 1.3.16+: read-only fw regs 2227..2229 (wire
 * 2226..2228). 2227 = L011 firmware major<<8|minor and 2228 = build, both 0
 * while the L011 is unidentified or in its loader; 2229 = the last 0xB011
 * loader-entry rejection, 0 after a successful entry. Older G0B1 firmware
 * answers the read with ILLEGAL_ADDRESS. */
#define HEATER_L011_DIAG_NREGS 3

/* fw 2227 + 2228 -> "major.minor.build" into buf (always NUL-terminated), or
 * "" when both are 0 (no identified L011). */
void heater_l011_fw_str(unsigned ver, unsigned build, char *buf, size_t len);

/* fw 2229: 0 none, 1 phase_not_off, 2 run_request_set, 3 lamp_not_off,
 * 4 identity_mismatch, 5 heater_mode_set, 6 loader_error, else "unknown". */
const char *heater_l011_reject_name(unsigned code);

/* Whether to read the L011 diagnostics this cycle: only with the coprocessor
 * block (ext), and not again on a G0B1 firmware version that refused the
 * read; a G0B1 update is probed afresh. */
typedef struct { bool refused; uint16_t refused_fw; } heater_l011_probe_t;
bool heater_l011_probe_due(const heater_l011_probe_t *p, bool ext, uint16_t g0b1_fw);
/* Record one read that got an answer: refused = exception answer. A read
 * with no answer (timeout) is not recorded. */
void heater_l011_probe_note(heater_l011_probe_t *p, bool refused, uint16_t g0b1_fw);

/* Outcome of one Modbus write. REFUSED = the firmware answered with an
 * exception (illegal function/address/value): the write arrived and was
 * turned down, so sending it again is a new request, not a retry. */
#define HEATER_WR_OK       0
#define HEATER_WR_FAILED  (-1)   /* no valid answer: delivery unknown */
#define HEATER_WR_REFUSED  1
#define HEATER_WR_SKIPPED (-2)   /* not tried: behind a write with no answer */

/* One Modbus heater write: 1-based firmware register + value. */
typedef struct { int reg; int value; const char *what; } heater_write_t;

/* True for the write that asks the heater to start (reg 53 = 1). */
bool heater_write_is_on(const heater_write_t *w);

/* "The firmware has the coprocessor block (regs 68..75)", updated from one
 * read of it: true on an answer, false only on an exception answer (no such
 * register), unchanged when the read got no answer. One RS-485 glitch must
 * not switch off the keepalive and the setpoint/clear writes for a cycle. */
bool heater_ext_next(bool prev, bool read_ok, bool refused);

/* True when a command is finished and must be acked: every write got an
 * answer (OK or REFUSED), except that an ON that was tried never holds it
 * open. False if any other write FAILED (no answer) or any write was SKIPPED
 * (not tried yet, an ON included): the command stays pending and is retried
 * next tick, so a STOP is delivered at least once.
 * An ON is delivered at most once. A refused ON or an ON with no answer must
 * never stay pending: the G0B1 re-arms START after a Cortex-silence stop, so
 * a re-sent ON would start the heater long after the user asked. */
bool heater_cmd_settled(const heater_write_t *w, const int *results, int n);

/* Plan the writes for one heater command (local command.json or shadow
 * desired.heater), in the safe order clear_fault -> mode -> setpoint ->
 * level -> on, so a START goes out in the chosen mode.
 * Unset/invalid fields are skipped (on: 0|1, level: 1..10, setpoint_f:
 * 41..86, clear_fault: true, mode: 0|1). setpoint/clear/mode target the
 * coprocessor block, so they are planned only when `ext` (firmware has regs
 * 68..75): on older firmware they would fail forever and keep the whole
 * command pending.
 * Returns the number of writes placed in out (0..HEATER_MAX_WRITES). */
#define HEATER_MAX_WRITES 5
int heater_plan_writes(int on, int level, int setpoint_f, bool clear_fault,
                       int mode, bool ext, heater_write_t out[HEATER_MAX_WRITES]);
