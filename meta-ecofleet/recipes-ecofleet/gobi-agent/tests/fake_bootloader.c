#include "fake_bootloader.h"
#include "bl_frame.h"
#include "bl_crc32.h"
#include <string.h>

/* ---- reply builders (body only, then bl_frame_finalize appends CRC16) --- */

static int reply_ack(uint8_t *resp, uint8_t fc, uint8_t sub){
    resp[0] = 1u;
    resp[1] = fc;
    resp[2] = sub;
    resp[3] = 0u;
    return (int)bl_frame_finalize(resp, 4u);
}

static int reply_nak(uint8_t *resp, uint8_t fc, uint8_t err){
    resp[0] = 1u;
    resp[1] = (uint8_t)(fc | 0x80u);
    resp[2] = err;
    return (int)bl_frame_finalize(resp, 3u);
}

static int reply_data_ack(uint8_t *resp, uint32_t off){
    resp[0] = 1u;
    resp[1] = BL_FC_DATA;
    resp[2] = (uint8_t)((off >> 24) & 0xFFu);
    resp[3] = (uint8_t)((off >> 16) & 0xFFu);
    resp[4] = (uint8_t)((off >> 8) & 0xFFu);
    resp[5] = (uint8_t)(off & 0xFFu);
    return (int)bl_frame_finalize(resp, 6u);
}

static int reply_info(uint8_t *resp, const fake_bootloader_t *fb){
    uint32_t size = FAKE_BL_SLOT_SIZE;
    resp[0] = 1u;
    resp[1] = BL_FC_CONTROL;
    resp[2] = (uint8_t)BL_SUB_INFO;
    resp[3] = 1u;                 /* bl_version, arbitrary for the fake */
    resp[4] = fb->inactive_slot;
    resp[5] = (uint8_t)((size >> 24) & 0xFFu);
    resp[6] = (uint8_t)((size >> 16) & 0xFFu);
    resp[7] = (uint8_t)((size >> 8) & 0xFFu);
    resp[8] = (uint8_t)(size & 0xFFu);
    resp[9]  = (uint8_t)((fb->chunk_max >> 8) & 0xFFu);
    resp[10] = (uint8_t)(fb->chunk_max & 0xFFu);
    resp[11] = 1u;                /* crc_algo = CRC32/IEEE */
    return (int)bl_frame_finalize(resp, 12u);
}

static int reply_read_reg2(uint8_t *resp, uint16_t val){
    resp[0] = 1u;
    resp[1] = 0x03u;
    resp[2] = 2u;
    resp[3] = (uint8_t)((val >> 8) & 0xFFu);
    resp[4] = (uint8_t)(val & 0xFFu);
    return (int)bl_frame_finalize(resp, 5u);
}

/* ---- lifecycle / fault hooks -------------------------------------------- */

void fake_bl_init(fake_bootloader_t *fb){
    memset(fb, 0, sizeof(*fb));
    fb->state = FAKE_BL_APP;
    fb->inactive_slot = 0u;
    fb->active_slot = 1u;
    fb->chunk_max = (uint16_t)BL_CHUNK_MAX;
    fb->current_reg2 = 100u;
    fb->reg2_after_commit = 100u;
}

void fake_bl_refuse_enter(fake_bootloader_t *fb){ fb->refuse_enter = 1; }
void fake_bl_fail_verify_crc(fake_bootloader_t *fb){ fb->fail_verify_crc = 1; }

void fake_bl_fail_data_times(fake_bootloader_t *fb, int chunk_index, int times){
    fb->fail_nth_data = chunk_index;
    fb->fail_nth_data_times = times;
}

void fake_bl_fail_nth_data(fake_bootloader_t *fb, int n){
    fake_bl_fail_data_times(fb, n, 1);
}

/* ---- bl_transport_t callbacks -------------------------------------------- */

int fake_bl_wait_reset(void *ctx, uint32_t timeout_ms){
    (void)timeout_ms;
    fake_bootloader_t *fb = (fake_bootloader_t *)ctx;
    fb->state = (fb->state == FAKE_BL_APP) ? FAKE_BL_IDLE : FAKE_BL_APP;
    return 0;
}

int fake_bl_xfer(void *ctx, const uint8_t *req, uint16_t req_len,
                  uint8_t *resp, uint16_t resp_cap, uint32_t timeout_ms){
    (void)resp_cap;
    (void)timeout_ms;
    fake_bootloader_t *fb = (fake_bootloader_t *)ctx;

    if(bl_frame_check(req, req_len) != 0) return -1;
    uint8_t fc = req[1];

    if(fc == 0x06u){ /* write single register */
        if(req_len < 6u) return -1;
        uint16_t addr = (uint16_t)(((uint16_t)req[2] << 8) | (uint16_t)req[3]);
        uint16_t val  = (uint16_t)(((uint16_t)req[4] << 8) | (uint16_t)req[5]);
        if(addr == 34u && val == 0x00A5u){ /* reg 35 = enter-bootloader */
            if(fb->state != FAKE_BL_APP) return -1;
            if(fb->refuse_enter){
                return reply_nak(resp, 0x06u, 0x04u); /* [1][0x86][0x04] */
            }
            uint16_t n = mb_req_write_reg(resp, 35u, 0x00A5u);
            return (int)bl_frame_finalize(resp, n);
        }
        return -1; /* unsupported write for this fake */
    }

    if(fc == 0x03u){ /* read register: this fake only models reg 2 */
        return reply_read_reg2(resp, fb->current_reg2);
    }

    if(fc == BL_FC_CONTROL){
        if(req_len < 5u) return -1;
        uint8_t sub = req[2];
        switch(sub){
        case BL_SUB_INFO: {
            if(fb->state == FAKE_BL_APP) return -1; /* nothing to answer with */
            return reply_info(resp, fb);
        }
        case BL_SUB_ERASE: {
            if(fb->state != FAKE_BL_IDLE){
                return reply_nak(resp, BL_FC_CONTROL, BL_ERR_STATE);
            }
            fb->state = FAKE_BL_ERASED;
            fb->written_len = 0u;
            fb->last_data_offset_valid = 0;
            fb->chunk_counter = 0;
            fb->chunk_fail_count = 0;
            return reply_ack(resp, BL_FC_CONTROL, (uint8_t)BL_SUB_ERASE);
        }
        case BL_SUB_VERIFY: {
            if(fb->state != FAKE_BL_ERASED){
                return reply_nak(resp, BL_FC_CONTROL, BL_ERR_STATE);
            }
            if(fb->fail_verify_crc){
                return reply_nak(resp, BL_FC_CONTROL, BL_ERR_CRC);
            }
            uint32_t length = ((uint32_t)req[3] << 24) | ((uint32_t)req[4] << 16) |
                               ((uint32_t)req[5] << 8)  |  (uint32_t)req[6];
            uint32_t crc_req = ((uint32_t)req[7] << 24) | ((uint32_t)req[8] << 16) |
                                ((uint32_t)req[9] << 8)  |  (uint32_t)req[10];
            const uint8_t *target = (fb->inactive_slot == 0u) ? fb->slotA : fb->slotB;
            uint32_t computed = bl_crc32(target, length);
            if(computed == crc_req && length == fb->written_len){
                fb->state = FAKE_BL_VERIFIED;
                return reply_ack(resp, BL_FC_CONTROL, (uint8_t)BL_SUB_VERIFY);
            }
            return reply_nak(resp, BL_FC_CONTROL, BL_ERR_CRC);
        }
        case BL_SUB_COMMIT: {
            if(fb->state != FAKE_BL_VERIFIED){
                return reply_nak(resp, BL_FC_CONTROL, BL_ERR_STATE);
            }
            fb->active_slot = fb->inactive_slot;
            fb->committed = 1;
            fb->current_reg2 = fb->reg2_after_commit;
            /* Model: device drains TX then resets. Leave `state` as-is
             * (non-APP) so the caller's next wait_reset() flips it back
             * to FAKE_BL_APP, matching the real reset-into-app flow. */
            return reply_ack(resp, BL_FC_CONTROL, (uint8_t)BL_SUB_COMMIT);
        }
        case BL_SUB_ABORT: {
            if(fb->state != FAKE_BL_APP) fb->state = FAKE_BL_IDLE;
            return reply_ack(resp, BL_FC_CONTROL, (uint8_t)BL_SUB_ABORT);
        }
        case BL_SUB_STATUS:
        default:
            return reply_nak(resp, BL_FC_CONTROL, BL_ERR_STATE);
        }
    }

    if(fc == BL_FC_DATA){
        if(req_len < 9u) return -1;
        if(fb->state != FAKE_BL_ERASED){
            return reply_nak(resp, BL_FC_DATA, BL_ERR_STATE);
        }
        uint32_t off = ((uint32_t)req[2] << 24) | ((uint32_t)req[3] << 16) |
                       ((uint32_t)req[4] << 8)  |  (uint32_t)req[5];
        uint8_t len = req[6];
        const uint8_t *data = req + 7;

        int is_new_chunk = !(fb->last_data_offset_valid && fb->last_data_offset == off);
        if(is_new_chunk){
            fb->chunk_counter++;
            fb->last_data_offset = off;
            fb->last_data_offset_valid = 1;
            fb->chunk_fail_count = 0; /* fresh chunk -> fresh fail budget */
        }

        if(fb->fail_nth_data != 0 && fb->chunk_counter == fb->fail_nth_data &&
           fb->chunk_fail_count < fb->fail_nth_data_times){
            fb->chunk_fail_count++;
            return reply_nak(resp, BL_FC_DATA, BL_ERR_FLASH);
        }

        uint8_t *target = (fb->inactive_slot == 0u) ? fb->slotA : fb->slotB;
        if((uint32_t)off + len <= FAKE_BL_SLOT_SIZE){
            memcpy(target + off, data, len);
        }
        if((uint32_t)off + len > fb->written_len) fb->written_len = (uint32_t)off + len;
        return reply_data_ack(resp, off);
    }

    return -1;
}
