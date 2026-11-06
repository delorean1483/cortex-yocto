/* apu_silence.h — raise "APU not responding" as a fault event.
 *
 * When the APU controller stops answering Modbus the agent has no fault code
 * to report (the firmware's own codes come from a read that fails). After
 * APU_SILENT_RAISE_MS of silence the agent publishes a fault event with the
 * agent-only code APU_NO_REPLY_CODE on ecofleet/<serial>/faults, so the fault
 * Lambda records it and emails when it starts and clears. The first good read
 * afterwards publishes the APU's real code, which clears it.
 *
 * The last code published is kept in a small state file, so an agent restart
 * (e.g. the truck power-cycled) still publishes the clear once the APU answers.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

/* Firmware codes (control_error_t) fit in a byte; this one never collides. */
#define APU_NO_REPLY_CODE   256u
#define APU_SILENT_RAISE_MS 60000u

#ifndef LAST_FAULT_PATH
#define LAST_FAULT_PATH          "/data/ecofleet/last-fault"
#endif
#ifndef LAST_FAULT_FALLBACK_PATH
#define LAST_FAULT_FALLBACK_PATH "/var/lib/ecofleet/last-fault"
#endif

/* True when the agent should publish the APU-not-responding event now: the
 * APU has been silent since down_since_ms for at least APU_SILENT_RAISE_MS
 * (both on the monotonic clock) and last_code (the last fault code published)
 * is not already APU_NO_REPLY_CODE. Pure. */
bool apu_silence_should_raise(unsigned last_code, uint64_t down_since_ms, uint64_t now_ms);

/* The fault event {unit, ts, error:"apu_no_reply", error_n:256,
 * status:"no_reply"} as JSON; caller frees. NULL on allocation failure. */
char *apu_silence_fault_json(const char *unit, uint64_t ts_ms);

/* Last published fault code from path, or 0 (no fault) if missing, unreadable
 * or corrupt. */
unsigned last_fault_load(const char *path);

/* Record code atomically and durably (temp + fsync + rename). 0 ok, -1 error. */
int last_fault_save(const char *path, unsigned code);
