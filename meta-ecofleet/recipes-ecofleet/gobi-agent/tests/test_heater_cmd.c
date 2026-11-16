/* Host test for heater_cmd_apply(): delivery of the remote heater command
 * (shadow desired.heater) to the G0B1, one pass per agent heater tick.
 *
 * Rule under test (Robb, PR #126 replay): ON is delivered at most once, STOP
 * at least once. A lost-reply ON must not stay pending, or the old ON is
 * re-sent and accepted after a G0B1 Cortex-silence stop re-arms START.
 *
 * Drives the REAL shadow.c (compiled in, like test_shadow_heater.c) and the
 * real planner; a fake writer stands in for the RS-485 bus and records every
 * write. tests/mqstub/ stands in for libmosquitto.
 */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <time.h>
#include <cjson/cJSON.h>

#include "shadow.h"
#include "shadow.c"
#include "heater_cmd.h"
#include "heater_ext.h"

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

static void desired(const char *heater_json) {
    char buf[256];
    snprintf(buf, sizeof buf, "{\"heater\":%s}", heater_json);
    cJSON *d = cJSON_Parse(buf);
    apply_desired(d);
    cJSON_Delete(d);
}

static uint64_t mono(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
}

/* ── fake bus ─────────────────────────────────────────────────────────── */
static struct { int reg, value; } wlog[32];
static int nw;
static int answer_53 = HEATER_WR_OK;   /* result for reg 53 (on/off) writes */
static int answer_54 = HEATER_WR_OK;   /* result for reg 54 (level) writes  */
static const char *inject;             /* desired.heater landing mid-write  */

static int fake_write(int reg, int value, const char *what, void *ctx) {
    (void)what; (void)ctx;
    if (nw < 32) { wlog[nw].reg = reg; wlog[nw].value = value; nw++; }
    if (inject) { const char *j = inject; inject = NULL; desired(j); }
    if (reg == 53) return answer_53;
    if (reg == 54) return answer_54;
    return HEATER_WR_OK;
}
static int count(int reg, int value) {
    int c = 0;
    for (int i = 0; i < nw; i++) if (wlog[i].reg == reg && wlog[i].value == value) c++;
    return c;
}
static void reset_bus(void) {
    nw = 0; answer_53 = answer_54 = HEATER_WR_OK; inject = NULL;
}
static bool pending(void) {
    shadow_heater_cmd_t c; unsigned seq;
    return shadow_peek_heater_cmd(&c, &seq);
}

int main(void) {
    shadow_init("TEST-001", "1.2.88", NULL, NULL);

    /* nothing pending: no writes, IDLE (the tick then sends its keepalive) */
    reset_bus();
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_IDLE);
    CHECK(nw == 0);

    /* 1. lost-reply ON is not resent next cycle */
    reset_bus();
    desired("{\"on\":1}");
    answer_53 = HEATER_WR_FAILED;
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_LOST);
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_IDLE);
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_IDLE);
    CHECK(count(53, 1) == 1);
    CHECK(!pending());
    CHECK(s.clear_heater_desired);     /* cloud desired.heater gets nulled */
    s.clear_heater_desired = false;

    /* 2. lost-reply STOP is resent until it gets an answer */
    reset_bus();
    desired("{\"on\":0}");
    answer_53 = HEATER_WR_FAILED;
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_LOST);
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_LOST);
    CHECK(pending());
    answer_53 = HEATER_WR_OK;
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(count(53, 0) == 3);
    CHECK(!pending());

    /* a refused STOP is an answer (PR #126): not resent */
    reset_bus();
    desired("{\"on\":0}");
    answer_53 = HEATER_WR_REFUSED;
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_IDLE);
    CHECK(count(53, 0) == 1);

    /* a refused ON is final (PR #126) */
    reset_bus();
    desired("{\"on\":1}");
    answer_53 = HEATER_WR_REFUSED;
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_IDLE);
    CHECK(count(53, 1) == 1);

    /* 3. ON + level, level lost: the level is resent, the ON is not */
    reset_bus();
    desired("{\"on\":1,\"level\":3}");
    answer_54 = HEATER_WR_FAILED;
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_LOST);
    answer_54 = HEATER_WR_OK;
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(count(53, 1) == 1);
    CHECK(count(54, 3) == 2);
    CHECK(!pending());

    /* 4. a level arriving while the ON is on the wire merges into the pending
       command; it must not carry the already-sent ON into the next cycle */
    reset_bus();
    desired("{\"on\":1}");
    inject = "{\"level\":5}";
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(pending());                  /* the newer level is still owed */
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(count(53, 1) == 1);
    CHECK(count(54, 5) == 1);
    CHECK(!pending());

    /* ...but a NEW ON arriving mid-write is a new request and is sent */
    reset_bus();
    desired("{\"on\":1}");
    answer_53 = HEATER_WR_FAILED;
    inject = "{\"on\":1}";
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_LOST);
    CHECK(pending());
    answer_53 = HEATER_WR_OK;
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(count(53, 1) == 2);
    CHECK(!pending());

    /* ...and a STOP arriving mid-ON is sent next cycle */
    reset_bus();
    desired("{\"on\":1}");
    inject = "{\"on\":0}";
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(count(53, 1) == 1 && count(53, 0) == 1);
    CHECK(!pending());

    /* 5. an ON older than HEATER_ON_MAX_AGE_MS (link down meanwhile) is
       dropped, never written; the rest of the command still lands */
    reset_bus();
    desired("{\"on\":1,\"level\":2}");
    CHECK(heater_cmd_apply(true, mono() + HEATER_ON_MAX_AGE_MS + 1000u, fake_write, NULL)
          == HEATER_APPLY_ANSWERED);
    CHECK(count(53, 1) == 0);
    CHECK(count(54, 2) == 1);
    CHECK(!pending());

    reset_bus();
    desired("{\"on\":1}");
    CHECK(heater_cmd_apply(true, mono() + HEATER_ON_MAX_AGE_MS + 1000u, fake_write, NULL)
          == HEATER_APPLY_IDLE);
    CHECK(nw == 0);
    CHECK(!pending());
    CHECK(s.clear_heater_desired);
    s.clear_heater_desired = false;

    /* a STOP never expires */
    reset_bus();
    desired("{\"on\":0}");
    CHECK(heater_cmd_apply(true, mono() + 600000u, fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(count(53, 0) == 1);

    /* a fresh ON is written */
    reset_bus();
    desired("{\"on\":1}");
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(count(53, 1) == 1);
    CHECK(!pending());

    /* 6. the age counts from the dashboard tap (shadow metadata timestamp):
       a tap made while the unit was offline arrives on reconnect as a fresh
       message but is a minute old -> dropped */
    char msg[512];
    long long now_s = (long long)time(NULL);
    reset_bus();
    snprintf(msg, sizeof msg,
             "{\"state\":{\"heater\":{\"on\":1}},"
             "\"metadata\":{\"heater\":{\"on\":{\"timestamp\":%lld}}}}", now_s - 60);
    handle_delta(msg, (int)strlen(msg));
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_IDLE);
    CHECK(count(53, 1) == 0);
    CHECK(!pending());

    /* 7. a fresh tap is delivered once; the shadow re-sync after an MQTT
       reconnect (get/accepted, desired.heater not yet nulled in the cloud)
       carries the same tap again and must not re-send it */
    reset_bus();
    snprintf(msg, sizeof msg,
             "{\"state\":{\"heater\":{\"on\":1}},"
             "\"metadata\":{\"heater\":{\"on\":{\"timestamp\":%lld}}}}", now_s);
    handle_delta(msg, (int)strlen(msg));
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    snprintf(msg, sizeof msg,
             "{\"state\":{\"desired\":{\"heater\":{\"on\":1}}},"
             "\"metadata\":{\"desired\":{\"heater\":{\"on\":{\"timestamp\":%lld}}}}}", now_s);
    handle_get_accepted(msg, (int)strlen(msg));
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_IDLE);
    CHECK(count(53, 1) == 1);
    CHECK(!pending());

    /* ...a new tap (new timestamp) is a new request */
    snprintf(msg, sizeof msg,
             "{\"state\":{\"heater\":{\"on\":1}},"
             "\"metadata\":{\"heater\":{\"on\":{\"timestamp\":%lld}}}}", now_s + 1);
    handle_delta(msg, (int)strlen(msg));
    CHECK(heater_cmd_apply(true, mono(), fake_write, NULL) == HEATER_APPLY_ANSWERED);
    CHECK(count(53, 1) == 2);

    printf(fails ? "test_heater_cmd FAILED (%d)\n" : "test_heater_cmd ok\n", fails);
    return fails ? 1 : 0;
}
