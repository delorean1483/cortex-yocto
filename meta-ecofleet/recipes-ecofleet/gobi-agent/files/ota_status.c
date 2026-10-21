#include "ota_status.h"
#include <stdio.h>
#include <string.h>

bool ota_request_status(const char *req, long age_s, long ttl_s, char *out, size_t out_len)
{
    static const char kInstall[] = "install ";
    out[0] = '\0';
    if (!req || strncmp(req, kInstall, sizeof(kInstall) - 1) != 0) return false;
    const char *ver = req + sizeof(kInstall) - 1;
    if (ver[0] == '\0' || age_s > ttl_s) return false;
    snprintf(out, out_len, "downloading %s", ver);
    return true;
}

const char *ota_status_effective(const char *raw, long age_s, long ttl_s)
{
    if (!raw || raw[0] == '\0' || strcmp(raw, "idle") == 0) return "idle";
    if (age_s > ttl_s) return "idle";   /* aged out — worker done or crashed */
    return raw;
}
