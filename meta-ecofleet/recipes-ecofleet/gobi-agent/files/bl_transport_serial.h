#ifndef BL_TRANSPORT_SERIAL_H
#define BL_TRANSPORT_SERIAL_H
#include <modbus.h>
#include "bl_session.h"

/* Raw-fd RS-485 transport binding bl_transport_t's xfer()/wait_reset() to
 * the raw file descriptor underneath an already-opened libmodbus RTU
 * context. Needed because the STM32 bootloader's FC 0x41/0x42 frames are
 * not libmodbus requests -- they must be written/read directly on the
 * wire, framed by inter-byte idle-gap (RTU 3.5-char-time) detection
 * rather than by libmodbus's own framing.
 *
 * The RS-485 transceiver on /dev/ttyUSB0 is auto-direction (the same path
 * libmodbus already drives for normal Modbus traffic), so this transport
 * does no DE/RTS toggling of its own.
 *
 * bl_transport_serial_init() fills *out (caller-owned, already allocated)
 * with an xfer/wait_reset implementation bound to modbus_get_socket(ctx).
 * Returns 0 on success, <0 if the fd can't be obtained (e.g. ctx not
 * connected yet). */
int bl_transport_serial_init(bl_transport_t *out, modbus_t *ctx);

#endif
