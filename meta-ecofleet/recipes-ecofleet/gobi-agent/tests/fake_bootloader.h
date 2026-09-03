#ifndef FAKE_BOOTLOADER_H
#define FAKE_BOOTLOADER_H
#include <stdint.h>
#include "bl_session.h"
#include "bl_proto.h"

/* Host-side stand-in for the g0b1-firmware bootloader, driving
 * bl_session_flash() through a bl_transport_t without any real serial
 * link. Models just enough device state to exercise the frozen FC
 * 0x41/0x42 contract: entering/leaving the bootloader, INFO, ERASE,
 * streaming DATA into an in-memory "slot", VERIFY (real bl_crc32 over
 * what was actually written), and COMMIT (flips which slot is active
 * and applies a test-controlled post-commit reg-2 version).
 *
 * The struct fields are intentionally public: tests set them directly
 * to arrange scenarios (inactive_slot, chunk_max, current_reg2,
 * reg2_after_commit) alongside the named fault-hook functions below for
 * the multi-field fault scenarios. */

typedef enum {
    FAKE_BL_APP = 0,
    FAKE_BL_IDLE,
    FAKE_BL_ERASED,
    FAKE_BL_VERIFIED
} fake_bl_state_t;

#define FAKE_BL_SLOT_SIZE (224u * 1024u)

typedef struct {
    fake_bl_state_t state;

    uint8_t  inactive_slot;   /* 0 -> slotA, 1 -> slotB; test-settable */
    uint8_t  active_slot;     /* which slot is currently "booted"; flips on COMMIT */
    uint16_t chunk_max;       /* reported by INFO; test-settable (default BL_CHUNK_MAX) */

    uint8_t  slotA[FAKE_BL_SLOT_SIZE];
    uint8_t  slotB[FAKE_BL_SLOT_SIZE];
    uint32_t written_len;     /* high-water mark of bytes written into the target slot */

    uint16_t current_reg2;         /* reg-2 value read back at app FC 0x03 */
    uint16_t reg2_after_commit;    /* applied to current_reg2 on a successful COMMIT */

    int committed;            /* set once a COMMIT has been ACKed */

    /* fault hooks */
    int refuse_enter;         /* reg-35 enter write -> Modbus exception 0x04 */
    int fail_verify_crc;      /* VERIFY always NAKs with BL_ERR_CRC */
    int fail_nth_data;        /* 1-based chunk index to NAK once, then succeed on retry; 0 = disabled */

    /* DATA fault-injection bookkeeping (not test-facing) */
    uint32_t last_data_offset;
    int      last_data_offset_valid;
    int      chunk_counter;        /* number of distinct offsets seen so far */
    int      failed_chunk_marker;  /* chunk_counter value already failed once, 0 = none */
} fake_bootloader_t;

void fake_bl_init(fake_bootloader_t *fb);

/* Fault hooks. */
void fake_bl_refuse_enter(fake_bootloader_t *fb);
void fake_bl_fail_verify_crc(fake_bootloader_t *fb);
void fake_bl_fail_nth_data(fake_bootloader_t *fb, int n);

/* bl_transport_t callbacks; pass ctx = &fb. */
int fake_bl_xfer(void *ctx, const uint8_t *req, uint16_t req_len,
                  uint8_t *resp, uint16_t resp_cap, uint32_t timeout_ms);
int fake_bl_wait_reset(void *ctx, uint32_t timeout_ms);

#endif
