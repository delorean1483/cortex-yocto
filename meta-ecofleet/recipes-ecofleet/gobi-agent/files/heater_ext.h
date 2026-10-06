/* heater_ext.h — pure helpers for the heater coprocessor's extended Modbus
 * block (EF-G0B1R firmware regs 68..75 / wire 67..74): heater type, generic
 * phase, control mode from CAPS, setpoint degF<->degC, vendor state string,
 * and the heater_present gate. No I/O; host-tested by
 * ../tests/test_heater_ext.c.
 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define HEATER_CAP_LEVEL     0x0001u   /* fw reg 70 bit0 */
#define HEATER_CAP_SETPOINT  0x0002u   /* fw reg 70 bit1 */
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

/* "setpoint" if CAP_SETPOINT is set in caps, else "level". */
const char *heater_control_name(unsigned caps);

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
