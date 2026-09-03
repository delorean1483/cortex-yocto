#ifndef BL_FRAME_H
#define BL_FRAME_H
#include <stdint.h>
#include "bl_proto.h"

/* Host-side Modbus-RTU framing + FC 0x03/0x06/0x41/0x42 codec for the
 * gobi-agent. Implements the wire contract frozen in bl_proto.h (see that
 * header for the full 0x41/0x42 layout doc). All multi-byte wire fields
 * (Modbus reg addr/qty/value, and the FC 0x41/0x42 offset/length/crc32/
 * slot_size) are BIG-ENDIAN; the trailing CRC-16 is appended little-endian
 * (lo, hi) per Modbus-RTU convention.
 *
 * Frame body layout produced by the req builders: [addr=1][fc][data...].
 * The caller finalizes with bl_frame_finalize() to append the CRC16, and
 * validates an inbound frame with bl_frame_check() before handing it to a
 * resp parser. The resp parsers take the full frame length (CRC included)
 * and ignore the trailing 2 CRC bytes themselves.
 */

/* CRC-16/Modbus: reflected poly 0xA001, init 0xFFFF, no final xor. */
uint16_t bl_crc16(const uint8_t *data, uint16_t len);

/* Append CRC16 (lo, hi) after body_len bytes already written to frame.
 * Returns body_len + 2. */
uint16_t bl_frame_finalize(uint8_t *frame, uint16_t body_len);

/* Validate an inbound frame: 0 if len>=4, frame[0]==1, and CRC checks out;
 * non-zero otherwise. */
int bl_frame_check(const uint8_t *frame, uint16_t len);

/* Request builders: write the body [addr=1][fc][data...] into out, return
 * the body length (caller then calls bl_frame_finalize). */
uint16_t mb_req_read_reg(uint8_t *out, uint16_t reg1based);           /* FC 0x03, qty 1, start = reg-1 */
uint16_t mb_req_write_reg(uint8_t *out, uint16_t reg1based, uint16_t val); /* FC 0x06, addr = reg-1 */
uint16_t bl_req_ctrl(uint8_t *out, bl_sub_t sub);                     /* FC 0x41 INFO/ERASE/COMMIT/ABORT/STATUS */
uint16_t bl_req_verify(uint8_t *out, uint32_t length, uint32_t crc32); /* FC 0x41 VERIFY */
uint16_t bl_req_data(uint8_t *out, uint32_t off, const uint8_t *data, uint8_t len); /* FC 0x42 DATA */

/* Response parsers: operate on the full frame including the trailing 2 CRC
 * bytes (the caller already validated the CRC via bl_frame_check). */

/* FC 0x03 reply, 1 register -> *val. Returns 0 ok, -1 malformed, +1 if the
 * reply is a Modbus exception (fc|0x80) with the exception code in *val's
 * low byte. */
int mb_resp_read_reg(const uint8_t *f, uint16_t len, uint16_t *val);

/* FC 0x41 INFO reply -> *info. Returns 0 ok, -1 malformed. */
int bl_resp_info(const uint8_t *f, uint16_t len, bl_info_t *info);

/* Generic ACK/NAK reply for FC 0x41 (sub-ACK body [1][0x41][sub][0x00]) or
 * FC 0x42 (data-ACK body [1][0x42][offset:4 BE]), selected by expect_fc.
 * expect_fc|0x80 is recognized as a NAK (body [1][fc|0x80][err]).
 * When expect_fc == BL_FC_CONTROL, expect_sub is also checked against the
 * echoed sub-code (f[2]) -- a mismatch (e.g. an ERASE ack received while
 * expecting a COMMIT ack) is treated as malformed. expect_sub is ignored
 * when expect_fc == BL_FC_DATA (the caller validates the echoed offset
 * itself); pass any bl_sub_t value in that case.
 * Returns 0 = ACK, 1 = NAK (*nak_err set), -1 = malformed. */
int bl_resp_ack(const uint8_t *f, uint16_t len, uint8_t expect_fc,
                bl_sub_t expect_sub, uint8_t *nak_err);

#endif
