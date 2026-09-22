/* Host test for the cortex-OTA firmware_target compare-and-clear in shadow.c.
 *
 * WHY: after a cortex image OTA the agent converges (running firmware_version ==
 * desired firmware_target) but historically never CLEARED desired.firmware_target.
 * Because the agent reports firmware_version (not firmware_target), AWS then
 * re-fired an update/delta on EVERY telemetry publish — a standing delta storm
 * that also double-applied transient commands like apu_command (observed on
 * 2026-09-22: one web "Start APU" press wrote the STM32 op-state reg twice).
 * shadow_clear_firmware_target() ends it by nulling the satisfied target, with a
 * value guard so a newer target is never wiped.
 *
 * shadow.c is compiled in (via #include) so we reach the static apply_desired();
 * tests/mqstub/ stands in for libmosquitto (never actually published to here).
 */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <cjson/cJSON.h>

#include "shadow.h"
#include "shadow.c"   /* brings in static apply_desired + the state struct `s` */

/* Satisfy the link references from shadow.c's (unused-here) publish/subscribe. */
int mosquitto_publish(struct mosquitto *m, int *mid, const char *topic,
                      int payloadlen, const void *payload, int qos, bool retain) {
    (void)m; (void)mid; (void)topic; (void)payloadlen; (void)payload; (void)qos; (void)retain;
    return MOSQ_ERR_SUCCESS;
}
int mosquitto_subscribe(struct mosquitto *m, int *mid, const char *sub, int qos) {
    (void)m; (void)mid; (void)sub; (void)qos; return MOSQ_ERR_SUCCESS;
}

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

/* Drive a desired.firmware_target through the real parse path (apply_desired). */
static void apply_fw_target(const char *v) {
    cJSON *d = cJSON_CreateObject();
    cJSON_AddStringToObject(d, "firmware_target", v);
    apply_desired(d);
    cJSON_Delete(d);
}

int main(void) {
    shadow_init("TEST-001", "1.2.56", NULL, NULL);

    /* ---- converged: the target we are running gets cleared. ---- */
    apply_fw_target("1.2.56");
    CHECK(strcmp(shadow_get_config()->firmware_target, "1.2.56") == 0);   /* pending */
    shadow_clear_firmware_target("1.2.56");
    CHECK(shadow_get_config()->firmware_target[0] == '\0');               /* THE FIX: cleared */

    /* ---- value guard: a newer/other target must NOT be wiped by a stale
     * converged version (running != it, so it must stay pending). ---- */
    apply_fw_target("1.2.57");
    CHECK(strcmp(shadow_get_config()->firmware_target, "1.2.57") == 0);
    shadow_clear_firmware_target("1.2.56");                               /* stale version */
    CHECK(strcmp(shadow_get_config()->firmware_target, "1.2.57") == 0);   /* still pending */

    /* ---- guards: empty/NULL version are no-ops (don't wipe a pending target). ---- */
    shadow_clear_firmware_target("");
    shadow_clear_firmware_target(NULL);
    CHECK(strcmp(shadow_get_config()->firmware_target, "1.2.57") == 0);

    printf(fails ? "test_shadow_fw_target FAILED (%d)\n" : "test_shadow_fw_target ok\n", fails);
    return fails ? 1 : 0;
}
