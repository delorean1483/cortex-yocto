/* Minimal host stub for <mosquitto.h> so shadow.c can be compiled into a host
 * test. The test exercises the pure state logic (apply_desired /
 * shadow_clear_firmware_target / shadow_get_config) and never actually
 * publishes/subscribes, but the symbols must resolve at link time. */
#ifndef MOSQUITTO_STUB_H
#define MOSQUITTO_STUB_H
#include <stdbool.h>
struct mosquitto;
#define MOSQ_ERR_SUCCESS 0
int mosquitto_publish(struct mosquitto *m, int *mid, const char *topic,
                      int payloadlen, const void *payload, int qos, bool retain);
int mosquitto_subscribe(struct mosquitto *m, int *mid, const char *sub, int qos);
#endif
