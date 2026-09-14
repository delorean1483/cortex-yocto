/* stm32_update.c — STM32 update decision logic (see stm32_update.h). No I/O. */
#include "stm32_update.h"

#include <cjson/cJSON.h>
#include <stdio.h>
#include <string.h>

const char *stu_status_str(stu_status_t s)
{
    switch (s) {
        case STU_IDLE:      return "idle";
        case STU_AVAILABLE: return "available";
        case STU_FLASHING:  return "flashing";
        case STU_OK:        return "ok";
        case STU_FAILED:    return "failed";
        case STU_DISABLED:  return "disabled";
        default:            return "idle";   /* unknown -> safe default */
    }
}

uint16_t stu_encode_version(unsigned major, unsigned minor, unsigned patch)
{
    return (uint16_t)(major * 10000u + minor * 100u + patch);
}

int stu_is_newer(uint16_t running_enc, uint16_t bundled_enc)
{
    return (running_enc != 0 && bundled_enc > running_enc) ? 1 : 0;
}

int stu_should_flash(uint16_t running_enc, uint16_t bundled_enc,
                      uint8_t mode, uint8_t engine, int auto_enabled)
{
    return (stu_is_newer(running_enc, bundled_enc) &&
            mode == 0 && engine == 0 && auto_enabled) ? 1 : 0;
}

/* Strictly parse "M.m.p" (three unsigned decimal integers separated by
 * literal dots, nothing else). Rejects signs, whitespace, and trailing
 * garbage that sscanf's %u would otherwise silently tolerate or misparse. */
static int parse_version_str(const char *s, unsigned *maj, unsigned *min, unsigned *pat)
{
    if (!s || !s[0]) return 0;

    for (const char *p = s; *p; p++) {
        if (!((*p >= '0' && *p <= '9') || *p == '.')) return 0;
    }

    int consumed = 0;
    if (sscanf(s, "%u.%u.%u%n", maj, min, pat, &consumed) != 3) return 0;
    if (s[consumed] != '\0') return 0;   /* trailing garbage after M.m.p */

    return 1;
}

int stu_parse_manifest(const char *json, uint16_t *ver_enc,
                        char *slotA, char *slotB, size_t name_cap)
{
    if (!json || !ver_enc || !slotA || !slotB || name_cap == 0) return -1;

    cJSON *root = cJSON_Parse(json);
    if (!root) return -1;

    int rc = -1;
    const char *ver = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(root, "version"));
    const char *a   = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(root, "slotA"));
    const char *b   = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(root, "slotB"));

    unsigned maj, min, pat;
    if (ver && a && b && parse_version_str(ver, &maj, &min, &pat)) {
        size_t la = strlen(a);
        size_t lb = strlen(b);
        if (la < name_cap && lb < name_cap) {
            *ver_enc = stu_encode_version(maj, min, pat);
            memcpy(slotA, a, la + 1);
            memcpy(slotB, b, lb + 1);
            rc = 0;
        }
    }

    cJSON_Delete(root);
    return rc;
}
