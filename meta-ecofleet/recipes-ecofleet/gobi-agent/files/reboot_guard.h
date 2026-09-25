/* reboot_guard.h — stop a remote reboot request from rebooting the unit twice.
 *
 * The root worker cold-resets the board as soon as the agent hands it
 * "reboot", before the agent's next shadow report can null desired.reboot. On
 * restart the shadow still carries reboot:true, which used to reboot the unit
 * again, forever. AWS stamps every desired field with a metadata timestamp, so
 * each reboot request is identifiable: the agent records the timestamp it
 * carried out in REBOOT_HONORED_PATH before rebooting, and a request with that
 * same timestamp is only cleared, not carried out again. A dashboard reboot
 * sent later has a new timestamp and is honored.
 */
#pragma once

#ifndef REBOOT_HONORED_PATH
#define REBOOT_HONORED_PATH "/var/lib/ecofleet/reboot-honored"
#endif

/* 1 = carry out the request, 0 = already carried out (clear it only).
 * A request with no timestamp (0) is honored, as before. Pure. */
int reboot_guard_should_honor(long long request_ts, long long honored_ts);

/* Last honored timestamp from path, or 0 if missing/unreadable/corrupt. */
long long reboot_guard_load(const char *path);

/* Record ts atomically and durably (fsync) BEFORE rebooting. 0 ok, -1 error. */
int reboot_guard_save(const char *path, long long ts);
