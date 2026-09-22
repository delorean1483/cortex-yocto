/* Minimal host stub for <modbus.h>, used only by test_bl_transport_serial.c so
 * the real bl_transport_serial.c can be compiled on the Mac without libmodbus.
 * The test never calls modbus_get_socket() (it sets g_serial_ctx.fd directly to
 * a pty), but the symbol must resolve at link time. */
#ifndef MODBUS_STUB_H
#define MODBUS_STUB_H
typedef struct _modbus modbus_t;
int modbus_get_socket(modbus_t *ctx);
#endif
