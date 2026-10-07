/* ota_offer.h — pure decisions for the on-panel software update: parse the
 * public releases/latest.json manifest, compare N.N.N versions, and decide
 * whether an update may be offered/installed. No I/O; host-tested by
 * ../tests/test_ota_offer.c.
 */
#pragma once
#include <stdbool.h>
#include <stddef.h>

typedef enum {
    OTA_OFFER_NONE = 0,        /* latest invalid, or not newer than running   */
    OTA_OFFER_AVAILABLE,       /* newer release, nothing else in progress     */
    OTA_OFFER_BLOCKED_BUSY     /* newer release, but an OTA/APU flash is busy */
} ota_offer_t;

/* true if v is exactly N.N.N (digits only, each part 1..5 digits). */
bool ota_ver_valid(const char *v);

/* Numeric N.N.N compare: <0, 0, >0. An invalid version sorts below any valid
 * one; two invalid versions compare equal. */
int ota_ver_cmp(const char *a, const char *b);

/* Extract "version" from a latest.json body into ver (NUL-terminated).
 * False if the JSON is unparseable, the key is missing/not a string, or the
 * value is not N.N.N. */
bool ota_parse_latest(const char *json, char *ver, size_t len);

/* true while the root worker reports an install in flight
 * ("downloading <v>" / "installing <v>"). */
bool ota_status_busy(const char *ota_status);

/* Decide what the panel may offer. running may be "" (unknown): then any valid
 * latest is offered. */
ota_offer_t ota_decide(const char *running, const char *latest,
                       bool ota_busy, bool apu_flash_busy);
