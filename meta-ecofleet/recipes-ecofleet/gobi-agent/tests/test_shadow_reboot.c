/* Host test: shadow.c captures the AWS metadata timestamp of desired.reboot so
 * main.c's reboot guard can tell a fresh request from the one it already
 * carried out before a restart. Drives the REAL get/accepted and delta
 * handlers with payloads shaped like AWS IoT's.
 */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <cjson/cJSON.h>

#include "shadow.h"
#include "shadow.c"

int mosquitto_publish(struct mosquitto *m, int *mid, const char *topic,
                      int payloadlen, const void *payload, int qos, bool retain) {
    (void)m; (void)mid; (void)topic; (void)payloadlen; (void)payload; (void)qos; (void)retain;
    return MOSQ_ERR_SUCCESS;
}
int mosquitto_subscribe(struct mosquitto *m, int *mid, const char *sub, int qos) {
    (void)m; (void)mid; (void)sub; (void)qos; return MOSQ_ERR_SUCCESS;
}

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

static long long seen_ts; static int seen_reboot;
static void cb(const shadow_config_t *cfg, void *u) {
    (void)u; seen_reboot = cfg->reboot_requested; seen_ts = cfg->reboot_request_ts;
}

static void feed_get(const char *p)   { handle_get_accepted(p, (int)strlen(p)); }
static void feed_delta(const char *p) { handle_delta(p, (int)strlen(p)); }

int main(void) {
    shadow_init("TEST-001", "1.2.62", cb, NULL);

    /* On connect: get/accepted with a standing reboot request (the loop case). */
    feed_get("{\"state\":{\"desired\":{\"reboot\":true,\"poll_interval_s\":20}},"
             "\"metadata\":{\"desired\":{\"reboot\":{\"timestamp\":1790360000},"
             "\"poll_interval_s\":{\"timestamp\":1790000000}}},\"version\":5}");
    CHECK(seen_reboot == 1);
    CHECK(seen_ts == 1790360000);
    CHECK(shadow_get_config()->reboot_request_ts == 1790360000);

    /* The next report clears the one-shot (and its timestamp). */
    shadow_reported_t rep; memset(&rep, 0, sizeof rep);
    shadow_publish_reported((struct mosquitto *)1, &rep);
    CHECK(shadow_get_config()->reboot_requested == false);
    CHECK(shadow_get_config()->reboot_request_ts == 0);

    /* A fresh dashboard reboot arrives as a delta: metadata is top-level. */
    feed_delta("{\"version\":7,\"timestamp\":1790370001,\"state\":{\"reboot\":true},"
               "\"metadata\":{\"reboot\":{\"timestamp\":1790370000}}}");
    CHECK(seen_reboot == 1);
    CHECK(seen_ts == 1790370000);

    /* A reboot with no metadata (hand-made message) still requests a reboot,
     * with ts 0 — the guard honors unknown-timestamp requests as before. */
    shadow_publish_reported((struct mosquitto *)1, &rep);
    feed_delta("{\"state\":{\"reboot\":true}}");
    CHECK(seen_reboot == 1);
    CHECK(seen_ts == 0);

    shadow_cleanup();
    printf(fails ? "test_shadow_reboot FAILED (%d)\n" : "test_shadow_reboot ok\n", fails);
    return fails ? 1 : 0;
}
