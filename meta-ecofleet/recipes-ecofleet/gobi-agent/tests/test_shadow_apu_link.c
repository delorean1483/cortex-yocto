/* Host test for reported.apu_link in shadow.c. When the APU controller stops
 * answering Modbus the agent sends no telemetry, so without this the whole
 * unit read "Offline" on the dashboard (TRUCK-001, 2026-10-27). The agent now
 * keeps reporting while the link is down: apu_link "down", when it changed,
 * and a heartbeat. The APU-derived keys are left out, so the shadow (which
 * merges reported updates key by key) keeps their last real values.
 *
 * shadow.c is compiled in (via #include); tests/mqstub/ stands in for
 * libmosquitto and the publish stub captures the payload.
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

static cJSON *root;
static cJSON *rep;     /* state.reported of the last publish */

static void publish(const shadow_reported_t *r) {
    cJSON_Delete(root);
    shadow_publish_reported((struct mosquitto *)0x1, r);
    root = cJSON_Parse(last_payload);
    rep = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "state"), "reported");
}
static bool has(const char *key) { return cJSON_GetObjectItem(rep, key) != NULL; }
static const char *str(const char *key) { return cJSON_GetStringValue(cJSON_GetObjectItem(rep, key)); }
static double num(const char *key) { return cJSON_GetNumberValue(cJSON_GetObjectItem(rep, key)); }
static bool is(const char *key, const char *want) { const char *v = str(key); return v && strcmp(v, want) == 0; }

/* the keys that come from a Modbus read of the APU */
static bool apu_keys_present(void) {
    return has("apu_state") && has("dc_v") && has("batt_soc") && has("fault") &&
           has("last_seen_ts") && has("heater");
}
static bool apu_keys_absent(void) {
    return !has("apu_state") && !has("dc_v") && !has("batt_soc") && !has("fault") &&
           !has("last_seen_ts") && !has("heater");
}

int main(void) {
    shadow_init("TEST-001", "1.2.87", NULL, NULL);
    const uint64_t T0 = 1762430000000ULL;   /* 2026-11-06, epoch ms */

    shadow_reported_t r;
    memset(&r, 0, sizeof r);
    r.dc_v = 12.6; r.last_seen_ts = T0 - 60000;
    strcpy(r.apu_state, "idle"); strcpy(r.fault, "0x0000");
    r.heater_present = true; strcpy(r.heater_state, "off");
    strcpy(r.network.eth_ip, "192.168.0.94");

    /* No read recorded yet: the pre-feature shape, no apu_link keys. */
    publish(&r);
    CHECK(!has("apu_link") && !has("apu_link_since") && !has("heartbeat_ts"));
    CHECK(apu_keys_present());

    /* Agent starts with the APU already silent. */
    CHECK(shadow_note_apu_link(false, T0) == true);
    s.config.reboot_requested = true;            /* a reboot carried out earlier */
    publish(&r);
    CHECK(is("apu_link", "down"));
    CHECK(num("apu_link_since") == (double)T0);
    CHECK(num("heartbeat_ts") == (double)T0);
    CHECK(apu_keys_absent());                    /* shadow keeps the last real values */
    CHECK(cJSON_IsObject(cJSON_GetObjectItem(rep, "network")));
    CHECK(is("firmware_version", "1.2.87"));
    CHECK(str("ota_status") != NULL);
    /* one-shot clears still go out while the APU is down */
    CHECK(cJSON_IsNull(cJSON_GetObjectItem(cJSON_GetObjectItem(
              cJSON_GetObjectItem(root, "state"), "desired"), "reboot")));

    /* Still down a cycle later: since holds, the heartbeat moves. */
    CHECK(shadow_note_apu_link(false, T0 + 25000) == false);
    publish(&r);
    CHECK(is("apu_link", "down"));
    CHECK(num("apu_link_since") == (double)T0);
    CHECK(num("heartbeat_ts") == (double)(T0 + 25000));

    /* The APU answers again. */
    const uint64_t T1 = T0 + 3600000;
    CHECK(shadow_note_apu_link(true, T1) == true);
    r.last_seen_ts = T1;
    publish(&r);
    CHECK(is("apu_link", "ok"));
    CHECK(num("apu_link_since") == (double)T1);
    CHECK(num("heartbeat_ts") == (double)T1);
    CHECK(apu_keys_present());
    CHECK(num("last_seen_ts") == (double)T1);

    CHECK(shadow_note_apu_link(true, T1 + 5000) == false);
    publish(&r);
    CHECK(num("apu_link_since") == (double)T1);
    CHECK(num("heartbeat_ts") == (double)(T1 + 5000));

    /* And drops again. */
    CHECK(shadow_note_apu_link(false, T1 + 10000) == true);
    publish(&r);
    CHECK(is("apu_link", "down"));
    CHECK(num("apu_link_since") == (double)(T1 + 10000));
    CHECK(apu_keys_absent());

    cJSON_Delete(root);
    printf(fails ? "test_shadow_apu_link FAILED (%d)\n" : "test_shadow_apu_link ok\n", fails);
    return fails ? 1 : 0;
}
