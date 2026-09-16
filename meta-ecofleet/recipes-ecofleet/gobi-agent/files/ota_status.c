#include "ota_status.h"
#include <string.h>

const char *ota_status_effective(const char *raw, long age_s, long ttl_s)
{
    if (!raw || raw[0] == '\0' || strcmp(raw, "idle") == 0) return "idle";
    if (age_s > ttl_s) return "idle";   /* aged out — worker done or crashed */
    return raw;
}
