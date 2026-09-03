#ifndef BL_SESSION_H
#define BL_SESSION_H
#include <stdint.h>

/* STM32 (gobi/APU) A/B firmware-transfer session state machine, driven
 * through an injected transport so it is host-testable against a fake
 * bootloader (tests/fake_bootloader.c) and, on-target, against a real
 * Modbus-RTU serial link (a later task's bl_transport_serial).
 *
 * Sequence (see docs/superpowers/plans/2026-09-03-cortex-gobi-agent-stm32-
 * flash-delivery.md Task 3 and the frozen g0b1-firmware bl_proto.h /
 * docs/remote-update.md contract):
 *   1. enter bootloader (write holding reg 35 = 0x00A5)
 *   2. wait for reset, then INFO (retried)
 *   3. pick the inactive slot's image + chunk size from INFO
 *   4. ERASE (long timeout)
 *   5. stream DATA chunks, each retried up to 3x on NAK/timeout
 *   6. VERIFY (crc32 over the streamed image, long timeout)
 *   7. COMMIT (device drains TX then resets)
 *   8. wait for reset, re-read reg 2, compare to expected_ver_enc
 */

/* Injected transport. xfer() sends one fully-framed Modbus-RTU request
 * (as built by bl_frame.h's builders + bl_frame_finalize) and returns the
 * framed response length (>=0), or <0 on timeout/bus error. wait_reset()
 * blocks until the device has reset and is answering again (0 ok, <0
 * timeout). */
typedef struct bl_transport {
    int (*xfer)(void *ctx, const uint8_t *req, uint16_t req_len,
                uint8_t *resp, uint16_t resp_cap, uint32_t timeout_ms);
    int (*wait_reset)(void *ctx, uint32_t timeout_ms);
    void *ctx;
} bl_transport_t;

typedef enum {
    BLR_OK = 0,
    BLR_ENTER_REFUSED,
    BLR_NO_DEVICE,
    BLR_INFO_BAD,
    BLR_ERASE_FAIL,
    BLR_WRITE_FAIL,
    BLR_VERIFY_CRC,
    BLR_COMMIT_FAIL,
    BLR_VERSION_MISMATCH,
    BLR_ABORTED
} bl_result_t;

/* phase in {"enter","info","erase","write","verify","commit","done"};
 * pct is 0..100. ud is the caller's opaque user-data pointer. */
typedef void (*bl_progress_fn)(void *ud, const char *phase, int pct);

typedef struct {
    const uint8_t *img_slotA;
    uint32_t       len_slotA;
    const uint8_t *img_slotB;
    uint32_t       len_slotB;
    uint16_t       expected_ver_enc; /* reg-2 value expected after commit+reset */
    bl_progress_fn progress;         /* optional, may be NULL */
    void          *progress_ud;
} bl_flash_params_t;

/* Runs the full enter->info->erase->stream->verify->commit->confirm
 * sequence over transport t, flashing whichever of img_slotA/img_slotB
 * corresponds to the device-reported inactive slot. */
bl_result_t bl_session_flash(const bl_transport_t *t, const bl_flash_params_t *p);

const char *bl_result_str(bl_result_t r);

#endif
