/* device/gobi-agent/shadow.c
 * Device Shadow client — see shadow.h for API docs.
 *
 * Dependencies: mosquitto, cJSON (already used by gobi-agent for telemetry JSON)
 * Build: add shadow.c to CMakeLists.txt target_sources(gobi-agent ...)
 */

#include "shadow.h"
#include "location.h"

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

    /* Set once an APU command has been applied to the hardware, so the next
     * reported update nulls it in the cloud desired state. Protected by mutex. */
    bool clear_apu_cmd_desired;

    /* Monotonic sequence bumped every time apply_desired() ACCEPTS an
     * apu_command. Lets shadow_ack_apu_command() tell whether the command it
     * is about to clear is still the one that was peeked, or whether a newer
     * one landed while the (slow) reg-10 Modbus write was in flight — the same
     * compare-and-clear the heater path uses, so a newer command (e.g. a Stop
     * chasing a Start) is never silently wiped. Protected by mutex; internal
     * only, never exposed via shadow_config_t. */
    unsigned apu_command_seq;

    /* Set once the cortex/image OTA has CONVERGED (running firmware_version ==
     * desired firmware_target), so the next reported update nulls
     * desired.firmware_target in the cloud shadow. Without this the satisfied
     * target lingers in desired and — because the agent reports firmware_version,
     * not firmware_target — AWS re-fires an update/delta on EVERY telemetry
     * publish (a standing delta storm that also double-applies transient
     * commands like apu_command). Value-based, not seq: only the exact version
     * we converged on is cleared, so a newer target is never wiped. Mutex. */
    bool clear_fw_target_desired;

    /* Set once an apu_firmware_target flash has reached a terminal outcome, so
     * the next reported update nulls it in the cloud desired state. Protected
     * by mutex. */
    bool clear_apu_fw_desired;

    /* Monotonic sequence bumped every time apply_desired() ACCEPTS an
     * apu_firmware_target. Lets shadow_ack_apu_firmware_target() compare-and-
     * clear so a newer target landing while a flash is in flight is not wiped
     * by a stale ack. Protected by mutex; internal only. */
    unsigned apu_fw_target_seq;

    /* Set once a heater command has been applied to the hardware, so the
     * next reported update nulls desired.heater in the cloud shadow.
     * Protected by mutex. */
    bool clear_heater_desired;

    /* Monotonic sequence bumped every time apply_desired() ACCEPTS a heater
     * update (sets heater_desired_valid = true). Lets shadow_ack_heater_cmd()
     * tell whether the command it is about to clear is still the one that
     * was peeked, or whether a newer one landed while the (slow) Modbus
     * write was in flight — see shadow.h. Protected by mutex; internal only,
     * never exposed via shadow_config_t. */
    unsigned heater_desired_seq;

    /* Full desired.location as last seen: get/accepted delivers the whole
     * object, but a delta carries only the nested fields that changed, so
     * deltas are merged into this copy before it is parsed. It is echoed back
     * as reported.location so desired == reported and AWS stops re-sending the
     * delta (a never-reported desired key is a standing delta storm — see
     * clear_fw_target_desired). Protected by mutex. */
    cJSON *desired_location;

    /* Metadata timestamp of desired.reboot in the message being applied, set
     * by the get/accepted or delta handler just before apply_desired() runs
     * (both on the MQTT thread). */
    long long pending_reboot_ts;

    bool initialised;
} s = {0};

/* ── Defaults ────────────────────────────────────────────────────────────── */

static void set_default_config(shadow_config_t *cfg)
{
    cfg->poll_interval_s  = 5;
    cfg->reboot_requested = false;
    strncpy(cfg->report_mode,      "normal", sizeof(cfg->report_mode) - 1);
    strncpy(cfg->firmware_target,  "",       sizeof(cfg->firmware_target) - 1);
    strncpy(cfg->apu_command,      "",       sizeof(cfg->apu_command) - 1);
    strncpy(cfg->apu_firmware_target, "",    sizeof(cfg->apu_firmware_target) - 1);
    cfg->heater_desired_valid = false;
    cfg->heater_on            = -1;  /* sentinel: not provided/invalid */
    cfg->heater_level         = -1;  /* sentinel: not provided/invalid */
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

    /* Dashboard-assigned location (Fleet map). Not part of shadow_config_t:
     * it is persisted to LOCATION_JSON_PATH for weather-fetch (forecast +
     * time zone). Merged under the lock, then parsed/stored outside it since
     * that does file I/O. Idempotent — location_store() only rewrites the file
     * when the value actually changes. */
    const cJSON *loc = cJSON_GetObjectItemCaseSensitive(desired, "location");
    if (cJSON_IsObject(loc)) {
        pthread_mutex_lock(&s.config_mutex);
        if (!s.desired_location) s.desired_location = cJSON_CreateObject();
        for (const cJSON *c = loc->child; c && s.desired_location; c = c->next) {
            cJSON_DeleteItemFromObjectCaseSensitive(s.desired_location, c->string);
            if (!cJSON_IsNull(c))
                cJSON_AddItemToObject(s.desired_location, c->string, cJSON_Duplicate(c, 1));
        }
        cJSON *merged = s.desired_location ? cJSON_Duplicate(s.desired_location, 1) : NULL;
        pthread_mutex_unlock(&s.config_mutex);

        unit_location_t l;
        int r = location_from_desired(merged, &l);
        if (r < 0) {
            fprintf(stderr, "[shadow] invalid desired.location — ignored\n");
        } else {
            int c = location_store(LOCATION_JSON_PATH, r == 1 ? &l : NULL);
            if (c < 0)
                fprintf(stderr, "[shadow] could not store assigned location\n");
            else if (c == 1 && r == 1)
                fprintf(stderr, "[shadow] assigned location %.4f,%.4f (%s)\n",
                        l.lat, l.lon, l.label[0] ? l.label : "unnamed");
            else if (c == 1)
                fprintf(stderr, "[shadow] assigned location cleared\n");
        }
        cJSON_Delete(merged);
    }

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
    if (cJSON_IsTrue(v)) {
        s.config.reboot_requested  = true;
        s.config.reboot_request_ts = s.pending_reboot_ts;
    }

    v = cJSON_GetObjectItemCaseSensitive(desired, "apu_command");
    if (cJSON_IsString(v) && v->valuestring) {
        const char *cmd = v->valuestring;
        /* Target op-state: "climate" | "battery" | "stop" (mapped to the
         * firmware mode reg by apu_command_to_mode_reg() in the telemetry
         * loop); "start" is still accepted as a legacy alias for "climate". */
        if (strcmp(cmd, "climate") == 0 || strcmp(cmd, "battery") == 0 ||
            strcmp(cmd, "stop")    == 0 || strcmp(cmd, "start")   == 0) {
            strncpy(s.config.apu_command, cmd, sizeof(s.config.apu_command) - 1);
            s.apu_command_seq++;
        } else {
            fprintf(stderr, "[shadow] unknown apu_command '%s' — ignored\n", cmd);
        }
    }

    /* STM32 APU-controller firmware flash target (semver "M.m.p"). Accepted
     * permissively here (like firmware_target); the telemetry loop re-validates
     * with stu_parse_version() and only flashes when it matches the bundled
     * image. Stored NUL-terminated; a bumped sequence lets the ack compare-and-
     * clear. */
    v = cJSON_GetObjectItemCaseSensitive(desired, "apu_firmware_target");
    if (cJSON_IsString(v) && v->valuestring && v->valuestring[0]) {
        strncpy(s.config.apu_firmware_target, v->valuestring,
                sizeof(s.config.apu_firmware_target) - 1);
        s.config.apu_firmware_target[sizeof(s.config.apu_firmware_target) - 1] = '\0';
        s.apu_fw_target_seq++;
    }

    /* Heater-scoped remote control: desired.heater = { "on": 0|1, "level": 1..10 },
     * with "on" and "level" each INDEPENDENTLY optional so a bare stop
     * ({"on":0}) is never blocked on a level also being supplied — dropping a
     * remote stop would be a safety issue. Whichever field is absent/invalid
     * is stored as the sentinel -1 (main.c only writes a register when its
     * value is >= its valid floor). A narrower remote-control surface than the
     * whole-APU apu_command above, scoped to the heater.
     *
     * If a command is already pending (not yet applied+acked by the
     * telemetry thread), seed on_val/level_val from the still-pending values
     * instead of -1, so a second partial message (e.g. a bare {"level":N}
     * arriving while an earlier {"on":0} stop is still pending) AUGMENTS the
     * pending command per-field rather than clobbering the other field back
     * to -1 and silently dropping it. Last writer wins per field; once
     * shadow_ack_heater_cmd() clears heater_desired_valid, the next message
     * again starts fresh at -1. */
    const cJSON *h = cJSON_GetObjectItemCaseSensitive(desired, "heater");
    if (cJSON_IsObject(h)) {
        const cJSON *hon  = cJSON_GetObjectItemCaseSensitive(h, "on");
        const cJSON *hlvl = cJSON_GetObjectItemCaseSensitive(h, "level");
        int on_val    = s.config.heater_desired_valid ? s.config.heater_on    : -1;
        int level_val = s.config.heater_desired_valid ? s.config.heater_level : -1;
        bool have_on = false, have_level = false;

        if (cJSON_IsNumber(hon)) {
            int v = (int)hon->valuedouble;
            if (v == 0 || v == 1) { on_val = v; have_on = true; }
            else
                fprintf(stderr, "[shadow] heater.on %d out of range {0,1} — ignored\n", v);
        }
        if (cJSON_IsNumber(hlvl)) {
            int v = (int)hlvl->valuedouble;
            if (v >= 1 && v <= 10) { level_val = v; have_level = true; }
            else
                fprintf(stderr, "[shadow] heater.level %d out of range [1,10] — ignored\n", v);
        }
        if (have_on || have_level) {
            s.config.heater_on            = on_val;
            s.config.heater_level         = level_val;
            s.config.heater_desired_valid = true;
            s.heater_desired_seq++;
        }
    }

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

/* metadata.<key>.timestamp (epoch seconds) from a shadow metadata object, or
 * 0 when absent. */
static long long field_timestamp(const cJSON *meta, const char *key)
{
    const cJSON *m  = cJSON_GetObjectItemCaseSensitive(meta, key);
    const cJSON *ts = cJSON_GetObjectItemCaseSensitive(m, "timestamp");
    return cJSON_IsNumber(ts) && ts->valuedouble > 0 ? (long long)ts->valuedouble : 0;
}

static void handle_get_accepted(const void *payload, int len)
{
    char *buf = strndup((const char *)payload, len);
    if (!buf) return;

    cJSON *root = cJSON_Parse(buf);
    free(buf);
    if (!root) { fprintf(stderr, "[shadow] get/accepted: bad JSON\n"); return; }

    const cJSON *state   = cJSON_GetObjectItemCaseSensitive(root, "state");
    const cJSON *desired = cJSON_GetObjectItemCaseSensitive(state, "desired");
    /* get/accepted metadata mirrors state: metadata.desired.<key>.timestamp */
    const cJSON *meta    = cJSON_GetObjectItemCaseSensitive(root, "metadata");
    s.pending_reboot_ts  = field_timestamp(cJSON_GetObjectItemCaseSensitive(meta, "desired"), "reboot");
    apply_desired(desired);
    s.pending_reboot_ts  = 0;

    cJSON_Delete(root);
}

static void handle_delta(const void *payload, int len)
{
    char *buf = strndup((const char *)payload, len);
    if (!buf) return;

    cJSON *root = cJSON_Parse(buf);
    free(buf);
    if (!root) { fprintf(stderr, "[shadow] delta: bad JSON\n"); return; }

    /* Delta payload: { "version": N, "state": { <desired fields> },
     *                  "metadata": { <key>: { "timestamp": T } } } */
    const cJSON *state = cJSON_GetObjectItemCaseSensitive(root, "state");
    s.pending_reboot_ts = field_timestamp(cJSON_GetObjectItemCaseSensitive(root, "metadata"), "reboot");
    apply_desired(state);
    s.pending_reboot_ts = 0;

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
    strncpy(mode, s.config.report_mode, sizeof(mode));
    mode[sizeof(mode)-1] = '\0';
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
    cJSON_AddStringToObject(rep, "ota_status",
                            reported->ota_status[0] ? reported->ota_status : "idle");
    cJSON_AddStringToObject(rep, "apu_state",        reported->apu_state);
    cJSON_AddNumberToObject(rep, "dc_v",             reported->dc_v);
    cJSON_AddNumberToObject(rep, "batt_soc",         reported->batt_soc);
    cJSON_AddStringToObject(rep, "fault",            reported->fault);
    cJSON_AddNumberToObject(rep, "last_seen_ts",     (double)reported->last_seen_ts);

    /* VEVOR heater sub-object — mirrors the heater_* keys in
     * build_telemetry_json(), but only when a heater block is actually
     * present on this unit. Omitted entirely (not even a "present" key)
     * when heater_present is false, so heaterless firmware never publishes
     * a permanent heater.comms_ok:false — this restores the pre-branch
     * shape for heaterless units. */
    if (reported->heater_present) {
        cJSON *heater = cJSON_AddObjectToObject(rep, "heater");
        cJSON_AddStringToObject(heater, "state",    reported->heater_state);
        cJSON_AddNumberToObject(heater, "level",    reported->heater_level);
        cJSON_AddNumberToObject(heater, "error",    reported->heater_error);
        cJSON_AddNumberToObject(heater, "fan_rpm",  reported->heater_fan_rpm);
        cJSON_AddBoolToObject  (heater, "safe_off", reported->heater_safe_off);
        cJSON_AddBoolToObject  (heater, "comms_ok", reported->heater_comms_ok);
    }

    /* Echo the assigned location back so desired == reported (no standing
     * delta). */
    pthread_mutex_lock(&s.config_mutex);
    if (s.desired_location)
        cJSON_AddItemToObject(rep, "location", cJSON_Duplicate(s.desired_location, 1));
    pthread_mutex_unlock(&s.config_mutex);

    /* Clear one-shot flags: include desired nulls so the cloud shadow is also
     * cleared. The APU command and heater command are nulled only once they
     * have actually been applied to the hardware (shadow_ack_apu_command /
     * shadow_ack_heater_cmd), so a command is never lost while a Modbus
     * write is still pending or retrying. */
    pthread_mutex_lock(&s.config_mutex);
    bool clear_reboot    = s.config.reboot_requested;
    bool clear_apu_cmd   = s.clear_apu_cmd_desired;
    bool clear_apu_fw    = s.clear_apu_fw_desired;
    bool clear_heater    = s.clear_heater_desired;
    bool clear_fw_target = s.clear_fw_target_desired;
    if (clear_reboot) {
        cJSON_AddBoolToObject(rep, "reboot", false);
        s.config.reboot_requested  = false;
        s.config.reboot_request_ts = 0;
    }
    if (clear_apu_cmd)
        s.clear_apu_cmd_desired = false;
    if (clear_apu_fw)
        s.clear_apu_fw_desired = false;
    if (clear_heater)
        s.clear_heater_desired = false;
    if (clear_fw_target)
        s.clear_fw_target_desired = false;
    pthread_mutex_unlock(&s.config_mutex);

    if (clear_reboot || clear_apu_cmd || clear_apu_fw || clear_heater || clear_fw_target) {
        cJSON *des = cJSON_AddObjectToObject(state, "desired");
        if (clear_reboot)    cJSON_AddNullToObject(des, "reboot");
        if (clear_apu_cmd)   cJSON_AddNullToObject(des, "apu_command");
        if (clear_apu_fw)    cJSON_AddNullToObject(des, "apu_firmware_target");
        if (clear_heater)    cJSON_AddNullToObject(des, "heater");
        if (clear_fw_target) cJSON_AddNullToObject(des, "firmware_target");
    }

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

bool shadow_peek_apu_command(char *out, size_t out_len, unsigned *seq)
{
    if (!s.initialised || !out || out_len == 0 || !seq) return false;

    pthread_mutex_lock(&s.config_mutex);
    bool pending = s.config.apu_command[0] != '\0';
    if (pending) {
        strncpy(out, s.config.apu_command, out_len - 1);
        out[out_len - 1] = '\0';
        *seq = s.apu_command_seq;
    }
    pthread_mutex_unlock(&s.config_mutex);
    return pending;
}

void shadow_ack_apu_command(unsigned seq)
{
    if (!s.initialised) return;

    pthread_mutex_lock(&s.config_mutex);
    /* Only clear the command that was actually peeked. If apply_desired()
     * accepted a newer apu_command while the reg-10 write for this one was in
     * flight, s.apu_command_seq has since moved on — leave the (newer) pending
     * command alone so it is retried next cycle instead of being silently
     * wiped by this stale ack. */
    if (seq == s.apu_command_seq) {
        s.config.apu_command[0] = '\0';
        s.clear_apu_cmd_desired = true;
    }
    pthread_mutex_unlock(&s.config_mutex);
}

void shadow_clear_firmware_target(const char *version)
{
    if (!s.initialised || !version || version[0] == '\0') return;

    pthread_mutex_lock(&s.config_mutex);
    /* Value-based compare-and-clear: only drop the target we actually
     * converged on. A newer firmware_target would leave running != target, so
     * ota_trigger() would not have called us — this can't wipe a pending
     * upgrade. Nulling desired.firmware_target ends the standing update/delta
     * (the agent reports firmware_version, never firmware_target, so a
     * satisfied-but-uncleared target mismatches reported forever). */
    if (strcmp(s.config.firmware_target, version) == 0) {
        s.config.firmware_target[0] = '\0';
        s.clear_fw_target_desired = true;
    }
    pthread_mutex_unlock(&s.config_mutex);
}

bool shadow_peek_apu_firmware_target(char *out, size_t out_len, unsigned *seq)
{
    if (!s.initialised || !out || out_len == 0 || !seq) return false;

    pthread_mutex_lock(&s.config_mutex);
    bool pending = s.config.apu_firmware_target[0] != '\0';
    if (pending) {
        strncpy(out, s.config.apu_firmware_target, out_len - 1);
        out[out_len - 1] = '\0';
        *seq = s.apu_fw_target_seq;
    }
    pthread_mutex_unlock(&s.config_mutex);
    return pending;
}

void shadow_ack_apu_firmware_target(unsigned seq)
{
    if (!s.initialised) return;

    pthread_mutex_lock(&s.config_mutex);
    /* Only clear the target that was actually peeked. If apply_desired()
     * accepted a newer apu_firmware_target while the flash for this one was in
     * flight, s.apu_fw_target_seq has since moved on — leave the (newer)
     * pending target alone so it is retried next cycle instead of being
     * silently wiped by this stale ack. */
    if (seq == s.apu_fw_target_seq) {
        s.config.apu_firmware_target[0] = '\0';
        s.clear_apu_fw_desired = true;
    }
    pthread_mutex_unlock(&s.config_mutex);
}

bool shadow_peek_heater_cmd(int *on, int *level, unsigned *seq)
{
    if (!s.initialised || !on || !level || !seq) return false;

    pthread_mutex_lock(&s.config_mutex);
    bool pending = s.config.heater_desired_valid;
    if (pending) {
        *on    = s.config.heater_on;
        *level = s.config.heater_level;
        *seq   = s.heater_desired_seq;
    }
    pthread_mutex_unlock(&s.config_mutex);
    return pending;
}

void shadow_ack_heater_cmd(unsigned seq)
{
    if (!s.initialised) return;

    pthread_mutex_lock(&s.config_mutex);
    /* Only clear the command that was actually peeked. If apply_desired()
     * accepted a newer heater update while the Modbus write for this one
     * was in flight, s.heater_desired_seq has since moved on — leave the
     * (newer) pending command alone so it is retried next cycle instead of
     * being silently wiped by this stale ack. */
    if (seq == s.heater_desired_seq) {
        s.config.heater_desired_valid = false;
        s.clear_heater_desired        = true;
    }
    pthread_mutex_unlock(&s.config_mutex);
}

void shadow_cleanup(void)
{
    if (!s.initialised) return;
    cJSON_Delete(s.desired_location);
    s.desired_location = NULL;
    pthread_mutex_destroy(&s.config_mutex);
    s.initialised = false;
}
