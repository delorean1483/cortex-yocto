#include "bl_session.h"
#include "bl_frame.h"
#include "bl_proto.h"
#include "bl_crc32.h"

#define BL_MAX_FRAME         256u
#define BL_SHORT_TIMEOUT_MS  1000u
#define BL_LONG_TIMEOUT_MS   10000u
#define BL_ENTER_REG         35u
#define BL_ENTER_VAL         0x00A5u
#define BL_VERSION_REG       2u
#define BL_DATA_RETRY_MAX    3
#define BL_INFO_RETRY_MAX    5
#define BL_VERSION_RETRY_MAX 5

static void bl_progress(const bl_flash_params_t *p, const char *phase, int pct){
    if(p->progress) p->progress(p->progress_ud, phase, pct);
}

/* Best-effort ABORT after a hard failure past ERASE; return value ignored
 * on purpose -- the device may already be resetting. */
static void bl_send_abort(const bl_transport_t *t){
    uint8_t req[BL_MAX_FRAME];
    uint8_t resp[BL_MAX_FRAME];
    uint16_t n = bl_req_ctrl(req, BL_SUB_ABORT);
    n = bl_frame_finalize(req, n);
    (void)t->xfer(t->ctx, req, n, resp, sizeof(resp), BL_SHORT_TIMEOUT_MS);
}

bl_result_t bl_session_flash(const bl_transport_t *t, const bl_flash_params_t *p){
    uint8_t req[BL_MAX_FRAME];
    uint8_t resp[BL_MAX_FRAME];
    int rlen;

    if(t == 0 || t->xfer == 0 || t->wait_reset == 0 || p == 0) return BLR_NO_DEVICE;

    /* 1. Enter bootloader. */
    bl_progress(p, "enter", 0);
    {
        uint16_t n = mb_req_write_reg(req, BL_ENTER_REG, BL_ENTER_VAL);
        n = bl_frame_finalize(req, n);
        rlen = t->xfer(t->ctx, req, n, resp, sizeof(resp), BL_SHORT_TIMEOUT_MS);
        if(rlen >= 0 && bl_frame_check(resp, (uint16_t)rlen) == 0){
            if(resp[1] == (uint8_t)(0x06u | 0x80u)){
                return BLR_ENTER_REFUSED;
            }
            /* else: normal FC 0x06 echo -> proceed */
        }
        /* rlen < 0 (timeout) or a malformed reply: the app resets before
         * replying on real hardware -- treat as "probably entered". */
    }

    /* 2. Wait for reset, then INFO (retried -- device just booted). */
    (void)t->wait_reset(t->ctx, 3000u);

    bl_info_t info;
    {
        int got_info = 0;
        int any_response = 0;
        int attempt;
        for(attempt = 0; attempt < BL_INFO_RETRY_MAX; attempt++){
            uint16_t n = bl_req_ctrl(req, BL_SUB_INFO);
            n = bl_frame_finalize(req, n);
            rlen = t->xfer(t->ctx, req, n, resp, sizeof(resp), BL_SHORT_TIMEOUT_MS);
            if(rlen < 0) continue;
            any_response = 1;
            if(bl_frame_check(resp, (uint16_t)rlen) != 0) continue;
            if(bl_resp_info(resp, (uint16_t)rlen, &info) == 0){ got_info = 1; break; }
        }
        if(!got_info) return any_response ? BLR_INFO_BAD : BLR_NO_DEVICE;
    }
    bl_progress(p, "info", 5);

    /* 3. Pick the image for the device-reported inactive slot. */
    const uint8_t *img;
    uint32_t len;
    if(info.inactive_slot == 0u){ img = p->img_slotA; len = p->len_slotA; }
    else                        { img = p->img_slotB; len = p->len_slotB; }
    uint16_t chunk = (info.chunk_max != 0u && info.chunk_max < (uint16_t)BL_CHUNK_MAX)
                     ? info.chunk_max : (uint16_t)BL_CHUNK_MAX;

    /* 4. ERASE (long timeout -- 112 pages before ACK). */
    bl_progress(p, "erase", 10);
    {
        uint16_t n = bl_req_ctrl(req, BL_SUB_ERASE);
        n = bl_frame_finalize(req, n);
        rlen = t->xfer(t->ctx, req, n, resp, sizeof(resp), BL_LONG_TIMEOUT_MS);
        if(rlen < 0 || bl_frame_check(resp, (uint16_t)rlen) != 0){
            return BLR_ERASE_FAIL;
        }
        uint8_t nak_err = 0;
        if(bl_resp_ack(resp, (uint16_t)rlen, BL_FC_CONTROL, &nak_err) != 0){
            return BLR_ERASE_FAIL;
        }
    }

    /* 5. Stream DATA, retrying each chunk up to 3x. */
    {
        uint32_t off;
        for(off = 0; off < len; off += chunk){
            uint32_t remaining = len - off;
            uint8_t n_bytes = (uint8_t)((remaining < chunk) ? remaining : chunk);
            int ok = 0;
            int attempt;
            for(attempt = 0; attempt < BL_DATA_RETRY_MAX && !ok; attempt++){
                uint16_t n = bl_req_data(req, off, img + off, n_bytes);
                n = bl_frame_finalize(req, n);
                rlen = t->xfer(t->ctx, req, n, resp, sizeof(resp), BL_SHORT_TIMEOUT_MS);
                if(rlen < 0) continue;
                if(bl_frame_check(resp, (uint16_t)rlen) != 0) continue;
                uint8_t nak_err = 0;
                if(bl_resp_ack(resp, (uint16_t)rlen, BL_FC_DATA, &nak_err) != 0) continue;
                /* bl_resp_ack only confirms ACK-vs-NAK for FC 0x42; the
                 * echoed offset must be checked here (ruling: a mismatched
                 * or short ACK counts as a failed chunk). */
                uint32_t echoed = ((uint32_t)resp[2] << 24) | ((uint32_t)resp[3] << 16) |
                                   ((uint32_t)resp[4] << 8)  |  (uint32_t)resp[5];
                if(echoed != off) continue;
                ok = 1;
            }
            if(!ok){
                bl_send_abort(t);
                return BLR_WRITE_FAIL;
            }
            bl_progress(p, "write", 10 + (int)((80u * off) / len));
        }
    }

    /* 6. VERIFY (long timeout). */
    bl_progress(p, "verify", 92);
    {
        uint32_t crc = bl_crc32(img, len);
        uint16_t n = bl_req_verify(req, len, crc);
        n = bl_frame_finalize(req, n);
        rlen = t->xfer(t->ctx, req, n, resp, sizeof(resp), BL_LONG_TIMEOUT_MS);
        if(rlen < 0 || bl_frame_check(resp, (uint16_t)rlen) != 0){
            bl_send_abort(t);
            return BLR_WRITE_FAIL;
        }
        uint8_t nak_err = 0;
        int r = bl_resp_ack(resp, (uint16_t)rlen, BL_FC_CONTROL, &nak_err);
        if(r == 1){
            bl_send_abort(t);
            if(nak_err == BL_ERR_CRC) return BLR_VERIFY_CRC;
            if(nak_err == BL_ERR_STATE) return BLR_ERASE_FAIL;
            return BLR_WRITE_FAIL;
        }
        if(r != 0){
            bl_send_abort(t);
            return BLR_WRITE_FAIL;
        }
    }

    /* 7. COMMIT (device drains TX then resets). */
    bl_progress(p, "commit", 95);
    {
        uint16_t n = bl_req_ctrl(req, BL_SUB_COMMIT);
        n = bl_frame_finalize(req, n);
        rlen = t->xfer(t->ctx, req, n, resp, sizeof(resp), BL_SHORT_TIMEOUT_MS);
        if(rlen >= 0 && bl_frame_check(resp, (uint16_t)rlen) == 0){
            uint8_t nak_err = 0;
            if(bl_resp_ack(resp, (uint16_t)rlen, BL_FC_CONTROL, &nak_err) == 1){
                bl_send_abort(t);
                return BLR_COMMIT_FAIL;
            }
        }
        /* timeout or malformed reply here is tolerated: the device may
         * reset mid-reply, same as the enter-bootloader step. */
    }

    /* 8. Wait for reset, then re-read reg 2 (retried) and confirm version. */
    (void)t->wait_reset(t->ctx, 5000u);
    {
        uint16_t ver = 0;
        int got = 0;
        int attempt;
        for(attempt = 0; attempt < BL_VERSION_RETRY_MAX; attempt++){
            uint16_t n = mb_req_read_reg(req, BL_VERSION_REG);
            n = bl_frame_finalize(req, n);
            rlen = t->xfer(t->ctx, req, n, resp, sizeof(resp), BL_SHORT_TIMEOUT_MS);
            if(rlen < 0) continue;
            if(bl_frame_check(resp, (uint16_t)rlen) != 0) continue;
            if(mb_resp_read_reg(resp, (uint16_t)rlen, &ver) == 0){ got = 1; break; }
        }
        bl_progress(p, "done", 100);
        if(!got || ver != p->expected_ver_enc) return BLR_VERSION_MISMATCH;
        return BLR_OK;
    }
}

const char *bl_result_str(bl_result_t r){
    switch(r){
    case BLR_OK:               return "OK";
    case BLR_ENTER_REFUSED:    return "ENTER_REFUSED";
    case BLR_NO_DEVICE:        return "NO_DEVICE";
    case BLR_INFO_BAD:         return "INFO_BAD";
    case BLR_ERASE_FAIL:       return "ERASE_FAIL";
    case BLR_WRITE_FAIL:       return "WRITE_FAIL";
    case BLR_VERIFY_CRC:       return "VERIFY_CRC";
    case BLR_COMMIT_FAIL:      return "COMMIT_FAIL";
    case BLR_VERSION_MISMATCH: return "VERSION_MISMATCH";
    case BLR_ABORTED:          return "ABORTED";
    default:                   return "UNKNOWN";
    }
}
