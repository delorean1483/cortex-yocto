#include "ota_offer.h"
#include <cjson/cJSON.h>
#include <stdlib.h>
#include <string.h>

bool ota_ver_valid(const char *v)
{
    int parts = 0, digits = 0;
    if (!v || !*v) return false;
    for (const char *p = v; ; p++) {
        if (*p >= '0' && *p <= '9') {
            if (++digits > 5) return false;
        } else if (*p == '.' || *p == '\0') {
            if (digits == 0) return false;
            parts++;
            digits = 0;
            if (*p == '\0') break;
        } else {
            return false;
        }
    }
    return parts == 3;
}

static void ver_parts(const char *v, long out[3])
{
    char *end;
    out[0] = strtol(v, &end, 10);
    out[1] = strtol(end + 1, &end, 10);
    out[2] = strtol(end + 1, &end, 10);
}

int ota_ver_cmp(const char *a, const char *b)
{
    bool va = ota_ver_valid(a), vb = ota_ver_valid(b);
    if (!va || !vb) return (int)va - (int)vb;
    long pa[3], pb[3];
    ver_parts(a, pa);
    ver_parts(b, pb);
    for (int i = 0; i < 3; i++)
        if (pa[i] != pb[i]) return pa[i] < pb[i] ? -1 : 1;
    return 0;
}

bool ota_parse_latest(const char *json, char *ver, size_t len)
{
    bool ok = false;
    if (!json || !ver || len == 0) return false;
    ver[0] = '\0';
    cJSON *root = cJSON_Parse(json);
    if (!root) return false;
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(root, "version");
    if (cJSON_IsString(v) && v->valuestring && ota_ver_valid(v->valuestring) &&
        strlen(v->valuestring) < len) {
        strcpy(ver, v->valuestring);
        ok = true;
    }
    cJSON_Delete(root);
    return ok;
}

bool ota_status_busy(const char *s)
{
    if (!s) return false;
    return strncmp(s, "downloading", 11) == 0 || strncmp(s, "installing", 10) == 0;
}

ota_offer_t ota_decide(const char *running, const char *latest,
                       bool ota_busy, bool apu_flash_busy)
{
    if (!ota_ver_valid(latest)) return OTA_OFFER_NONE;
    if (running && running[0] && ota_ver_cmp(latest, running) <= 0) return OTA_OFFER_NONE;
    if (ota_busy || apu_flash_busy) return OTA_OFFER_BLOCKED_BUSY;
    return OTA_OFFER_AVAILABLE;
}
