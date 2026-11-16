/* Host test for ota_fetch: the panel's "Check for updates" fetch runs on its
 * own thread, so a slow network (curl timeout 8 s) can't stall the telemetry
 * thread, whose Modbus traffic keeps the G0B1 from stopping the heater
 * (5 s Cortex-silence stop). A fake fetch blocks until released. */
#define _POSIX_C_SOURCE 200809L
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "ota_fetch.h"

static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t  cv = PTHREAD_COND_INITIALIZER;
static int released, calls;

static void fake_fetch(ota_fetch_result_t *out)
{
    pthread_mutex_lock(&mu);
    calls++;
    while (!released) pthread_cond_wait(&cv, &mu);
    pthread_mutex_unlock(&mu);
    out->curl_rc = 0;
    out->http = 200;
    out->overflow = false;
    strcpy(out->data, "{\"version\":\"1.2.88\"}");
    out->len = strlen(out->data);
}

static void release(void)
{
    pthread_mutex_lock(&mu);
    released = 1;
    pthread_cond_broadcast(&cv);
    pthread_mutex_unlock(&mu);
}

static uint64_t mono(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
}

/* Poll ota_fetch_take() for up to 2 s, like the 200 ms wait loop. */
static bool take_within(ota_fetch_result_t *r)
{
    for (int i = 0; i < 200; i++) {
        if (ota_fetch_take(r)) return true;
        struct timespec nap = { 0, 10 * 1000000L };
        nanosleep(&nap, NULL);
    }
    return false;
}

int main(void)
{
    ota_fetch_result_t r;

    CHECK(!ota_fetch_take(&r));            /* nothing started */
    CHECK(!ota_fetch_busy());

    /* start returns at once while the fetch is still blocked */
    uint64_t t0 = mono();
    CHECK(ota_fetch_start(fake_fetch));
    CHECK(mono() - t0 < 100u);
    CHECK(ota_fetch_busy());
    CHECK(!ota_fetch_start(fake_fetch));   /* one at a time */
    CHECK(!ota_fetch_take(&r));            /* not finished yet */

    release();
    memset(&r, 0, sizeof r);
    CHECK(take_within(&r));
    CHECK(r.http == 200 && r.curl_rc == 0 && !r.overflow);
    CHECK(strcmp(r.data, "{\"version\":\"1.2.88\"}") == 0);
    CHECK(r.len == strlen(r.data));
    CHECK(!ota_fetch_take(&r));            /* a result is taken once */
    CHECK(!ota_fetch_busy());

    /* and a new check can start afterwards */
    CHECK(ota_fetch_start(fake_fetch));
    CHECK(take_within(&r));
    CHECK(calls == 2);

    printf(fails ? "test_ota_fetch FAILED (%d)\n" : "test_ota_fetch ok\n", fails);
    return fails ? 1 : 0;
}
