/* location.c — assigned-location helpers (see location.h). */
#define _POSIX_C_SOURCE 200809L
#include "location.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int in_range(const cJSON *v, double lo, double hi, double *out)
{
    if (!cJSON_IsNumber(v)) return 0;
    double d = v->valuedouble;
    if (!(d >= lo && d <= hi)) return 0;       /* also rejects NaN */
    *out = d;
    return 1;
}

static void copy_label(char *dst, size_t dst_sz, const char *src)
{
    size_t n = 0;
    if (src)
        for (; src[n] && n < dst_sz - 1; n++) {
            unsigned char c = (unsigned char)src[n];
            dst[n] = (c < 0x20 || c == 0x7f) ? ' ' : (char)c;
        }
    dst[n] = '\0';
}

static int fill(const cJSON *o, unit_location_t *out)
{
    unit_location_t l;
    if (!in_range(cJSON_GetObjectItemCaseSensitive(o, "lat"), -90.0, 90.0, &l.lat) ||
        !in_range(cJSON_GetObjectItemCaseSensitive(o, "lon"), -180.0, 180.0, &l.lon))
        return 0;
    const cJSON *lab = cJSON_GetObjectItemCaseSensitive(o, "label");
    copy_label(l.label, sizeof(l.label), cJSON_IsString(lab) ? lab->valuestring : NULL);
    *out = l;
    return 1;
}

int location_from_desired(const cJSON *obj, unit_location_t *out)
{
    if (!cJSON_IsObject(obj) || !out) return -1;
    const cJSON *a = cJSON_GetObjectItemCaseSensitive(obj, "assigned");
    if (cJSON_IsFalse(a)) return 0;
    if (!cJSON_IsTrue(a)) return -1;
    return fill(obj, out) ? 1 : -1;
}

char *location_to_json(const unit_location_t *l)
{
    if (!l) return NULL;
    cJSON *o = cJSON_CreateObject();
    if (!o) return NULL;
    cJSON_AddNumberToObject(o, "lat", l->lat);
    cJSON_AddNumberToObject(o, "lon", l->lon);
    cJSON_AddStringToObject(o, "label", l->label);
    char *s = cJSON_PrintUnformatted(o);
    cJSON_Delete(o);
    return s;
}

int location_from_json(const char *json, unit_location_t *out)
{
    if (!json || !out) return 0;
    cJSON *o = cJSON_Parse(json);
    int ok = cJSON_IsObject(o) && fill(o, out);
    cJSON_Delete(o);
    return ok;
}

static char *slurp(const char *path)
{
    FILE *f = fopen(path, "r");
    if (!f) return NULL;
    char *buf = calloc(1, 1024);
    if (buf) {
        size_t n = fread(buf, 1, 1023, f);
        buf[n] = '\0';
    }
    fclose(f);
    return buf;
}

int location_load(const char *path, unit_location_t *out)
{
    char *s = slurp(path);
    int ok = location_from_json(s, out);
    free(s);
    return ok;
}

int location_store(const char *path, const unit_location_t *l)
{
    unit_location_t cur;
    int have = location_load(path, &cur);

    if (!l) {                                   /* clear */
        if (access(path, F_OK) != 0) return 0;
        return unlink(path) == 0 ? 1 : -1;
    }
    if (have && cur.lat == l->lat && cur.lon == l->lon && strcmp(cur.label, l->label) == 0)
        return 0;

    char *js = location_to_json(l);
    if (!js) return -1;
    char tmp[512];
    snprintf(tmp, sizeof(tmp), "%s.tmp", path);
    FILE *f = fopen(tmp, "w");
    int ok = f && fputs(js, f) != EOF;
    if (f && fclose(f) != 0) ok = 0;
    free(js);
    if (!ok || rename(tmp, path) != 0) { unlink(tmp); return -1; }
    return 1;
}
