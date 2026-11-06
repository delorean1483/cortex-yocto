/* Host test for apu_silence.c: when to raise "APU not responding", the event
 * it publishes, and the last-fault state file that lets a restarted agent
 * still clear it. */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <cjson/cJSON.h>

#include "apu_silence.h"

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

static void write_file(const char *path, const char *text) {
    FILE *f = fopen(path, "w");
    if (f) { fputs(text, f); fclose(f); }
}

int main(void) {
    const uint64_t T = 5000000;   /* monotonic ms */

    /* raise only after a full minute of silence, and only once */
    CHECK(!apu_silence_should_raise(0, T, T));
    CHECK(!apu_silence_should_raise(0, T, T + APU_SILENT_RAISE_MS - 1));
    CHECK(apu_silence_should_raise(0, T, T + APU_SILENT_RAISE_MS));
    CHECK(apu_silence_should_raise(3, T, T + 10 * APU_SILENT_RAISE_MS));   /* was in a real fault */
    CHECK(!apu_silence_should_raise(APU_NO_REPLY_CODE, T, T + 10 * APU_SILENT_RAISE_MS));
    /* never on a clock that reads earlier than the drop */
    CHECK(!apu_silence_should_raise(0, T, T - 1));

    /* the event: same shape as a firmware fault event */
    char *json = apu_silence_fault_json("TRUCK-001", 1762430000000ULL);
    cJSON *ev = cJSON_Parse(json);
    CHECK(ev != NULL);
    if (ev) {
        CHECK(strcmp(cJSON_GetStringValue(cJSON_GetObjectItem(ev, "unit")), "TRUCK-001") == 0);
        CHECK(cJSON_GetNumberValue(cJSON_GetObjectItem(ev, "ts")) == 1762430000000.0);
        CHECK(strcmp(cJSON_GetStringValue(cJSON_GetObjectItem(ev, "error")), "apu_no_reply") == 0);
        CHECK(cJSON_GetNumberValue(cJSON_GetObjectItem(ev, "error_n")) == 256);
        CHECK(strcmp(cJSON_GetStringValue(cJSON_GetObjectItem(ev, "status")), "no_reply") == 0);
    }
    cJSON_Delete(ev);
    free(json);

    /* last-fault state file */
    char path[64];
    snprintf(path, sizeof path, "/tmp/test_apu_silence_%d", (int)getpid());
    unlink(path);
    CHECK(last_fault_load(path) == 0);                       /* missing */
    CHECK(last_fault_save(path, APU_NO_REPLY_CODE) == 0);
    CHECK(last_fault_load(path) == APU_NO_REPLY_CODE);
    CHECK(last_fault_save(path, 0) == 0);
    CHECK(last_fault_load(path) == 0);
    write_file(path, "garbage\n");
    CHECK(last_fault_load(path) == 0);                       /* corrupt */
    write_file(path, "99999\n");
    CHECK(last_fault_load(path) == 0);                       /* out of range */
    unlink(path);
    CHECK(last_fault_save("/nonexistent-dir/last-fault", 3) == -1);

    printf(fails ? "test_apu_silence FAILED (%d)\n" : "test_apu_silence ok\n", fails);
    return fails ? 1 : 0;
}
