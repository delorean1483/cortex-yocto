/* device/gobi-agent/shadow.c
 * Device Shadow client — see shadow.h for API docs.
 *
 * Dependencies: mosquitto, cJSON (already used by gobi-agent for telemetry JSON)
 * Build: add shadow.c to CMakeLists.txt target_sources(gobi-agent ...)
 */

#include "shadow.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <errno.h>
#include <time.h>

#include <mosquitto.h>
#include <cjson/cJSON.h>

/* ── Internal state ─────────────────────────────────────────────────────── */

static struct {
    char               unit_serial[64];
    char               firmware_version[32];
    shadow_config_cb_t config_cb;
    void              *cb_userdata;

    /* Topic strings — built once in shadow_init() */
    char topic_get[128];
    char topic_update[128];
    char topic_get_accepted[128];
    char topic_get_rejected[128];
    char topic_delta[128];
    char topic_update_accepted[128];
    char topic_update_rejected[128];

    /* Current config — protected by mutex */
    shadow_config_t config;
    pthread_mutex_t config_mutex;

    bool initialised;
} s = {0};

/* ── Defaults ────────────────────────────────────────────────────────────── */

static void set_default_config(shadow_config_t *cfg)
{
    cfg->poll_interval_s  = 5;
    cfg->reboot_requested = false;
    strncpy(cfg->report_mode,      "normal", sizeof(cfg->report_mode) - 1);
    strncpy(cfg->firmware_target,  "",       sizeof(cfg->firmware_target) - 1);
}

/* ── Topic helpers ───────────────────────────────────────────────────────── */

#define TOPIC_PREFIX "$aws/things/gobi-apu-%s/shadow"

static void build_topics(const char *unit)
{
    snprintf(s.topic_get,             sizeof(s.topic_get),
             TOPIC_PREFIX "/get",             unit);
    snprintf(s.topic_update,          sizeof(s.topic_update),
             TOPIC_PREFIX "/update",          unit);
    snprintf(s.topic_get_accepted,    sizeof(s.topic_get_accepted),
             TOPIC_PREFIX "/get/accepted",    unit);
    snprintf(s.topic_get_rejected,    sizeof(s.topic_get_rejected),
             TOPIC_PREFIX "/get/rejected",    unit);
    snprintf(s.topic_delta,           sizeof(s.topic_delta),
             TOPIC_PREFIX "/update/delta",    unit);
    snprintf(s.topic_update_accepted, sizeof(s.topic_update_accepted),
             TOPIC_PREFIX "/update/accepted", unit);
    snprintf(s.topic_update_rejected, sizeof(s.topic_update_rejected),
             TOPIC_PREFIX "/update/rejected", unit);
}

/* ── Apply desired object ────────────────────────────────────────────────── */

/* Parse a "desired" or "delta/state" cJSON object and apply non-null fields
 * to the live config. Returns true if anything changed. */
static bool apply_desired(const cJSON *desired)
{
    if (!cJSON_IsObject(desired)) return false;

    pthread_mutex_lock(&s.config_mutex);
    shadow_config_t prev = s.config;

    const cJSON *v;

    v = cJSON_GetObjectItemCaseSensitive(desired, "poll_interval_s");
    if (cJSON_IsNumber(v)) {
        int val = (int)v->valuedouble;
        if (val >= 5 && val <= 60)
            s.config.poll_interval_s = val;
        else
            fprintf(stderr, "[shadow] poll_interval_s %d out of range [5,60] — ignored\n", val);
    }

    v = cJSON_GetObjectItemCaseSensitive(desired, "report_mode");
    if (cJSON_IsString(v) && v->valuestring) {
        const char *mode = v->valuestring;
        if (strcmp(mode,"normal")==0 || strcmp(mode,"eco")==0 || strcmp(mode,"debug")==0)
            strncpy(s.config.report_mode, mode, sizeof(s.config.report_mode)-1);
        else
            fprintf(stderr, "[shadow] unknown report_mode '%s' — ignored\n", mode);
    }

    v = cJSON_GetObjectItemCaseSensitive(desired, "firmware_target");
    if (cJSON_IsString(v) && v->valuestring)
        strncpy(s.config.firmware_target, v->valuestring,
                sizeof(s.config.firmware_target)-1);

    v = cJSON_GetObjectItemCaseSensitive(desired, "reboot");
    if (cJSON_IsTrue(v))
        s.config.reboot_requested = true;

    bool changed = memcmp(&prev, &s.config, sizeof(shadow_config_t)) != 0;
    shadow_config_t snapshot = s.config;
    pthread_mutex_unlock(&s.config_mutex);

    if (changed) {
        fprintf(stderr,
                "[shadow] config updated: poll=%ds mode=%s fw_target=%s reboot=%d\n",
                snapshot.poll_interval_s, snapshot.report_mode,
                snapshot.firmware_target, snapshot.reboot_requested);
        if (s.config_cb)
            s.config_cb(&snapshot, s.cb_userdata);
    }

    return changed;
}

/* ── Message handlers ────────────────────────────────────────────────────── */

static void handle_get_accepted(const void *payload, int len)
{
    char *buf = strndup((const char *)payload, len);
    if (!buf) return;

    cJSON *root = cJSON_Parse(buf);
    free(buf);
    if (!root) { fprintf(stderr, "[shadow] get/accepted: bad JSON\n"); return; }

    const cJSON *state   = cJSON_GetObjectItemCaseSensitive(root, "state");
    const cJSON *desired = cJSON_GetObjectItemCaseSensitive(state, "desired");
    apply_desired(desired);

    cJSON_Delete(root);
}

static void handle_delta(const void *payload, int len)
{
    char *buf = strndup((const char *)payload, len);
    if (!buf) return;

    cJSON *root = cJSON_Parse(buf);
    free(buf);
    if (!root) { fprintf(stderr, "[shadow] delta: bad JSON\n"); return; }

    /* Delta payload: { "version": N, "state": { <desired fields> } } */
    const cJSON *state = cJSON_GetObjectItemCaseSensitive(root, "state");
    apply_desired(state);

    cJSON_Delete(root);
}

static void handle_get_rejected(const void *payload, int len)
{
    /* 404 is normal on first boot before the shadow exists — not an error */
    char *buf = strndup((const char *)payload, (size_t)len > 256 ? 256 : len);
    if (buf) {
        fprintf(stderr, "[shadow] get/rejected: %s\n", buf);
        free(buf);
    }
}

static void handle_update_rejected(const void *payload, int len)
{
    char *buf = strndup((const char *)payload, (size_t)len > 256 ? 256 : len);
    if (buf) {
        fprintf(stderr, "[shadow] update/rejected: %s\n", buf);
        free(buf);
    }
}

/* ── Public API ─────────────────────────────────────────────────────────── */

int shadow_init(const char *unit_serial,
                const char *firmware_version,
                shadow_config_cb_t config_cb,
                void *userdata)
{
    if (s.initialised) return 0;

    strncpy(s.unit_serial,      unit_serial,      sizeof(s.unit_serial)-1);
    strncpy(s.firmware_version, firmware_version, sizeof(s.firmware_version)-1);
    s.config_cb   = config_cb;
    s.cb_userdata = userdata;

    set_default_config(&s.config);
    build_topics(unit_serial);

    if (pthread_mutex_init(&s.config_mutex, NULL) != 0) {
        fprintf(stderr, "[shadow] mutex init failed: %s\n", strerror(errno));
        return -1;
    }

    s.initialised = true;
    fprintf(stderr, "[shadow] initialised for unit %s (fw %s)\n",
            unit_serial, firmware_version);
    return 0;
}

int shadow_subscribe(struct mosquitto *mosq)
{
    if (!s.initialised) return -1;

    const char *topics[] = {
        s.topic_get_accepted,
        s.topic_get_rejected,
        s.topic_delta,
        s.topic_update_accepted,
        s.topic_update_rejected,
    };

    int rc = 0;
    for (size_t i = 0; i < sizeof(topics)/sizeof(topics[0]); i++) {
        int r = mosquitto_subscribe(mosq, NULL, topics[i], 1);
        if (r != MOSQ_ERR_SUCCESS) {
            fprintf(stderr, "[shadow] subscribe failed for %s: %d\n", topics[i], r);
            rc = r;
        }
    }
    return rc;
}

int shadow_get(struct mosquitto *mosq)
{
    if (!s.initialised) return -1;
    /* Empty payload triggers shadow fetch */
    int rc = mosquitto_publish(mosq, NULL, s.topic_get,
                               0, NULL, 1, false);
    if (rc != MOSQ_ERR_SUCCESS)
        fprintf(stderr, "[shadow] shadow/get publish failed: %d\n", rc);
    return rc;
}

bool shadow_on_message(struct mosquitto *mosq,
                       const char *topic,
                       const void *payload,
                       int payloadlen)
{
    (void)mosq;
    if (!s.initialised || !topic) return false;

    if (strcmp(topic, s.topic_get_accepted)    == 0) { handle_get_accepted(payload, payloadlen); return true; }
    if (strcmp(topic, s.topic_get_rejected)    == 0) { handle_get_rejected(payload, payloadlen); return true; }
    if (strcmp(topic, s.topic_delta)           == 0) { handle_delta(payload, payloadlen);        return true; }
    if (strcmp(topic, s.topic_update_accepted) == 0) { return true; } /* no-op, success */
    if (strcmp(topic, s.topic_update_rejected) == 0) { handle_update_rejected(payload, payloadlen); return true; }

    return false;
}

int shadow_publish_reported(struct mosquitto *mosq,
                            const shadow_reported_t *reported)
{
    if (!s.initialised || !reported) return -1;

    pthread_mutex_lock(&s.config_mutex);
    int poll = s.config.poll_interval_s;
    char mode[16];
    strncpy(mode, s.config.report_mode, sizeof(mode)-1);
    pthread_mutex_unlock(&s.config_mutex);

    /* Build JSON:
     * {
     *   "state": {
     *     "reported": {
     *       "poll_interval_s": <n>,
     *       "report_mode": "<mode>",
     *       "firmware_version": "<ver>",
     *       "apu_state": "<state>",
     *       "dc_v": <n>,
     *       "batt_soc": <n>,
     *       "fault": "<hex>",
     *       "last_seen_ts": <ms>
     *     }
     *   }
     * }
     */
    cJSON *root     = cJSON_CreateObject();
    cJSON *state    = cJSON_AddObjectToObject(root, "state");
    cJSON *rep      = cJSON_AddObjectToObject(state, "reported");

    cJSON_AddNumberToObject(rep, "poll_interval_s",  poll);
    cJSON_AddStringToObject(rep, "report_mode",      mode);
    cJSON_AddStringToObject(rep, "firmware_version", s.firmware_version);
    cJSON_AddStringToObject(rep, "apu_state",        reported->apu_state);
    cJSON_AddNumberToObject(rep, "dc_v",             reported->dc_v);
    cJSON_AddNumberToObject(rep, "batt_soc",         reported->batt_soc);
    cJSON_AddStringToObject(rep, "fault",            reported->fault);
    cJSON_AddNumberToObject(rep, "last_seen_ts",     (double)reported->last_seen_ts);

    /* Clear one-shot reboot flag now that we've reported */
    pthread_mutex_lock(&s.config_mutex);
    if (s.config.reboot_requested) {
        cJSON_AddBoolToObject(rep, "reboot", false);
        s.config.reboot_requested = false;
    }
    pthread_mutex_unlock(&s.config_mutex);

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!json) return -1;

    int rc = mosquitto_publish(mosq, NULL, s.topic_update,
                               (int)strlen(json), json, 1, false);
    free(json);

    if (rc != MOSQ_ERR_SUCCESS)
        fprintf(stderr, "[shadow] reported update publish failed: %d\n", rc);

    return rc;
}

const shadow_config_t *shadow_get_config(void)
{
    /* Caller must not modify. Mutex not held on return — suitable for
     * reading in the main telemetry loop since shadow_config_t fields
     * are written atomically under the mutex. */
    return &s.config;
}

void shadow_cleanup(void)
{
    if (!s.initialised) return;
    pthread_mutex_destroy(&s.config_mutex);
    s.initialised = false;
}
