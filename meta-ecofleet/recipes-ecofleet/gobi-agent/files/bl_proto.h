#ifndef BL_PROTO_H
#define BL_PROTO_H
#include <stdint.h>

/* FC 0x41/0x42 bootloader firmware-transfer wire format.
 * gobi-agent HOST-SIDE copy of the FROZEN contract defined by g0b1-firmware
 * App/services/bl_proto.h (sub-project #1, STM32 bootloader). This header
 * mirrors the constants/types verbatim; the device-side bl_build_* and
 * bl_parse_* prototypes are omitted here (that's the STM32's job) -- the
 * host defines its own request builders / response parsers in bl_frame.h.
 *
 * 0x41 CONTROL (sub in first data byte):
 *   INFO   req [1][0x41][0x01]                                  resp [1][0x41][0x01][ver][slot][size:4 BE][chunk:2 BE][algo]
 *   ERASE  req [1][0x41][0x02]                                  resp ACK [1][0x41][0x02][0x00]   NAK [1][0xC1][err]
 *   VERIFY req [1][0x41][0x03][length:4 BE][crc32:4 BE]         resp ACK/NAK as ERASE
 *   COMMIT req [1][0x41][0x04]                                  resp ACK, then bootloader drains TX + NVIC_SystemReset
 *   ABORT  req [1][0x41][0x05]                                  resp ACK
 *   STATUS req [1][0x41][0x06]                                  resp [1][0x41][0x06][state:1][high_water:4 BE]
 * (trailing [crc16] on every frame, added/checked by the caller, not this codec)
 *
 * 0x42 DATA:
 *   req  [1][0x42][offset:4 BE][len:1][data:len]
 *   resp ACK [1][0x42][offset:4 BE]   NAK [1][0xC2][err]
 *
 * This header holds only the shared wire-contract constants and types
 * (FC codes, bl_sub_t, BL_ERR_ codes, BL_CHUNK_MAX, bl_info_t) -- no
 * functions are declared here. The host-side frame/request builders and
 * response parsers that implement this contract live in bl_frame.h and
 * bl_frame.c: see bl_frame.h for bl_frame_check(), the request builders
 * (bl_req_ctrl, bl_req_verify, bl_req_data, mb_req_read_reg,
 * mb_req_write_reg), and the response parsers (bl_resp_info, bl_resp_ack,
 * mb_resp_read_reg).
 */

#define BL_FC_CONTROL 0x41u
#define BL_FC_DATA    0x42u
#define BL_CHUNK_MAX  240u   /* data bytes per 0x42 chunk (multiple of 8) */

typedef enum {
    BL_SUB_INFO   = 0x01u,
    BL_SUB_ERASE  = 0x02u,
    BL_SUB_VERIFY = 0x03u,
    BL_SUB_COMMIT = 0x04u,
    BL_SUB_ABORT  = 0x05u,
    BL_SUB_STATUS = 0x06u
} bl_sub_t;

#define BL_ERR_STATE 1u
#define BL_ERR_RANGE 2u
#define BL_ERR_CRC   3u
#define BL_ERR_FLASH 4u

typedef struct {
    uint8_t  bl_version;
    uint8_t  inactive_slot;
    uint32_t slot_size;
    uint16_t chunk_max;
    uint8_t  crc_algo;      /* 1 = CRC32/IEEE */
} bl_info_t;
#endif
