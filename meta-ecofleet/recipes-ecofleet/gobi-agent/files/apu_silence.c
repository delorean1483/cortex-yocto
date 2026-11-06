#define _POSIX_C_SOURCE 200809L
#include "apu_silence.h"

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <cjson/cJSON.h>

bool apu_silence_should_raise(unsigned last_code, uint64_t down_since_ms, uint64_t now_ms)
{
    if (last_code == APU_NO_REPLY_CODE) return false;     /* already raised */
    return now_ms >= down_since_ms && now_ms - down_since_ms >= APU_SILENT_RAISE_MS;
}

char *apu_silence_fault_json(const char *unit, uint64_t ts_ms)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) return NULL;
    cJSON_AddStringToObject(root, "unit",    unit);
    cJSON_AddNumberToObject(root, "ts",      (double)ts_ms);
    cJSON_AddStringToObject(root, "error",   "apu_no_reply");
    cJSON_AddNumberToObject(root, "error_n", APU_NO_REPLY_CODE);
    cJSON_AddStringToObject(root, "status",  "no_reply");
    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return json;
}

unsigned last_fault_load(const char *path)
{
    FILE *f = fopen(path, "r");
    if (!f) return 0;
    char buf[16] = { 0 };
    unsigned long v = 0;
    if (fgets(buf, sizeof(buf), f)) {
        char *end = NULL;
        v = strtoul(buf, &end, 10);
        if (end == buf || (*end != '\0' && *end != '\n') || v > APU_NO_REPLY_CODE) v = 0;
    }
    fclose(f);
    return (unsigned)v;
}

int last_fault_save(const char *path, unsigned code)
{
    char tmp[512];
    snprintf(tmp, sizeof(tmp), "%s.tmp", path);
    FILE *f = fopen(tmp, "w");
    if (!f) return -1;
    /* fsync: trucks lose power abruptly, and a lost record means a missed clear */
    int ok = fprintf(f, "%u\n", code) > 0 && fflush(f) == 0 && fsync(fileno(f)) == 0;
    if (fclose(f) != 0) ok = 0;
    if (!ok || rename(tmp, path) != 0) { unlink(tmp); return -1; }
    return 0;
}
