/* Host test for the heater remote-control surface in shadow.c: desired.heater
 * setpoint_f / clear_fault (heater coprocessor, fw regs 69/75) alongside the
 * existing on/level, and the reported.heater extended fields.
 *
 * shadow.c is compiled in (via #include) so we reach the static
 * apply_desired(); tests/mqstub/ stands in for libmosquitto and the publish
 * stub below captures the reported-state payload.
 */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <cjson/cJSON.h>

#include "shadow.h"
#include "shadow.c"

static char last_payload[4096];
int mosquitto_publish(struct mosquitto *m, int *mid, const char *topic,
                      int payloadlen, const void *payload, int qos, bool retain) {
    (void)m; (void)mid; (void)topic; (void)qos; (void)retain;
    if (payloadlen > 0 && (size_t)payloadlen < sizeof(last_payload)) {
        memcpy(last_payload, payload, (size_t)payloadlen);
        last_payload[payloadlen] = '\0';
    }
    return MOSQ_ERR_SUCCESS;
}
int mosquitto_subscribe(struct mosquitto *m, int *mid, const char *sub, int qos) {
    (void)m; (void)mid; (void)sub; (void)qos; return MOSQ_ERR_SUCCESS;
}

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

static void desired(const char *heater_json) {
    char buf[256];
    snprintf(buf, sizeof buf, "{\"heater\":%s}", heater_json);
    cJSON *d = cJSON_Parse(buf);
    apply_desired(d);
    cJSON_Delete(d);
}

int main(void) {
    shadow_heater_cmd_t c;
    unsigned seq;
    shadow_init("TEST-001", "1.2.73", NULL, NULL);

    /* nothing pending */
    CHECK(!shadow_peek_heater_cmd(&c, &seq));

    /* bare setpoint */
    desired("{\"setpoint_f\":72}");
    CHECK(shadow_peek_heater_cmd(&c, &seq));
    CHECK(c.setpoint_f == 72 && c.on == -1 && c.level == -1 && !c.clear_fault);
    shadow_ack_heater_cmd(seq);
    CHECK(!shadow_peek_heater_cmd(&c, &seq));

    /* bare clear_fault */
    desired("{\"clear_fault\":true}");
    CHECK(shadow_peek_heater_cmd(&c, &seq));
    CHECK(c.clear_fault && c.on == -1 && c.setpoint_f == -1);
    shadow_ack_heater_cmd(seq);

    /* clear_fault:false and out-of-range setpoint alone are not a command */
    desired("{\"clear_fault\":false,\"setpoint_f\":90}");
    CHECK(!shadow_peek_heater_cmd(&c, &seq));
    desired("{\"setpoint_f\":40}");
    CHECK(!shadow_peek_heater_cmd(&c, &seq));

    /* a pending clear is augmented (not clobbered) by a later on:1 */
    desired("{\"clear_fault\":true}");
    desired("{\"on\":1}");
    CHECK(shadow_peek_heater_cmd(&c, &seq));
    CHECK(c.clear_fault && c.on == 1);
    shadow_ack_heater_cmd(seq);

    /* after an ack the next message starts fresh (no stale clear_fault) */
    desired("{\"level\":4}");
    CHECK(shadow_peek_heater_cmd(&c, &seq));
    CHECK(c.level == 4 && !c.clear_fault && c.setpoint_f == -1);
    shadow_ack_heater_cmd(seq);

    /* reported: extended fields only when heater_ext */
    shadow_reported_t r;
    memset(&r, 0, sizeof r);
    r.heater_present = true;
    strcpy(r.heater_state, "off");
    shadow_publish_reported((struct mosquitto *)0x1, &r);
    CHECK(strstr(last_payload, "\"heater\"") != NULL);
    CHECK(strstr(last_payload, "\"phase\"") == NULL);          /* old firmware shape */
    r.heater_ext = true;
    strcpy(r.heater_type, "autoterm"); strcpy(r.heater_phase, "fault");
    strcpy(r.heater_control, "setpoint"); r.heater_setpoint_f = 72; r.heater_fault = true;
    shadow_publish_reported((struct mosquitto *)0x1, &r);
    CHECK(strstr(last_payload, "\"type\":\"autoterm\"") != NULL);
    CHECK(strstr(last_payload, "\"phase\":\"fault\"") != NULL);
    CHECK(strstr(last_payload, "\"control\":\"setpoint\"") != NULL);
    CHECK(strstr(last_payload, "\"setpoint_f\":72") != NULL);
    CHECK(strstr(last_payload, "\"fault\":true") != NULL);

    printf(fails ? "test_shadow_heater FAILED (%d)\n" : "test_shadow_heater ok\n", fails);
    return fails ? 1 : 0;
}
