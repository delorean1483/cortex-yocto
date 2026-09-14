#ifndef BL_CRC32_H
#define BL_CRC32_H
#include <stdint.h>
/* CRC-32/IEEE-802.3 (zlib crc32). Matches the STM32 crc32_compute and the
   frozen VERIFY contract in g0b1-firmware bl_proto.h / docs/remote-update.md §2. */
uint32_t bl_crc32(const uint8_t *data, uint32_t len);
#endif
