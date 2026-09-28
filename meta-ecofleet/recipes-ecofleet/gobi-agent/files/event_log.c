/* event_log.c — see event_log.h. */
#define _POSIX_C_SOURCE 200809L
#include "event_log.h"

#include <cjson/cJSON.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

void event_log_init(event_log_t *log) { memset(log, 0, sizeof(*log)); }

int event_log_active_code(const event_log_t *log)
{
    return (log->count > 0 && log->ev[0].end_ms == 0) ? log->ev[0].code : 0;
}

int event_log_on_error(event_log_t *log, int prev, int cur, long long now_ms,
                       const event_snapshot_t *snap)
{
    (void)prev;                                   /* the log's own state is the truth */
    int active = event_log_active_code(log);
    if (cur == active) return 0;

    if (active != 0) log->ev[0].end_ms = now_ms;  /* cleared or replaced */
    if (cur != 0) {
        int n = log->count < EVENT_LOG_MAX ? log->count : EVENT_LOG_MAX - 1;
        memmove(&log->ev[1], &log->ev[0], sizeof(event_t) * (size_t)n);
        memset(&log->ev[0], 0, sizeof(event_t));
        log->ev[0].code     = cur;
        log->ev[0].start_ms = now_ms;
        if (snap) log->ev[0].snap = *snap;
        log->count = n + 1;
    }
    return 1;
}

/* ── JSON file form ────────────────────────────────────────────────────── */

static void put_str(char *dst, size_t sz, const cJSON *o, const char *key)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(o, key);
    snprintf(dst, sz, "%s", cJSON_IsString(v) && v->valuestring ? v->valuestring : "");
}
static double get_num(const cJSON *o, const char *key)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(o, key);
    return cJSON_IsNumber(v) ? v->valuedouble : 0;
}

int event_log_load(const char *path, event_log_t *log)
{
    event_log_init(log);
    FILE *f = fopen(path, "r");
    if (!f) return 0;
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    rewind(f);
    if (sz <= 0 || sz > 4 * 1024 * 1024) { fclose(f); return 0; }
    char *buf = malloc((size_t)sz + 1);
    if (!buf) { fclose(f); return 0; }
    size_t n = fread(buf, 1, (size_t)sz, f);
    buf[n] = '\0';
    fclose(f);

    cJSON *root = cJSON_Parse(buf);
    free(buf);
    const cJSON *arr = cJSON_GetObjectItemCaseSensitive(root, "events");
    if (!cJSON_IsArray(arr)) { cJSON_Delete(root); return 0; }

    const cJSON *e;
    cJSON_ArrayForEach(e, arr) {
        if (log->count >= EVENT_LOG_MAX) break;
        int code = (int)get_num(e, "code");
        if (code == 0) continue;
        event_t *ev = &log->ev[log->count++];
        ev->code     = code;
        ev->start_ms = (long long)get_num(e, "start_ms");
        ev->end_ms   = (long long)get_num(e, "end_ms");
        put_str(ev->snap.error,          sizeof ev->snap.error,          e, "error");
        put_str(ev->snap.mode,           sizeof ev->snap.mode,           e, "mode");
        put_str(ev->snap.control_status, sizeof ev->snap.control_status, e, "control_status");
        put_str(ev->snap.engine_status,  sizeof ev->snap.engine_status,  e, "engine_status");
        ev->snap.rpm            = (int)get_num(e, "rpm");
        ev->snap.batt_v         = get_num(e, "batt_v");
        ev->snap.cabin_temp_f   = get_num(e, "cabin_temp_f");
        ev->snap.coolant_temp_f = get_num(e, "coolant_temp_f");
    }
    cJSON_Delete(root);
    return 1;
}

int event_log_save(const char *path, const event_log_t *log)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "version", 1);
    cJSON *arr = cJSON_AddArrayToObject(root, "events");
    for (int i = 0; arr && i < log->count; i++) {
        const event_t *ev = &log->ev[i];
        cJSON *e = cJSON_CreateObject();
        cJSON_AddNumberToObject(e, "code",           ev->code);
        cJSON_AddStringToObject(e, "error",          ev->snap.error);
        cJSON_AddNumberToObject(e, "start_ms",       (double)ev->start_ms);
        cJSON_AddNumberToObject(e, "end_ms",         (double)ev->end_ms);
        cJSON_AddStringToObject(e, "mode",           ev->snap.mode);
        cJSON_AddStringToObject(e, "control_status", ev->snap.control_status);
        cJSON_AddStringToObject(e, "engine_status",  ev->snap.engine_status);
        cJSON_AddNumberToObject(e, "rpm",            ev->snap.rpm);
        cJSON_AddNumberToObject(e, "batt_v",         ev->snap.batt_v);
        cJSON_AddNumberToObject(e, "cabin_temp_f",   ev->snap.cabin_temp_f);
        cJSON_AddNumberToObject(e, "coolant_temp_f", ev->snap.coolant_temp_f);
        cJSON_AddItemToArray(arr, e);
    }
    char *js = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!js) return -1;

    char tmp[512];
    snprintf(tmp, sizeof(tmp), "%s.tmp", path);
    FILE *f = fopen(tmp, "w");
    int ok = f && fputs(js, f) != EOF && fflush(f) == 0 && fsync(fileno(f)) == 0;
    if (f && fclose(f) != 0) ok = 0;
    free(js);
    if (!ok || rename(tmp, path) != 0) { unlink(tmp); return -1; }
    return 0;
}
