/* Host test: desired.location handling in the REAL shadow.c.
 *
 * - a full desired.location (get/accepted) is stored to LOCATION_JSON_PATH
 * - a partial delta (only the changed nested field) is merged, not treated as
 *   an invalid/incomplete location
 * - {"assigned":false} clears the stored file
 * - reported.location echoes the merged desired object exactly, so AWS sees
 *   desired == reported and does not keep a standing delta
 * LOCATION_JSON_PATH is overridden on the compile line to a /tmp path.
 */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <unistd.h>
#include <cjson/cJSON.h>

#include "shadow.h"
#include "shadow.c"

static char last_payload[4096];
int mosquitto_publish(struct mosquitto *m, int *mid, const char *topic,
                      int payloadlen, const void *payload, int qos, bool retain) {
    (void)m; (void)mid; (void)topic; (void)qos; (void)retain;
    int n = payloadlen < (int)sizeof(last_payload) - 1 ? payloadlen : (int)sizeof(last_payload) - 1;
    memcpy(last_payload, payload, n); last_payload[n] = '\0';
    return MOSQ_ERR_SUCCESS;
}
int mosquitto_subscribe(struct mosquitto *m, int *mid, const char *sub, int qos) {
    (void)m; (void)mid; (void)sub; (void)qos; return MOSQ_ERR_SUCCESS;
}

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

static void apply(const char *json) {
    cJSON *d = cJSON_Parse(json);
    apply_desired(d);
    cJSON_Delete(d);
}

/* Publish a report and return state.reported.location (caller deletes root). */
static cJSON *published_location(cJSON **root) {
    shadow_reported_t rep; memset(&rep, 0, sizeof rep);
    last_payload[0] = '\0';
    shadow_publish_reported((struct mosquitto *)1, &rep);
    *root = cJSON_Parse(last_payload);
    cJSON *st = cJSON_GetObjectItemCaseSensitive(*root, "state");
    cJSON *r  = cJSON_GetObjectItemCaseSensitive(st, "reported");
    return cJSON_GetObjectItemCaseSensitive(r, "location");
}

int main(void) {
    unlink(LOCATION_JSON_PATH);
    shadow_init("TEST-001", "1.2.60", NULL, NULL);
    unit_location_t l;
    cJSON *root;

    /* no location assigned yet: nothing reported */
    CHECK(published_location(&root) == NULL); cJSON_Delete(root);

    /* full object (get/accepted) */
    apply("{\"location\":{\"assigned\":true,\"lat\":37.7306,\"lon\":-88.9331,\"label\":\"Marion, IL\"}}");
    CHECK(location_load(LOCATION_JSON_PATH, &l) == 1);
    CHECK(l.lat == 37.7306 && l.lon == -88.9331 && strcmp(l.label, "Marion, IL") == 0);

    /* partial delta: only the label changed */
    apply("{\"location\":{\"label\":\"Bench\"}}");
    CHECK(location_load(LOCATION_JSON_PATH, &l) == 1);
    CHECK(l.lat == 37.7306 && strcmp(l.label, "Bench") == 0);

    /* reported echoes the merged desired object exactly */
    cJSON *rl = published_location(&root);
    cJSON *want = cJSON_Parse("{\"assigned\":true,\"lat\":37.7306,\"lon\":-88.9331,\"label\":\"Bench\"}");
    CHECK(rl != NULL && cJSON_Compare(rl, want, true));
    cJSON_Delete(want); cJSON_Delete(root);

    /* explicit clear removes the file and is still echoed (converges) */
    apply("{\"location\":{\"assigned\":false}}");
    CHECK(access(LOCATION_JSON_PATH, F_OK) != 0);
    rl = published_location(&root);
    CHECK(rl != NULL && cJSON_IsFalse(cJSON_GetObjectItemCaseSensitive(rl, "assigned")));
    cJSON_Delete(root);

    /* invalid object is ignored: no file created */
    apply("{\"location\":{\"assigned\":true,\"lat\":999}}");
    CHECK(access(LOCATION_JSON_PATH, F_OK) != 0);

    shadow_cleanup();
    unlink(LOCATION_JSON_PATH);
    printf(fails ? "test_shadow_location FAILED (%d)\n" : "test_shadow_location ok\n", fails);
    return fails ? 1 : 0;
}
