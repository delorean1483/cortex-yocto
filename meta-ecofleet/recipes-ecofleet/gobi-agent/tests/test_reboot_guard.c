/* test_reboot_guard.c — the remote-reboot loop guard.
 *
 * WHY: gobi-agent hands "reboot" to the root worker, which cold-resets the
 * board at once; desired.reboot is only nulled in the agent's NEXT shadow
 * report, which never goes out. On restart the shadow still says
 * reboot:true and the unit rebooted again — forever. The guard remembers the
 * AWS metadata timestamp of the reboot request it carried out; a request with
 * that same timestamp is not carried out again (just cleared).
 */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#include "reboot_guard.h"

static int g_fail, g_checks;
#define CHECK(c, msg) do { g_checks++; if (!(c)) { g_fail++; \
    printf("  FAIL: %s  (%s:%d)\n", (msg), __FILE__, __LINE__); } } while (0)

int main(void)
{
    printf("reboot_guard_should_honor\n");
    CHECK(reboot_guard_should_honor(1790360000, 0) == 1, "new request, nothing honored yet");
    CHECK(reboot_guard_should_honor(1790360000, 1790350000) == 1, "newer request than last honored");
    CHECK(reboot_guard_should_honor(1790360000, 1790360000) == 0, "same request after restart: skip");
    CHECK(reboot_guard_should_honor(0, 1790360000) == 1, "no timestamp (legacy): honor");

    printf("reboot_guard_save/load\n");
    char path[] = "/tmp/test_reboot_guard_XXXXXX";
    int fd = mkstemp(path); close(fd); unlink(path);
    CHECK(reboot_guard_load(path) == 0, "missing file -> 0");
    CHECK(reboot_guard_save(path, 1790360000) == 0, "save ok");
    CHECK(reboot_guard_load(path) == 1790360000, "load returns saved ts");
    CHECK(reboot_guard_save(path, 1790370000) == 0, "overwrite ok");
    CHECK(reboot_guard_load(path) == 1790370000, "load returns newest");
    FILE *f = fopen(path, "w"); fputs("garbage\n", f); fclose(f);
    CHECK(reboot_guard_load(path) == 0, "corrupt file -> 0");
    unlink(path);
    CHECK(reboot_guard_save("/nonexistent-dir/x", 1) != 0, "save to bad path reports failure");

    printf("\n%d checks, %d failures\n", g_checks, g_fail);
    if (g_fail == 0) printf("ALL GREEN\n");
    return g_fail ? 1 : 0;
}
