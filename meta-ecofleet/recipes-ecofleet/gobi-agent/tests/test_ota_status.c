#include "ota_status.h"
#include <string.h>
#include <stdio.h>
static int fails;
#define CHECK(c) do{ if(!(c)){ printf("FAIL %s:%d %s\n",__FILE__,__LINE__,#c); fails++; } }while(0)

/* Must match main.c's OTA_STATUS_TTL_S (30 min). */
#define TTL 1800L

int main(void){
    /* A fresh status is reported verbatim, whatever phase it is in. */
    CHECK(strcmp(ota_status_effective("downloading 1.2.50",     5L,   TTL), "downloading 1.2.50")     == 0);
    CHECK(strcmp(ota_status_effective("installing 1.2.50",      120L, TTL), "installing 1.2.50")      == 0);
    CHECK(strcmp(ota_status_effective("failed: download 9.9.9", 60L,  TTL), "failed: download 9.9.9") == 0);

    /* A terminal status older than the TTL clears to idle instead of sticking
     * on the dashboard forever — the whole point of this helper. */
    CHECK(strcmp(ota_status_effective("failed: download 9.9.9", TTL + 1, TTL), "idle") == 0);
    CHECK(strcmp(ota_status_effective("success 1.2.50",         TTL + 1, TTL), "idle") == 0);

    /* A crashed worker's in-progress line also ages out (nothing is rewriting
     * the file to keep it fresh, so it can't hang "installing" indefinitely). */
    CHECK(strcmp(ota_status_effective("installing 1.2.50", TTL + 1, TTL), "idle") == 0);

    /* Exactly at the TTL is still fresh; only strictly older expires. */
    CHECK(strcmp(ota_status_effective("failed: x", TTL, TTL), "failed: x") == 0);

    /* Empty / NULL / already-idle always report idle. */
    CHECK(strcmp(ota_status_effective("",     5L, TTL), "idle") == 0);
    CHECK(strcmp(ota_status_effective(NULL,   5L, TTL), "idle") == 0);
    CHECK(strcmp(ota_status_effective("idle", 5L, TTL), "idle") == 0);

    /* Clock skew: mtime in the future (negative age) counts as fresh. */
    CHECK(strcmp(ota_status_effective("installing 1.2.50", -10L, TTL), "installing 1.2.50") == 0);

    /* A queued install the worker hasn't picked up yet reads as its first
     * state, so the panel sees busy the moment it asks (the agent republishes
     * before systemd has the worker running). */
    char out[64];
    CHECK(ota_request_status("install 1.2.80", 0L, TTL, out, sizeof(out)));
    CHECK(strcmp(out, "downloading 1.2.80") == 0);
    CHECK(ota_request_status("install 1.2.80", -10L, TTL, out, sizeof(out)));   /* clock skew = fresh */

    /* Anything but an install with a version is not an update in progress. */
    CHECK(!ota_request_status("reboot",   0L, TTL, out, sizeof(out)) && out[0] == '\0');
    CHECK(!ota_request_status("install",  0L, TTL, out, sizeof(out)) && out[0] == '\0');
    CHECK(!ota_request_status("install ", 0L, TTL, out, sizeof(out)) && out[0] == '\0');
    CHECK(!ota_request_status("",         0L, TTL, out, sizeof(out)) && out[0] == '\0');
    CHECK(!ota_request_status(NULL,       0L, TTL, out, sizeof(out)) && out[0] == '\0');

    /* A request no worker ever picked up ages out like a status line, so a
     * dead .path unit can't block updates forever. */
    CHECK(!ota_request_status("install 1.2.80", TTL + 1, TTL, out, sizeof(out)) && out[0] == '\0');

    /* A short buffer truncates but stays terminated. */
    char small[8];
    CHECK(ota_request_status("install 1.2.80", 0L, TTL, small, sizeof(small)));
    CHECK(strcmp(small, "downloa") == 0);

    printf(fails?"test_ota_status FAILED (%d)\n":"test_ota_status ok\n", fails);
    return fails?1:0;
}
