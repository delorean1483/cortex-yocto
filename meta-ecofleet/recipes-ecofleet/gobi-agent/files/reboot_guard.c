/* reboot_guard.c — see reboot_guard.h. */
#define _POSIX_C_SOURCE 200809L
#include "reboot_guard.h"

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int reboot_guard_should_honor(long long request_ts, long long honored_ts)
{
    if (request_ts <= 0) return 1;
    return request_ts != honored_ts;
}

long long reboot_guard_load(const char *path)
{
    FILE *f = fopen(path, "r");
    if (!f) return 0;
    char buf[32] = { 0 };
    long long v = 0;
    if (fgets(buf, sizeof(buf), f)) {
        char *end = NULL;
        v = strtoll(buf, &end, 10);
        if (end == buf || (*end != '\0' && *end != '\n') || v < 0) v = 0;
    }
    fclose(f);
    return v;
}

int reboot_guard_save(const char *path, long long ts)
{
    char tmp[512];
    snprintf(tmp, sizeof(tmp), "%s.tmp", path);
    FILE *f = fopen(tmp, "w");
    if (!f) return -1;
    int ok = fprintf(f, "%lld\n", ts) > 0 && fflush(f) == 0 && fsync(fileno(f)) == 0;
    if (fclose(f) != 0) ok = 0;
    if (!ok || rename(tmp, path) != 0) { unlink(tmp); return -1; }
    return 0;
}
