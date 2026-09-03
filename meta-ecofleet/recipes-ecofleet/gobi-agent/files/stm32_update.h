/* stm32_update.h — STM32 (gobi/APU) remote firmware update decision logic.
 *
 * Pure module: version compare, idle/mode/engine safety gate, and a cJSON
 * manifest parse. No libmodbus, no file I/O, no libmosquitto here — reading
 * the manifest off disk and driving the Modbus bootloader transport live in
 * the separate on-target glue (Task 6). Keeping this pure lets it be
 * unit-tested on the host (see ../tests/test_stm32_update.c).
 */
#pragma once

#include <stddef.h>   /* size_t */
#include <stdint.h>   /* uint16_t, uint8_t */

/* Lifecycle status of an STM32 update attempt, as surfaced to the UI/shadow. */
typedef enum {
    STU_IDLE = 0,
    STU_AVAILABLE,
    STU_FLASHING,
    STU_OK,
    STU_FAILED,
    STU_DISABLED,
} stu_status_t;

/* Stable lowercase name for a status: "idle"/"available"/"flashing"/"ok"/
 * "failed"/"disabled". Never returns NULL; an out-of-range value maps to
 * "idle" (the safe default). */
const char *stu_status_str(stu_status_t s);

/* Encode a M.m.p version triple the same way the STM32 firmware packs its
 * reg-2 version register: major*10000 + minor*100 + patch. */
uint16_t stu_encode_version(unsigned major, unsigned minor, unsigned patch);

/* 1 iff bundled_enc is strictly newer than running_enc AND running_enc != 0
 * (running_enc == 0 means the version register read failed — never flash
 * against an unknown running version). Otherwise 0. */
int stu_is_newer(uint16_t running_enc, uint16_t bundled_enc);

/* 1 iff stu_is_newer(running_enc, bundled_enc) AND mode==0 (not in an active
 * climate/operating mode) AND engine==0 (engine not running/cranking) AND
 * auto_enabled is truthy. Otherwise 0. This is the full idle-safety gate:
 * every condition must hold before an automatic flash is allowed to start. */
int stu_should_flash(uint16_t running_enc, uint16_t bundled_enc,
                      uint8_t mode, uint8_t engine, int auto_enabled);

/* Parse a manifest JSON object of the shape:
 *   { "version":"1.1.0", "slotA":"g0b1-apu-1.1.0-slotA.bin",
 *     "slotB":"g0b1-apu-1.1.0-slotB.bin" }
 *
 * On success: *ver_enc is set via stu_encode_version() of the parsed
 * "M.m.p" version string, and the "slotA"/"slotB" filenames are copied
 * (NUL-terminated) into the caller-supplied slotA/slotB buffers, each of
 * capacity name_cap. Returns 0.
 *
 * On any malformed/missing field, or if either filename (including its NUL)
 * would not fit in name_cap, returns -1 and leaves *ver_enc/slotA/slotB
 * untouched (no truncated copy is ever written).
 */
int stu_parse_manifest(const char *json, uint16_t *ver_enc,
                        char *slotA, char *slotB, size_t name_cap);
