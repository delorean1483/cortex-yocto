#include "bl_frame.h"

uint16_t bl_crc16(const uint8_t *data, uint16_t len){
    uint16_t crc = 0xFFFFu;
    for(uint16_t i=0;i<len;i++){
        crc ^= data[i];
        for(int b=0;b<8;b++){
            if(crc & 1u) crc = (uint16_t)((crc>>1) ^ 0xA001u);
            else crc = (uint16_t)(crc>>1);
        }
    }
    return crc;
}

uint16_t bl_frame_finalize(uint8_t *frame, uint16_t body_len){
    uint16_t crc = bl_crc16(frame, body_len);
    frame[body_len]     = (uint8_t)(crc & 0xFFu);
    frame[body_len + 1] = (uint8_t)((crc >> 8) & 0xFFu);
    return (uint16_t)(body_len + 2u);
}

int bl_frame_check(const uint8_t *frame, uint16_t len){
    if(len < 4u) return -1;
    if(frame[0] != 1u) return -1;
    uint16_t body_len = (uint16_t)(len - 2u);
    uint16_t crc = bl_crc16(frame, body_len);
    uint8_t lo = (uint8_t)(crc & 0xFFu);
    uint8_t hi = (uint8_t)((crc >> 8) & 0xFFu);
    if(frame[body_len] != lo || frame[body_len + 1] != hi) return -1;
    return 0;
}

uint16_t mb_req_read_reg(uint8_t *out, uint16_t reg1based){
    uint16_t start = (uint16_t)(reg1based - 1u);
    out[0] = 1u;
    out[1] = 0x03u;
    out[2] = (uint8_t)(start >> 8);
    out[3] = (uint8_t)(start & 0xFFu);
    out[4] = 0x00u;
    out[5] = 0x01u;
    return 6u;
}

uint16_t mb_req_write_reg(uint8_t *out, uint16_t reg1based, uint16_t val){
    uint16_t addr = (uint16_t)(reg1based - 1u);
    out[0] = 1u;
    out[1] = 0x06u;
    out[2] = (uint8_t)(addr >> 8);
    out[3] = (uint8_t)(addr & 0xFFu);
    out[4] = (uint8_t)(val >> 8);
    out[5] = (uint8_t)(val & 0xFFu);
    return 6u;
}

uint16_t bl_req_ctrl(uint8_t *out, bl_sub_t sub){
    out[0] = 1u;
    out[1] = BL_FC_CONTROL;
    out[2] = (uint8_t)sub;
    return 3u;
}

uint16_t bl_req_verify(uint8_t *out, uint32_t length, uint32_t crc32){
    out[0] = 1u;
    out[1] = BL_FC_CONTROL;
    out[2] = (uint8_t)BL_SUB_VERIFY;
    out[3] = (uint8_t)((length >> 24) & 0xFFu);
    out[4] = (uint8_t)((length >> 16) & 0xFFu);
    out[5] = (uint8_t)((length >> 8) & 0xFFu);
    out[6] = (uint8_t)(length & 0xFFu);
    out[7] = (uint8_t)((crc32 >> 24) & 0xFFu);
    out[8] = (uint8_t)((crc32 >> 16) & 0xFFu);
    out[9] = (uint8_t)((crc32 >> 8) & 0xFFu);
    out[10] = (uint8_t)(crc32 & 0xFFu);
    return 11u;
}

uint16_t bl_req_data(uint8_t *out, uint32_t off, const uint8_t *data, uint8_t len){
    out[0] = 1u;
    out[1] = BL_FC_DATA;
    out[2] = (uint8_t)((off >> 24) & 0xFFu);
    out[3] = (uint8_t)((off >> 16) & 0xFFu);
    out[4] = (uint8_t)((off >> 8) & 0xFFu);
    out[5] = (uint8_t)(off & 0xFFu);
    out[6] = len;
    for(uint8_t i=0;i<len;i++){
        out[7 + i] = data[i];
    }
    return (uint16_t)(7u + len);
}

int mb_resp_read_reg(const uint8_t *f, uint16_t len, uint16_t *val){
    if(len < 5u) return -1;
    if(f[0] != 1u) return -1;
    uint8_t fc = f[1];
    if(fc == (uint8_t)(0x03u | 0x80u)){
        if(val) *val = f[2];
        return 1;
    }
    if(fc != 0x03u) return -1;
    if(len < 7u) return -1;
    if(f[2] != 2u) return -1;
    if(val) *val = (uint16_t)(((uint16_t)f[3] << 8) | (uint16_t)f[4]);
    return 0;
}

int bl_resp_info(const uint8_t *f, uint16_t len, bl_info_t *info){
    if(len < 14u) return -1;
    if(f[0] != 1u) return -1;
    if(f[1] != BL_FC_CONTROL) return -1;
    if(f[2] != (uint8_t)BL_SUB_INFO) return -1;
    info->bl_version    = f[3];
    info->inactive_slot = f[4];
    info->slot_size = ((uint32_t)f[5] << 24) | ((uint32_t)f[6] << 16) |
                       ((uint32_t)f[7] << 8)  |  (uint32_t)f[8];
    info->chunk_max = (uint16_t)(((uint16_t)f[9] << 8) | (uint16_t)f[10]);
    info->crc_algo  = f[11];
    return 0;
}

int bl_resp_ack(const uint8_t *f, uint16_t len, uint8_t expect_fc,
                bl_sub_t expect_sub, uint8_t *nak_err){
    if(len < 5u) return -1;
    if(f[0] != 1u) return -1;
    uint8_t fc = f[1];
    if(fc == (uint8_t)(expect_fc | 0x80u)){
        if(nak_err) *nak_err = f[2];
        return 1;
    }
    if(fc != expect_fc) return -1;
    if(expect_fc == BL_FC_CONTROL){
        if(len < 6u) return -1;
        if(f[2] != (uint8_t)expect_sub) return -1;
        if(f[3] != 0u) return -1;
        return 0;
    }
    if(expect_fc == BL_FC_DATA){
        if(len < 8u) return -1;
        return 0;
    }
    return -1;
}
