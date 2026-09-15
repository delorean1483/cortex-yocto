/* apu_command.h — pure mapping from the remote apu_command vocabulary to the
 * firmware mode register (fw reg 10 / wire 9): 0=Off 1=Climate 2=Battery.
 *
 * This has no I/O: it turns a shadow-desired command string into the value
 * main.c writes to reg 10 via mb_write_reg(). Keeping it pure lets the one
 * safety-relevant decision in the remote-control path — whether/how the
 * diesel APU cranks — be unit-tested on the host (see
 * ../tests/test_apu_command.c). The reg-10 write itself is the same call the
 * local touchscreen already makes (main.c apply_command_file()); this only
 * lets the AWS shadow drive it.
 */
#pragma once

/* Map a remote apu_command string to the firmware mode register value:
 *   "stop"    -> 0 (Off)
 *   "climate" -> 1 (Climate)
 *   "battery" -> 2 (Battery)
 *   "start"   -> 1 (legacy alias for Climate — keeps a stale shadow command
 *                   from wedging the peek/ack loop)
 * Any other value, "", or NULL returns -1 (reject: the caller acks-and-drops
 * it and never writes an out-of-range value to reg 10). */
int apu_command_to_mode_reg(const char *cmd);
